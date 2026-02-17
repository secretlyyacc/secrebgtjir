const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const pakasirService = require('../services/pakasir.service');
const whatsappBot = require('../models/WhatsAppBot');

const log = {
    info: (...args) => console.log(`[WEBHOOK] ${new Date().toISOString()} -`, ...args),
    error: (...args) => console.error(`[WEBHOOK ERROR] ${new Date().toISOString()} -`, ...args),
    warn: (...args) => console.warn(`[WEBHOOK WARN] ${new Date().toISOString()} -`, ...args)
};

const ORDERS_PATH = path.join(__dirname, '../../data/orders.json');
const ROLES_PATH = path.join(__dirname, '../../data/roles.json');
const CONFIG_PATH = path.join(__dirname, '../../data/config.json');

function readOrders() {
    try {
        if (fs.existsSync(ORDERS_PATH)) {
            return JSON.parse(fs.readFileSync(ORDERS_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        log.error('Error reading orders:', error);
        return [];
    }
}

function writeOrders(orders) {
    try {
        fs.writeFileSync(ORDERS_PATH, JSON.stringify(orders, null, 2));
        return true;
    } catch (error) {
        log.error('Error writing orders:', error);
        return false;
    }
}

function readRoles() {
    try {
        if (fs.existsSync(ROLES_PATH)) {
            return JSON.parse(fs.readFileSync(ROLES_PATH, 'utf8'));
        }
        return { roles: [] };
    } catch (error) {
        log.error('Error reading roles:', error);
        return { roles: [] };
    }
}

function readConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        }
        return {
            whatsapp: {
                adminNumber: 'growlycs@gmail.com',
                autoSend: true
            }
        };
    } catch (error) {
        log.error('Error reading config:', error);
        return { whatsapp: {} };
    }
}

function generateRedeemCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'GTPS-';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function getProductName(roleId) {
    try {
        const rolesData = readRoles();
        const role = rolesData.roles.find(r => r.id == roleId);
        return role ? role.name : 'Product';
    } catch (error) {
        return 'Product';
    }
}

