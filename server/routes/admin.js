const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');
const Order = require('../models/Order');
const RedeemCode = require('../models/RedeemCode');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');
const roles = require('../../data/roles.json');

// Admin Login - FIXED VERSION
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Check admin using SQLite method
        const admin = await Admin.findByUsername(username);
        if (!admin) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }
        
        // Check password using bcrypt
        const validPassword = await bcrypt.compare(password, admin.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }
        
        // Create token
        const token = jwt.sign(
            { 
                id: admin.id, 
                username: admin.username, 
                role: admin.role 
            },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({
            success: true,
            token,
            admin: {
                id: admin.id,
                username: admin.username,
                role: admin.role
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get Dashboard Stats
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        // Get counts using SQLite methods
        const totalOrders = await Order.count();
        const completedOrders = await Order.count({ status: 'completed' });
        const pendingOrders = await Order.count({ status: 'pending' });
        
        // Get revenue
        const revenueData = await Order.getRevenue();
        
        // Get recent orders
        const recentOrders = await Order.findAll({ limit: 10 });
        
        // Get role stats
        const allOrders = await Order.findAll();
        const roleStats = {};
        
        allOrders.forEach(order => {
            if (!roleStats[order.role]) {
                roleStats[order.role] = { count: 0, revenue: 0 };
            }
            roleStats[order.role].count++;
            if (order.status === 'completed') {
                roleStats[order.role].revenue += order.amount;
            }
        });
        
        // Convert to array
        const roleStatsArray = Object.keys(roleStats).map(role => ({
            role,
            count: roleStats[role].count,
            revenue: roleStats[role].revenue
        }));
        
        res.json({
            stats: {
                totalOrders,
                completedOrders,
                pendingOrders,
                totalRevenue: revenueData.totalRevenue || 0,
                completedRevenue: revenueData.completedRevenue || 0
            },
            recentOrders,
            roleStats: roleStatsArray,
            roles: roles.roles
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get All Orders
router.get('/orders', authenticateToken, async (req, res) => {
    try {
        const { page = 1, limit = 20, status, role } = req.query;
        
        const filters = {};
        if (status) filters.status = status;
        if (role) filters.role = role;
        
        // Get orders with pagination
        const allOrders = await Order.findAll(filters);
        
        // Manual pagination
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const orders = allOrders.slice(startIndex, endIndex);
        
        res.json({
            orders,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: allOrders.length,
                pages: Math.ceil(allOrders.length / limit)
            }
        });
    } catch (error) {
        console.error('Orders error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get Order Details
router.get('/orders/:orderId', authenticateToken, async (req, res) => {
    try {
        const order = await Order.findByOrderId(req.params.orderId);
        
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        res.json({ order });
    } catch (error) {
        console.error('Order details error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get Redeem Codes
router.get('/redeem-codes', authenticateToken, async (req, res) => {
    try {
        const { page = 1, limit = 20, used, role } = req.query;
        
        const filters = {};
        if (used !== undefined) filters.used = used === 'true';
        if (role) filters.role = role;
        
        // Get all codes
        const allCodes = await RedeemCode.findAll(filters);
        
        // Manual pagination
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const codes = allCodes.slice(startIndex, endIndex);
        
        res.json({
            codes,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: allCodes.length,
                pages: Math.ceil(allCodes.length / limit)
            }
        });
    } catch (error) {
        console.error('Redeem codes error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add New Redeem Codes
router.post('/redeem-codes/add', authenticateToken, async (req, res) => {
    try {
        const { role, quantity = 1 } = req.body;
        
        if (!role) {
            return res.status(400).json({ error: 'Role is required' });
        }
        
        const codes = [];
        const addedCodes = [];
        const errors = [];
        
        // Generate codes
        for (let i = 0; i < quantity; i++) {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let randomCode = '';
            
            for (let j = 0; j < 8; j++) {
                randomCode += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            
            const fullCode = `GrowLyy-${role.toUpperCase()}-${randomCode}`;
            
            try {
                await RedeemCode.create({
                    code: fullCode,
                    role: role,
                    used: false
                });
                
                addedCodes.push(fullCode);
                codes.push({ code: fullCode, role });
            } catch (error) {
                errors.push(`Failed to add code ${fullCode}: ${error.message}`);
            }
        }
        
        // Update stock in roles.json
        if (addedCodes.length > 0) {
            const fs = require('fs').promises;
            const path = require('path');
            
            try {
                const rolesPath = path.join(__dirname, '../../data/roles.json');
                const data = await fs.readFile(rolesPath, 'utf8');
                const rolesData = JSON.parse(data);
                
                const roleIndex = rolesData.roles.findIndex(r => r.id === role);
                if (roleIndex !== -1) {
                    rolesData.roles[roleIndex].stock += addedCodes.length;
                    await fs.writeFile(rolesPath, JSON.stringify(rolesData, null, 2), 'utf8');
                }
            } catch (error) {
                console.error('Error updating stock:', error);
            }
        }
        
        res.json({
            success: true,
            message: `Added ${addedCodes.length} redeem codes for ${role}`,
            added: addedCodes.length,
            failed: errors.length,
            codes: addedCodes,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        console.error('Add codes error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update Role Price/Stock
router.put('/roles/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { price, stock } = req.body;
        
        const fs = require('fs').promises;
        const path = require('path');
        
        const rolesPath = path.join(__dirname, '../../data/roles.json');
        const data = await fs.readFile(rolesPath, 'utf8');
        const rolesData = JSON.parse(data);
        
        const roleIndex = rolesData.roles.findIndex(r => r.id === id);
        if (roleIndex === -1) {
            return res.status(404).json({ error: 'Role not found' });
        }
        
        if (price !== undefined) rolesData.roles[roleIndex].price = price;
        if (stock !== undefined) rolesData.roles[roleIndex].stock = stock;
        
        await fs.writeFile(rolesPath, JSON.stringify(rolesData, null, 2), 'utf8');
        
        res.json({
            success: true,
            role: rolesData.roles[roleIndex]
        });
    } catch (error) {
        console.error('Update role error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get All Admins
router.get('/admins', authenticateToken, async (req, res) => {
    try {
        const admins = await Admin.findAll();
        res.json({ admins });
    } catch (error) {
        console.error('Get admins error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create New Admin
router.post('/admins', authenticateToken, async (req, res) => {
    try {
        const { username, password, role } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }
        
        // Check if admin already exists
        const existingAdmin = await Admin.findByUsername(username);
        if (existingAdmin) {
            return res.status(400).json({ error: 'Admin already exists' });
        }
        
        const admin = await Admin.create({
            username,
            password,
            role: role || 'admin'
        });
        
        // Remove password from response
        delete admin.password;
        
        res.json({
            success: true,
            message: 'Admin created successfully',
            admin
        });
    } catch (error) {
        console.error('Create admin error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Change Admin Password
router.put('/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const username = req.admin.username;
        
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current and new password are required' });
        }
        
        // Verify current password
        const admin = await Admin.findByUsername(username);
        if (!admin) {
            return res.status(404).json({ error: 'Admin not found' });
        }
        
        const validPassword = await bcrypt.compare(currentPassword, admin.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Current password is incorrect' });
        }
        
        // Update password
        await Admin.update(username, { password: newPassword });
        
        res.json({
            success: true,
            message: 'Password changed successfully'
        });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;