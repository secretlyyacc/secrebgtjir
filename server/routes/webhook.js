// server/routes/webhook.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, Account } = require('../config/database');
const whatsappBot = require('../models/WhatsAppBot');

const log = {
    info: (...args) => console.log(`[WEBHOOK] ${new Date().toISOString()} -`, ...args),
    error: (...args) => console.error(`[WEBHOOK ERROR] ${new Date().toISOString()} -`, ...args),
    warn: (...args) => console.warn(`[WEBHOOK WARN] ${new Date().toISOString()} -`, ...args)
};

const ORDERS_JSON_PATH = path.join(__dirname, '../../data/orders.json');
const CONFIG_PATH = path.join(__dirname, '../../data/config.json');
const PRODUCT_PATH = path.join(__dirname, '../../data/product.json');

let config = {};
try {
    if (fs.existsSync(CONFIG_PATH)) {
        config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        log.info('✅ Config loaded');
    }
} catch (error) {
    log.error('Error loading config:', error.message);
}

async function findOrderInSqlite(orderId) {
    return new Promise((resolve) => {
        if (!db) {
            resolve(null);
            return;
        }
        db.get('SELECT * FROM orders WHERE orderId = ?', [orderId], (err, row) => {
            if (err) {
                log.error('SQLite error:', err.message);
                resolve(null);
            } else {
                resolve(row);
            }
        });
    });
}

function findOrderInJson(orderId) {
    try {
        if (!fs.existsSync(ORDERS_JSON_PATH)) return null;
        const orders = JSON.parse(fs.readFileSync(ORDERS_JSON_PATH, 'utf8'));
        return orders.find(o => o.orderId === orderId) || null;
    } catch (error) {
        log.error('Error reading orders.json:', error.message);
        return null;
    }
}

async function updateOrderInSqlite(orderId, updatedData) {
    return new Promise((resolve) => {
        if (!db) {
            resolve(false);
            return;
        }
        
        const fields = [];
        const values = [];
        
        Object.keys(updatedData).forEach(key => {
            if (key !== 'orderId' && key !== 'id') {
                fields.push(`${key} = ?`);
                values.push(updatedData[key]);
            }
        });
        
        if (fields.length === 0) {
            resolve(false);
            return;
        }
        
        values.push(orderId);
        const sql = `UPDATE orders SET ${fields.join(', ')} WHERE orderId = ?`;
        
        db.run(sql, values, function(err) {
            if (err) {
                log.error('Error updating SQLite:', err.message);
                resolve(false);
            } else {
                resolve(this.changes > 0);
            }
        });
    });
}

function updateOrderInJson(orderId, updatedData) {
    try {
        if (!fs.existsSync(ORDERS_JSON_PATH)) return false;
        
        const orders = JSON.parse(fs.readFileSync(ORDERS_JSON_PATH, 'utf8'));
        const index = orders.findIndex(o => o.orderId === orderId);
        
        if (index === -1) return false;
        
        orders[index] = { ...orders[index], ...updatedData };
        fs.writeFileSync(ORDERS_JSON_PATH, JSON.stringify(orders, null, 2));
        return true;
    } catch (error) {
        log.error('Error updating orders.json:', error.message);
        return false;
    }
}

