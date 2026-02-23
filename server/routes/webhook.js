const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const pakasirService = require('../services/pakasir.service');
const whatsappBot = require('../models/WhatsAppBot');
const db = require('../config/database');

const log = {
    info: (...args) => console.log(`[WEBHOOK] ${new Date().toISOString()} -`, ...args),
    error: (...args) => console.error(`[WEBHOOK ERROR] ${new Date().toISOString()} -`, ...args),
    warn: (...args) => console.warn(`[WEBHOOK WARN] ${new Date().toISOString()} -`, ...args)
};

const ORDERS_JSON_PATH = path.join(__dirname, '../../data/orders.json');
const ROLES_PATH = path.join(__dirname, '../../data/roles.json');
const CONFIG_PATH = path.join(__dirname, '../../data/config.json');

async function findOrderInSqlite(orderId) {
    return new Promise((resolve) => {
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
            log.info(`✅ Order found in ${source} for ${orderId}`);
            return { order, source };
        }
        
        if (i < maxRetries - 1) {
            const delay = 1000 * (i + 1);
            log.info(`⏳ Order ${orderId} not found, retry ${i + 1}/${maxRetries - 1} in ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    return { order: null, source: null };
}

function getProductName(roleId) {
    try {
        if (fs.existsSync(ROLES_PATH)) {
            const rolesData = JSON.parse(fs.readFileSync(ROLES_PATH, 'utf8'));
            const roles = rolesData.roles || [];
            const role = roles.find(r => r.id == roleId || r.id === roleId);
            return role ? role.name : 'Product';
        }
    } catch (error) {
        log.error('Error reading roles:', error.message);
    }
    return 'Product';
}

router.post('/pakasir', async (req, res) => {
    try {
        const paymentData = req.body;
        log.info('📩 Webhook received from Pakasir:', paymentData);

        const { amount, order_id, status, payment_method, completed_at } = paymentData;

        if (!order_id || !amount || !status) {
            log.warn('Invalid webhook data - missing required fields');
            return res.status(400).json({ 
                received: false,
                error: 'Invalid data', 
                required: ['order_id', 'amount', 'status'] 
            });
        }

        const { order, source } = await findOrderWithRetry(order_id, 3);

        if (!order) {
            log.warn(`❌ Order not found after retries: ${order_id}`);
            return res.json({ 
                received: true, 
                warning: 'Order not found in database',
                order_id: order_id
            });
        }

        log.info(`Found order in ${source}: ${order_id}`, { 
            currentStatus: order.status,
            username: order.username,
            amount: order.amount 
        });

        if (Number(order.amount) !== Number(amount)) {
            log.error(`Amount mismatch for order ${order_id}:`, {
                expected: order.amount,
                received: amount
            });
            return res.status(400).json({ 
                received: false,
                error: 'Amount mismatch',
                expected: order.amount,
                received: amount
            });
        }

        if (status === 'completed') {
            if (order.status === 'completed') {
                log.warn(`Order ${order_id} already completed, skipping`);
                return res.json({ 
                    received: true, 
                    message: 'Order already processed' 
                });
            }

            const redeemCode = 'GTPS-' + Math.random().toString(36).substring(2, 10).toUpperCase();
            log.info(`Generated redeem code for ${order_id}: ${redeemCode}`);

            const updatedOrderData = {
                status: 'completed',
                redeemCode: redeemCode,
                paymentMethod: payment_method || order.paymentMethod,
                pakasirData: JSON.stringify({
                    amount: amount,
                    completed_at: completed_at,
                    payment_method: payment_method
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
                log.error(`Failed to update order ${order_id} in ${source}`);
            }

            try {
                const customerEmail = order.username || order.customer;
                
                if (customerEmail) {
                    log.info(`Preparing to send redeem code to: ${customerEmail}`);

                    const emailData = {
                        productName: getProductName(order.roleId || order.role),
                        amount: order.amount,
                        orderId: order.orderId,
                        redeemCode: redeemCode,
                        customer: customerEmail,
                        username: order.username,
                        status: 'completed'
                    };

                    const sendResult = await whatsappBot.sendRedeemCode(customerEmail, emailData);
                    
                    if (sendResult && sendResult.success) {
                        log.info(`✅ Redeem code email sent to ${customerEmail} (Message ID: ${sendResult.messageId})`);
                        
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
                        log.error(`Failed to send email to ${customerEmail}:`, sendResult?.error);
                        
                        const emailErrorUpdate = {
                            emailSent: false,
                            emailError: sendResult?.error || 'Unknown error',
                            emailAttemptAt: new Date().toISOString()
                        };
                        
                        if (source === 'sqlite') {
                            await updateOrderInSqlite(order_id, emailErrorUpdate);
                        } else {
                            updateOrderInJson(order_id, emailErrorUpdate);
                        }
                    }
                }
            } catch (emailError) {
                log.error('Error sending email notifications:', emailError);
            }

        } else {
            log.info(`Order ${order_id} status: ${status}, updating status only`);
            
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
        }

        res.json({ 
            received: true,
            order_id: order_id,
            status: status,
            processed_at: new Date().toISOString()
        });

    } catch (error) {
        log.error('Webhook processing error:', error);
        res.status(200).json({ 
            received: true, 
            error: 'Internal processing error but webhook received',
            message: error.message
        });
    }
});

router.post('/test/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status = 'completed' } = req.body;

        log.info(`🔧 Test webhook triggered for order: ${orderId}`);

        const { order } = await findOrderWithRetry(orderId, 1);

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const mockPaymentData = {
            amount: order.amount,
            order_id: orderId,
            project: 'test-project',
            status: status,
            payment_method: order.paymentMethod || 'qris',
            completed_at: new Date().toISOString()
        };

        log.info('Test webhook data:', mockPaymentData);

        res.json({
            success: true,
            message: 'Test webhook endpoint ready',
            data: mockPaymentData,
            note: 'Use this data to test your webhook handler'
        });

    } catch (error) {
        log.error('Test webhook error:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/email-status/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;

        const { order } = await findOrderWithRetry(orderId, 1);

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        res.json({
            success: true,
            orderId: order.orderId,
            status: order.status,
            emailSent: order.emailSent || false,
            emailSentAt: order.emailSentAt || null,
            emailError: order.emailError || null,
            redeemCode: order.status === 'completed' ? order.redeemCode : null,
            customer: order.username || order.customer
        });

    } catch (error) {
        log.error('Error checking email status:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/resend-email/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;

        const { order, source } = await findOrderWithRetry(orderId, 1);

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.status !== 'completed') {
            return res.status(400).json({ 
                error: 'Order not completed',
                status: order.status 
            });
        }

        if (!order.redeemCode) {
            return res.status(400).json({ error: 'No redeem code found' });
        }

        const customerEmail = order.username || order.customer;
        if (!customerEmail) {
            return res.status(400).json({ error: 'No customer email found' });
        }

        const emailData = {
            productName: getProductName(order.roleId || order.role),
            amount: order.amount,
            orderId: order.orderId,
            redeemCode: order.redeemCode,
            customer: customerEmail,
            username: order.username
        };

        const sendResult = await whatsappBot.sendRedeemCode(customerEmail, emailData);

        if (sendResult && sendResult.success) {
            const emailUpdate = {
                emailSent: true,
                emailSentAt: new Date().toISOString(),
                emailMessageId: sendResult.messageId,
                emailResendCount: (order.emailResendCount || 0) + 1
            };
            
            if (source === 'sqlite') {
                await updateOrderInSqlite(orderId, emailUpdate);
            } else {
                updateOrderInJson(orderId, emailUpdate);
            }

            res.json({
                success: true,
                message: 'Email resent successfully',
                messageId: sendResult.messageId,
                customer: customerEmail
            });
        } else {
            res.status(500).json({ 
                error: 'Failed to send email',
                details: sendResult?.error 
            });
        }

    } catch (error) {
        log.error('Error resending email:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        emailService: whatsappBot.isReady ? 'ready' : 'not ready',
        databases: {
            sqlite: true,
            json: fs.existsSync(ORDERS_JSON_PATH)
        }
    });
});

module.exports = router;
