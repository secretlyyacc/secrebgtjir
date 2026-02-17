const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// Load config
const configPath = path.join(__dirname, '../../data/config.json');
let config = { pakasir: {} };
try {
    if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        console.log('✅ Payment: Config loaded');
        console.log('📦 Raw pakasir config:', config.pakasir);
        console.log('📦 Using slug:', config.pakasir?.slug);
        console.log('📦 Using project (deprecated):', config.pakasir?.project);
    } else {
        console.warn('⚠️ Payment: Config file not found at', configPath);
    }
} catch (error) {
    console.error('❌ Payment: Error loading config:', error.message);
}

// Get available payment methods
router.get('/methods', (req, res) => {
    try {
        const methods = [
            { id: 'qris', name: 'QRIS', icon: '/img/qris.png', fee: 0 },
            { id: 'bri_va', name: 'BRI Virtual Account', icon: '/img/bri.png', fee: 4000 },
            { id: 'bni_va', name: 'BNI Virtual Account', icon: '/img/bni.png', fee: 4000 },
            { id: 'mandiri_va', name: 'Mandiri Virtual Account', icon: '/img/mandiri.png', fee: 4000 },
            { id: 'cimb_va', name: 'CIMB Niaga Virtual Account', icon: '/img/cimb.png', fee: 4000 },
            { id: 'paypal', name: 'PayPal', icon: '/img/paypal.png', fee: '4.4% + $0.30' }
        ];
        
        console.log('📋 Payment methods fetched');
        res.json({ success: true, methods });
    } catch (error) {
        console.error('❌ Error fetching payment methods:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch payment methods' });
    }
});

// Create payment (API integration - display QR/VA on your site)
// server/routes/payment.js (bagian create)
router.post('/create', async (req, res) => {
    try {
        const { username, roleId, paymentMethod } = req.body;
        
        console.log('🛒 Payment create request:', { username, roleId, paymentMethod });
        
        if (!username || !roleId || !paymentMethod) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required fields' 
            });
        }
        
        // Load products from roles.json
        const rolesPath = path.join(__dirname, '../../data/roles.json');
        let product = null;
        
        try {
            const rolesData = JSON.parse(fs.readFileSync(rolesPath, 'utf8'));
            
            if (rolesData.roles && Array.isArray(rolesData.roles)) {
                product = rolesData.roles.find(r => r.id === roleId);
                console.log('✅ Products loaded from roles.roles array');
            } 
            else if (Array.isArray(rolesData)) {
                product = rolesData.find(r => r.id === roleId);
                console.log('✅ Products loaded as array');
            }
            else {
                product = rolesData[roleId];
                if (product) {
                    product.id = roleId;
                }
                console.log('✅ Products loaded as object');
            }
            
        } catch (error) {
            console.error('❌ Error loading products:', error.message);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to load products configuration' 
            });
        }
        
        if (!product) {
            console.log('⚠️ Product not found:', roleId);
            return res.status(404).json({ 
                success: false, 
                error: 'Product not found' 
            });
        }
        
        const amount = parseInt(product.price) || 0;
        if (amount <= 0) {
            console.log('⚠️ Invalid price for product:', roleId, product.price);
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid product price' 
            });
        }
        
        console.log('✅ Product found:', product.name, 'price:', amount);
        
        // Get config
        const configPath = path.join(__dirname, '../../data/config.json');
        let config = { pakasir: {} };
        if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
        
        const projectSlug = config.pakasir?.slug || 'gtps-shop';
        console.log('📦 Using project slug for payment:', projectSlug);
        
        const orderId = 'GTPS-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
        
        let paymentData = {};
        
        if (paymentMethod === 'paypal') {
            const amountInUSD = amount / 15000;
            paymentData = {
                type: 'paypal',
                url: `https://app.pakasir.com/paypal/${projectSlug}/${amount}?order_id=${orderId}`,
                amountInUSD: amountInUSD.toFixed(2),
                fee: {
                    pakasir: 3000,
                    paypal: '4.4% + $0.30'
                }
            };
        } else {
            let url = `https://app.pakasir.com/pay/${projectSlug}/${amount}?order_id=${orderId}`;
            
            if (paymentMethod === 'qris') {
                url += '&qris_only=1';
            }
            
            paymentData = {
                type: 'redirect',
                url: url
            };
        }
        
        console.log('✅ Payment created:', { orderId, amount, method: paymentMethod, url: paymentData.url });
        
        // Save order to SQLite database
        const Order = require('../models/Order');
        await Order.create({
            orderId,
            username,
            role: product.name,
            productId: product.id,
            amount,
            status: 'pending',
            paymentMethod
        });
        
        res.json({
            success: true,
            orderId,
            amount,
            role: product.name,
            productId: product.id,
            payment: paymentData,
            expiresIn: 3600
        });
        
    } catch (error) {
        console.error('❌ Payment creation error:', error.message);
        console.error(error.stack);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to create payment',
            message: error.message 
        });
    }
});

