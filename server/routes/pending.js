const express = require('express');
const router = express.Router();
const Order = require('../models/Order');

// GET pending.html page handler
router.get('/pending.html', async (req, res) => {
    try {
        const { order } = req.query;
        
        if (!order) {
            // Redirect to home if no order ID
            return res.redirect('/');
        }
        
        // Verify order exists
        const orderData = await Order.findByOrderId(order);
        if (!orderData) {
            return res.redirect('/error.html?message=Order tidak ditemukan');
        }
        
        // Check if order is already completed
        if (orderData.status === 'completed') {
            if (orderData.redeemCode) {
                return res.redirect(`/success.html?order=${order}&code=${orderData.redeemCode}`);
            } else {
                return res.redirect(`/success.html?order=${order}`);
            }
        }
        
        // Check if order is failed
        if (orderData.status === 'failed' || orderData.status === 'expired') {
            return res.redirect(`/failed.html?order=${order}`);
        }
        
        // Render pending page with order data
        res.sendFile('pending.html', { root: 'public' });
        
    } catch (error) {
        console.error('Error loading pending page:', error);
        res.redirect('/error.html?message=Terjadi kesalahan server');
    }
});

// API endpoint untuk halaman pending
router.get('/pending/status/:orderId', async (req, res) => {
    try {
        const order = await Order.findByOrderId(req.params.orderId);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }
        
        // Format response khusus untuk halaman pending
        const response = {
            success: true,
            order: {
                orderId: order.orderId,
                status: order.status,
                amount: order.amount,
                paymentMethod: order.paymentMethod,
                createdAt: order.createdAt,
                updatedAt: order.updatedAt,
                redeemCode: order.redeemCode
            },
            countdown: {
                // Default 15 minutes dari waktu order dibuat
                expiresAt: new Date(new Date(order.createdAt).getTime() + 15 * 60000),
                remainingMinutes: 15
            }
        };
        
        // Hitung waktu tersisa
        const created = new Date(order.createdAt);
        const expires = new Date(created.getTime() + 15 * 60000);
        const now = new Date();
        const remaining = expires - now;
        
        if (remaining > 0) {
            response.countdown.remainingMinutes = Math.ceil(remaining / 60000);
            response.countdown.remainingSeconds = Math.ceil((remaining % 60000) / 1000);
        } else {
            response.countdown.remainingMinutes = 0;
            response.countdown.remainingSeconds = 0;
            
            // Update order status jika waktu habis
            if (order.status === 'pending') {
                await Order.update(order.orderId, {
                    status: 'expired',
                    failedReason: 'Payment timeout',
                    failedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
                
                response.order.status = 'expired';
            }
        }
        
        res.json(response);
        
    } catch (error) {
        console.error('Error in pending status API:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get order status'
        });
    }
});

// API untuk mendapatkan payment link
router.get('/pending/payment-link/:orderId', async (req, res) => {
    try {
        const order = await Order.findByOrderId(req.params.orderId);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }
        
        // Generate payment link berdasarkan payment method
        let paymentUrl = '';
        const baseUrl = `https://app.pakasir.com/pay/${process.env.PAKASIR_SLUG || 'growlyy'}`;
        
        switch (order.paymentMethod) {
            case 'qris':
                paymentUrl = `${baseUrl}/${order.amount}?order_id=${order.orderId}&payment_method=qris`;
                break;
            case 'bni_va':
                paymentUrl = `${baseUrl}/${order.amount}?order_id=${order.orderId}&payment_method=va_bni`;
                break;
            case 'bri_va':
                paymentUrl = `${baseUrl}/${order.amount}?order_id=${order.orderId}&payment_method=va_bri`;
                break;
            case 'mandiri_va':
                paymentUrl = `${baseUrl}/${order.amount}?order_id=${order.orderId}&payment_method=va_mandiri`;
                break;
            default:
                paymentUrl = `${baseUrl}/${order.amount}?order_id=${order.orderId}`;
        }
        
        res.json({
            success: true,
            paymentUrl: paymentUrl,
            orderId: order.orderId,
            amount: order.amount,
            paymentMethod: order.paymentMethod
        });
        
    } catch (error) {
        console.error('Error generating payment link:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate payment link'
        });
    }
});

module.exports = router;