async function findOrderWithRetry(orderId, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        let order = await findOrderInSqlite(orderId);
        let source = 'sqlite';
        
        if (!order) {
            order = findOrderInJson(orderId);
            source = order ? 'json' : null;
        }
        
        if (order) {
            return { order, source };
        }
        
        if (i < maxRetries - 1) {
            const delay = 1000 * (i + 1);
            log.info(`⏳ Retry ${i + 1}/${maxRetries - 1} for order ${orderId} in ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    return { order: null, source: null };
}

async function getAvailableAccount(productId) {
    try {
        if (db) {
            return await Account.getAvailable(productId);
        }
        return null;
    } catch (error) {
        log.error('Error getting available account:', error);
        return null;
    }
}

async function markAccountAsSold(productId, orderId, customerEmail) {
    try {
        if (db) {
            return await Account.markAsSold(productId, orderId, customerEmail);
        }
        return null;
    } catch (error) {
        log.error('Error marking account as sold:', error);
        return null;
    }
}

async function updateProductStock(productId) {
    try {
        if (!fs.existsSync(PRODUCT_PATH)) return;
        
        const productData = JSON.parse(fs.readFileSync(PRODUCT_PATH, 'utf8'));
        const productIndex = productData.roles.findIndex(p => p.id === productId);
        
        if (productIndex !== -1 && db) {
            const stock = await Account.getStock(productId);
            productData.roles[productIndex].stock = stock.toString();
            fs.writeFileSync(PRODUCT_PATH, JSON.stringify(productData, null, 2));
            log.info(`📊 Updated stock for ${productId}: ${stock}`);
        }
    } catch (error) {
        log.error('Error updating product stock:', error);
    }
}

function verifySignature(req) {
    if (!config.pakasir?.webhook_secret) {
        log.info('ℹ️ No webhook secret configured, skipping signature verification');
        return true;
    }
    
    const signature = req.headers['x-pakasir-signature'] || req.headers['x-signature'];
    if (!signature) {
        log.warn('⚠️ No signature header found');
        return false;
    }
    
    const expectedSignature = crypto
        .createHmac('sha256', config.pakasir.webhook_secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
    
    const isValid = signature === expectedSignature;
    if (!isValid) {
        log.warn('⚠️ Invalid signature');
    }
    return isValid;
}

router.post('/pakasir', async (req, res) => {
    try {
        const paymentData = req.body;
        log.info('📩 WEBHOOK RECEIVED FROM PAKASIR:');
        log.info(JSON.stringify(paymentData, null, 2));

        const { amount, order_id, status, payment_method, completed_at } = paymentData;

        if (!order_id) {
            log.warn('❌ Missing order_id in webhook');
            return res.status(400).json({ error: 'Missing order_id' });
        }

        log.info(`🔍 Processing order: ${order_id}, status: ${status}, amount: ${amount}`);

        const { order, source } = await findOrderWithRetry(order_id, 3);

        if (!order) {
            log.warn(`❌ Order not found: ${order_id}`);
            return res.json({ 
                received: true, 
                warning: 'Order not found',
                order_id 
            });
        }

        log.info(`✅ Order found in ${source}:`, {
            id: order.orderId,
            currentStatus: order.status,
            amount: order.amount,
            product: order.role
        });

        if (Number(order.amount) !== Number(amount)) {
            log.error(`❌ Amount mismatch for order ${order_id}:`, {
                expected: order.amount,
                received: amount
            });
            return res.status(400).json({ 
                error: 'Amount mismatch',
                expected: order.amount,
                received: amount
            });
        }

        if (status === 'completed') {
            if (order.status === 'completed') {
                log.warn(`ℹ️ Order ${order_id} already completed, skipping`);
                return res.json({ received: true, message: 'Already processed' });
            }

            log.info(`💰 Payment completed for order ${order_id}`);

            const productId = order.productId || order.role;
            log.info(`🔍 Looking for available account for product: ${productId}`);

            const account = await getAvailableAccount(productId);

            if (!account) {
                log.error(`❌ No available accounts for product: ${productId}`);
                
                const failedUpdate = {
                    status: 'failed',
                    failedReason: 'Out of stock',
                    updatedAt: new Date().toISOString()
                };
                
                if (source === 'sqlite') {
                    await updateOrderInSqlite(order_id, failedUpdate);
                } else {
                    updateOrderInJson(order_id, failedUpdate);
                }
                
                return res.json({ 
                    received: true, 
                    warning: 'Out of stock',
                    order_id 
                });
            }

            log.info(`✅ Found account: ${account.email} (ID: ${account.id})`);

            const soldAccount = await markAccountAsSold(productId, order_id, order.username);

            if (!soldAccount) {
                log.error('❌ Failed to mark account as sold');
                return res.status(500).json({ error: 'Failed to mark account as sold' });
            }

            log.info(`✅ Account ${account.id} marked as sold`);

            const updatedOrderData = {
                status: 'completed',
                accountData: JSON.stringify(soldAccount),
                paymentMethod: payment_method || order.paymentMethod,
                pakasirData: JSON.stringify({
                    amount,
                    completed_at,
                    payment_method,
                    order_id
                }),
                completedAt: completed_at || new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            let updateSuccess = false;
            if (source === 'sqlite') {
                updateSuccess = await updateOrderInSqlite(order_id, updatedOrderData);
            } else {
                updateSuccess = updateOrderInJson(order_id, updatedOrderData);
            }

            if (updateSuccess) {
                log.info(`✅ Order ${order_id} updated to completed in ${source}`);
            } else {
                log.error(`❌ Failed to update order ${order_id} in ${source}`);
            }

            await updateProductStock(productId);

            try {
                const customerEmail = order.username || order.customer;
                
                if (customerEmail) {
                    log.info(`📧 Sending account details to: ${customerEmail}`);

                    const emailData = {
                        orderId: order.orderId,
                        productName: order.role || 'Product',
                        amount: order.amount,
                        accountData: {
                            email: account.email,
                            password: account.password,
                            twofa_code: account.twofa_code,
                            additional_info: account.additional_info
                        },
                        customer: customerEmail,
                        username: order.username,
                        status: 'completed'
                    };

                    const sendResult = await whatsappBot.sendAccountEmail(customerEmail, emailData);
                    
                    if (sendResult && sendResult.success) {
                        log.info(`✅ Account details email sent to ${customerEmail}`);
                        
                        const emailUpdate = {
                            emailSent: true,
                            emailSentAt: new Date().toISOString(),
                            emailMessageId: sendResult.messageId
                        };
                        
                        if (source === 'sqlite') {
                            await updateOrderInSqlite(order_id, emailUpdate);
                        } else {
                            updateOrderInJson(order_id, emailUpdate);
                        }
                    } else {
                        log.error(`❌ Failed to send email to ${customerEmail}:`, sendResult?.error);
                    }
                }
            } catch (emailError) {
                log.error('❌ Error sending email:', emailError.message);
            }

            try {
                const adminEmail = config.whatsapp?.adminNumber || 'admin@lyytech.id';
                if (adminEmail) {
                    await whatsappBot.sendOrderNotification({
                        orderId: order.orderId,
                        productName: order.role,
                        amount: order.amount,
                        username: order.username,
                        status: 'completed'
                    });
                }
            } catch (notifError) {
                log.error('Error sending admin notification:', notifError.message);
            }

            res.json({ 
                received: true,
                order_id,
                status: 'completed',
                account_sent: true,
                account_email: account.email
            });

        } else {
            log.info(`ℹ️ Order ${order_id} status: ${status}, updating status only`);
            
            const statusUpdate = {
                status: status,
                paymentStatus: status,
                updatedAt: new Date().toISOString()
            };
            
            if (source === 'sqlite') {
                await updateOrderInSqlite(order_id, statusUpdate);
            } else {
                updateOrderInJson(order_id, statusUpdate);
            }

            res.json({ 
                received: true,
                order_id,
                status,
                message: `Status updated to ${status}`
            });
        }

    } catch (error) {
        log.error('❌ Webhook processing error:', error);
        res.status(200).json({ 
            received: true, 
            error: 'Internal processing error but webhook received',
            message: error.message
        });
    }
});

router.get('/test', (req, res) => {
    log.info('✅ Test endpoint accessed');
    res.json({
        success: true,
        message: 'Webhook endpoint is working',
        timestamp: new Date().toISOString(),
        config: {
            webhook_secret_configured: !!config.pakasir?.webhook_secret,
            database_connected: !!db
        },
        endpoints: {
            webhook: 'POST /api/webhook/pakasir',
            test: 'GET /api/webhook/test',
            health: 'GET /api/webhook/health'
        }
    });
});

router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
            email: whatsappBot?.isReady ? 'ready' : 'not ready',
            database: db ? 'connected' : 'file-based',
            config: {
                webhook_secret: !!config.pakasir?.webhook_secret,
                admin_number: !!config.whatsapp?.adminNumber
            }
        }
    });
});

module.exports = router;