// Check payment status
router.get('/status/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        console.log('🔍 Checking payment status for:', orderId);
        
        const Order = require('../models/Order');
        const order = await Order.findByOrderId(orderId);
        
        if (!order) {
            return res.status(404).json({ success: false, error: 'Order not found' });
        }
        
        res.json({
            success: true,
            status: order.status,
            orderId: order.orderId,
            amount: order.amount,
            redeemCode: order.redeemCode || null
        });
        
    } catch (error) {
        console.error('❌ Status check error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Payment webhook (untuk Pakasir)
router.post('/webhook/pakasir', async (req, res) => {
    try {
        const data = req.body;
        console.log('📩 Pakasir webhook received:', JSON.stringify(data, null, 2));
        
        const { order_id, status, amount } = data;
        
        if (!order_id) {
            return res.status(400).json({ error: 'Missing order_id' });
        }
        
        const Order = require('../models/Order');
        const order = await Order.findByOrderId(order_id);
        
        if (!order) {
            console.log('⚠️ Order not found:', order_id);
            return res.status(404).json({ error: 'Order not found' });
        }
        
        if (status === 'completed' || status === 'success') {
            console.log('✅ Payment completed for:', order_id);
            
            const RedeemCode = require('../models/RedeemCode');
            const redeemCode = await RedeemCode.getAvailableCode(order.role);
            
            if (redeemCode) {
                await RedeemCode.markAsUsed(redeemCode.code, order.username, order_id);
                
                await Order.update(order_id, {
                    status: 'completed',
                    redeemCode: redeemCode.code,
                    completedAt: new Date().toISOString()
                });
                
                try {
                    const whatsappBot = require('../models/WhatsAppBot');
                    await whatsappBot.sendRedeemCode(order.username, {
                        orderId: order_id,
                        productName: order.role,
                        amount: order.amount,
                        redeemCode: redeemCode.code
                    });
                    console.log('📧 Email notification sent');
                } catch (emailError) {
                    console.error('❌ Email error:', emailError.message);
                }
                
            } else {
                console.log('⚠️ No redeem code available for role:', order.role);
                await Order.update(order_id, {
                    status: 'failed',
                    failedReason: 'Out of stock'
                });
            }
            
        } else if (status === 'pending') {
            await Order.update(order_id, { status: 'pending' });
        } else {
            await Order.update(order_id, { status: 'failed' });
        }
        
        res.json({ received: true });
        
    } catch (error) {
        console.error('❌ Webhook error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Redirect after payment
router.get('/redirect/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        console.log('↪️ Payment redirect for:', orderId);
        
        const Order = require('../models/Order');
        const order = await Order.findByOrderId(orderId);
        
        if (!order) {
            return res.redirect('/error.html?message=Order not found');
        }
        
        if (order.status === 'completed') {
            res.redirect(`/success.html?order=${orderId}&code=${order.redeemCode || ''}`);
        } else if (order.status === 'failed') {
            res.redirect(`/failed.html?order=${orderId}`);
        } else {
            res.redirect(`/pending.html?order=${orderId}`);
        }
        
    } catch (error) {
        console.error('❌ Redirect error:', error.message);
        res.redirect('/error.html?message=Server error');
    }
});

// Create payment (Redirect method - send user to Pakasir page)
router.post('/create-redirect', async (req, res) => {
    try {
        const { username, roleId, amount, qrisOnly, redirectUrl } = req.body;
        
        const orderId = 'INV-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7).toUpperCase();
        
        const Order = require('../models/Order');
        await Order.create({
            orderId,
            username,
            role: roleId,
            amount: parseInt(amount) || 0,
            status: 'pending',
            paymentMethod: qrisOnly ? 'qris' : 'redirect'
        });
        
        // FIX: Use slug from config, not project
        const projectSlug = config.pakasir?.slug || 'gtps-shop';
        console.log('📦 Using project slug for redirect:', projectSlug);
        
        let paymentUrl = `https://app.pakasir.com/pay/${projectSlug}/${amount}?order_id=${orderId}`;
        
        if (qrisOnly === 'true') {
            paymentUrl += '&qris_only=1';
        }
        
        if (redirectUrl) {
            paymentUrl += `&redirect=${encodeURIComponent(redirectUrl)}`;
        }
        
        res.json({
            success: true,
            orderId,
            redirectUrl: paymentUrl,
            message: 'Redirect to payment page'
        });
        
    } catch (error) {
        console.error('❌ Payment creation error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to create payment' 
        });
    }
});

// Create PayPal payment
router.post('/create-paypal', async (req, res) => {
    try {
        const { username, roleId, amount } = req.body;
        
        const amountInUSD = amount / 15000;
        
        const orderId = 'PAYPAL-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7).toUpperCase();
        
        const Order = require('../models/Order');
        await Order.create({
            orderId,
            username,
            role: roleId,
            amount: parseInt(amount) || 0,
            status: 'pending',
            paymentMethod: 'paypal'
        });
        
        // FIX: Use slug from config, not project
        const projectSlug = config.pakasir?.slug || 'gtps-shop';
        console.log('📦 Using project slug for PayPal:', projectSlug);
        
        const paypalUrl = `https://app.pakasir.com/paypal/${projectSlug}/${amount}?order_id=${orderId}`;
        
        res.json({
            success: true,
            orderId,
            redirectUrl: paypalUrl,
            amountInUSD: amountInUSD.toFixed(2),
            fee: {
                pakasir: 3000,
                paypal: '4.4% + $0.30'
            },
            message: 'Redirect to PayPal'
        });
        
    } catch (error) {
        console.error('❌ PayPal payment error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to create PayPal payment' 
        });
    }
});

// Cancel transaction
router.post('/cancel/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        
        const Order = require('../models/Order');
        const order = await Order.findByOrderId(orderId);
        
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        await Order.update(orderId, {
            status: 'cancelled',
            cancelledAt: new Date().toISOString()
        });
        
        res.json({
            success: true,
            message: 'Transaction cancelled'
        });
        
    } catch (error) {
        console.error('❌ Cancel error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to cancel transaction' 
        });
    }
});

// Simulate payment (sandbox only)
router.post('/simulate/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        
        const Order = require('../models/Order');
        const order = await Order.findByOrderId(orderId);
        
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        await Order.update(orderId, {
            status: 'completed',
            completedAt: new Date().toISOString()
        });
        
        res.json({
            success: true,
            message: 'Payment simulated'
        });
        
    } catch (error) {
        console.error('❌ Simulation error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to simulate payment' 
        });
    }
});

// Payment completion page
router.get('/complete', (req, res) => {
    const { order_id, status } = req.query;
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Payment Complete - LyyShop ID</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-100">
            <div class="container mx-auto p-8 text-center">
                <div class="bg-white rounded-lg shadow p-8 max-w-md mx-auto">
                    <div class="text-6xl mb-4">✅</div>
                    <h1 class="text-2xl font-bold mb-4">Payment ${status || 'Completed'}!</h1>
                    <p class="text-gray-600 mb-2">Order ID: ${order_id || 'N/A'}</p>
                    <p class="text-gray-600 mb-6">Your payment has been processed successfully.</p>
                    <a href="/" class="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600">
                        Back to Home
                    </a>
                </div>
            </div>
        </body>
        </html>
    `);
});

module.exports = router;
