// server/routes/webhook.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pakasirService = require('../services/pakasir.service');
const whatsappBot = require('../models/WhatsAppBot');
const db = require('../config/database');

const log = {
    info: (...args) => console.log(`[WEBHOOK] ${new Date().toISOString()} -`, ...args),
    error: (...args) => console.error(`[WEBHOOK ERROR] ${new Date().toISOString()} -`, ...args),
    warn: (...args) => console.warn(`[WEBHOOK WARN] ${new Date().toISOString()} -`, ...args)
};

const ORDERS_JSON_PATH = path.join(__dirname, '../../data/orders.json');
const CONFIG_PATH = path.join(__dirname, '../../data/config.json');

let config = {};
try {
    if (fs.existsSync(CONFIG_PATH)) {
        config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
} catch (error) {
    log.error('Error loading config:', error.message);
}

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
            return { order, source };
        }
        
        if (i < maxRetries - 1) {
            const delay = 1000 * (i + 1);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    return { order: null, source: null };
}

function verifySignature(req) {
    if (!config.pakasir?.webhook_secret) return true;
    
    const signature = req.headers['x-pakasir-signature'] || req.headers['x-signature'];
    if (!signature) return false;
    
    const expectedSignature = crypto
        .createHmac('sha256', config.pakasir.webhook_secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
    
    return signature === expectedSignature;
}

router.post('/pakasir', async (req, res) => {
    try {
        log.info('📩 Webhook received at /api/webhook/pakasir');
        log.info('Headers:', JSON.stringify(req.headers, null, 2));
        log.info('Body:', JSON.stringify(req.body, null, 2));

        if (!verifySignature(req)) {
            log.warn('⚠️ Invalid webhook signature');
            return res.status(401).json({ error: 'Invalid signature' });
        }

        const { amount, order_id, status, payment_method, completed_at } = req.body;

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
                        productName: 'Product',
                        amount: order.amount,
                        orderId: order.orderId,
                        redeemCode: redeemCode,
                        customer: customerEmail,
                        username: order.username,
                        status: 'completed'
                    };

                    const sendResult = await whatsappBot.sendRedeemCode(customerEmail, emailData);
                    
                    if (sendResult && sendResult.success) {
                        log.info(`✅ Redeem code email sent to ${customerEmail}`);
                        
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

router.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'Webhook endpoint is working',
        endpoints: {
            webhook: 'POST /api/webhook/pakasir',
            test: 'GET /api/webhook/test'
        }
    });
});

router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        emailService: whatsappBot?.isReady ? 'ready' : 'not ready',
        database: db ? 'connected' : 'file-based',
        endpoints: [
            'POST /pakasir - Main webhook from Pakasir',
            'GET /test - Test endpoint',
            'GET /health - Health check'
        ]
    });
});

module.exports = router;