router.post('/pakasir', async (req, res) => {
    try {
        const paymentData = req.body;
        log.info('📩 Webhook received from Pakasir:', paymentData);

        const { amount, order_id, project, status, payment_method, completed_at } = paymentData;

        if (!order_id || !amount || !status) {
            log.warn('Invalid webhook data - missing required fields');
            return res.status(400).json({ 
                error: 'Invalid data', 
                required: ['order_id', 'amount', 'status'] 
            });
        }

        const orders = readOrders();
        const orderIndex = orders.findIndex(o => o.orderId === order_id);

        if (orderIndex === -1) {
            log.warn(`Order not found: ${order_id}`);
            return res.json({ 
                received: true, 
                warning: 'Order not found in local database' 
            });
        }

        const order = orders[orderIndex];
        log.info(`Found order: ${order_id}`, { 
            currentStatus: order.status,
            username: order.username,
            amount: order.amount 
        });

        if (order.amount !== amount) {
            log.error(`Amount mismatch for order ${order_id}:`, {
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
                log.warn(`Order ${order_id} already completed, skipping`);
                return res.json({ 
                    received: true, 
                    message: 'Order already processed' 
                });
            }

            const redeemCode = generateRedeemCode();
            log.info(`Generated redeem code for ${order_id}: ${redeemCode}`);

            const updatedOrder = {
                ...order,
                status: 'completed',
                redeemCode: redeemCode,
                paymentMethod: payment_method || order.paymentMethod,
                pakasirData: {
                    amount: amount,
                    completed_at: completed_at,
                    payment_method: payment_method
                },
                completedAt: completed_at || new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            orders[orderIndex] = updatedOrder;
            
            if (writeOrders(orders)) {
                log.info(`✅ Order ${order_id} updated to completed`);
            } else {
                log.error(`Failed to write order ${order_id} to file`);
            }

            try {
                const customerEmail = order.username || order.customer;
                
                if (!customerEmail) {
                    log.warn(`No customer email found for order ${order_id}`);
                } else {
                    log.info(`Preparing to send redeem code to: ${customerEmail}`);

                    const emailData = {
                        productName: getProductName(order.roleId),
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
                        
                        orders[orderIndex] = {
                            ...updatedOrder,
                            emailSent: true,
                            emailSentAt: new Date().toISOString(),
                            emailMessageId: sendResult.messageId
                        };
                        writeOrders(orders);
                        
                    } else {
                        log.error(`Failed to send email to ${customerEmail}:`, sendResult?.error);
                        
                        orders[orderIndex] = {
                            ...updatedOrder,
                            emailSent: false,
                            emailError: sendResult?.error || 'Unknown error',
                            emailAttemptAt: new Date().toISOString()
                        };
                        writeOrders(orders);
                    }
                }

                const config = readConfig();
                const adminEmail = config.whatsapp?.adminNumber || 'growlycs@gmail.com';
                
                if (adminEmail) {
                    log.info(`Sending admin notification to: ${adminEmail}`);
                    
                    const adminData = {
                        productName: getProductName(order.roleId),
                        amount: order.amount,
                        orderId: order.orderId,
                        redeemCode: redeemCode,
                        customer: customerEmail || order.username,
                        username: order.username,
                        status: 'completed',
                        paymentMethod: payment_method || order.paymentMethod
                    };

                    await whatsappBot.sendOrderNotification(adminData);
                    log.info(`✅ Admin notification sent`);
                }

            } catch (emailError) {
                log.error('Error sending email notifications:', emailError);
                
                orders[orderIndex] = {
                    ...updatedOrder,
                    emailError: emailError.message,
                    emailAttemptAt: new Date().toISOString()
                };
                writeOrders(orders);
            }

            try {
                if (order.roleId) {
                    const rolesData = readRoles();
                    const roleIndex = rolesData.roles.findIndex(r => r.id == order.roleId);
                    
                    if (roleIndex !== -1) {
                        if (rolesData.roles[roleIndex].stock > 0) {
                            rolesData.roles[roleIndex].stock -= 1;
                            
                            fs.writeFileSync(ROLES_PATH, JSON.stringify(rolesData, null, 2));
                            log.info(`Stock updated for role ${order.roleId}: ${rolesData.roles[roleIndex].stock} remaining`);
                            
                            if (rolesData.roles[roleIndex].stock <= 2) {
                                log.warn(`Stock alert: ${rolesData.roles[roleIndex].name} only ${rolesData.roles[roleIndex].stock} left`);
                                await whatsappBot.sendStockNotification(rolesData.roles[roleIndex].name);
                            }
                        }
                    }
                }
            } catch (stockError) {
                log.error('Error updating stock:', stockError);
            }

        } else {
            log.info(`Order ${order_id} status: ${status}, no action needed`);
            
            if (order.status !== status) {
                orders[orderIndex] = {
                    ...order,
                    status: status,
                    pakasirStatus: status,
                    updatedAt: new Date().toISOString()
                };
                writeOrders(orders);
                log.info(`Order ${order_id} status updated to ${status}`);
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

        const orders = readOrders();
        const order = orders.find(o => o.orderId === orderId);

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const mockPaymentData = {
            amount: order.amount,
            order_id: orderId,
            project: process.env.PAKASIR_PROJECT_SLUG || 'test-project',
            status: status,
            payment_method: order.paymentMethod || 'qris',
            completed_at: new Date().toISOString()
        };

        log.info('Test webhook data:', mockPaymentData);

        req.body = mockPaymentData;
        
        res.json({
            success: true,
            message: 'Test webhook processed',
            data: mockPaymentData,
            note: 'This is a test endpoint. In production, actual webhook will come from Pakasir.'
        });

    } catch (error) {
        log.error('Test webhook error:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/email-status/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;

        const orders = readOrders();
        const order = orders.find(o => o.orderId === orderId);

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

        const orders = readOrders();
        const orderIndex = orders.findIndex(o => o.orderId === orderId);

        if (orderIndex === -1) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const order = orders[orderIndex];

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
            productName: getProductName(order.roleId),
            amount: order.amount,
            orderId: order.orderId,
            redeemCode: order.redeemCode,
            customer: customerEmail,
            username: order.username
        };

        const sendResult = await whatsappBot.sendRedeemCode(customerEmail, emailData);

        if (sendResult && sendResult.success) {
            orders[orderIndex] = {
                ...order,
                emailSent: true,
                emailSentAt: new Date().toISOString(),
                emailMessageId: sendResult.messageId,
                emailResendCount: (order.emailResendCount || 0) + 1
            };
            writeOrders(orders);

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

router.post('/simulate/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;

        const orders = readOrders();
        const order = orders.find(o => o.orderId === orderId);

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const simulationResult = await pakasirService.simulatePayment(orderId, order.amount);

        res.json({
            success: true,
            message: 'Payment simulation triggered',
            orderId: orderId,
            simulation: simulationResult,
            note: 'This will trigger a webhook from Pakasir in sandbox mode'
        });

    } catch (error) {
        log.error('Simulation error:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        emailService: whatsappBot.isReady ? 'ready' : 'not ready',
        endpoints: [
            'POST /pakasir - Main webhook from Pakasir',
            'POST /test/:orderId - Test webhook',
            'GET /email-status/:orderId - Check email status',
            'POST /resend-email/:orderId - Resend email',
            'POST /simulate/:orderId - Simulate payment'
        ]
    });
});

module.exports = router;
