// server/routes/admin/orders-accounts.js
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../../middleware/auth');
const { db, Account } = require('../../config/database');
const whatsappBot = require('../../models/WhatsAppBot');
const fs = require('fs');
const path = require('path');

// ==================== ACCOUNTS ROUTES ====================

/**
 * GET /api/admin/accounts
 * Get all accounts with pagination and filters
 */
// ==================== ACCOUNTS ROUTES ====================

/**
 * GET /api/admin/accounts
 * Get all accounts with pagination and filters
 */
router.get('/accounts', authenticateToken, async (req, res) => {
    try {
        console.log('📦 Fetching accounts with filters:', req.query);
        console.log('🔑 Admin ID:', req.admin?.id);
        
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        const filters = {
            product_id: req.query.product_id,
            status: req.query.status,
            limit,
            offset
        };

        console.log('🔍 Filters:', filters);

        // Get accounts with pagination
        const accounts = await Account.getAll(filters);
        console.log(`✅ Found ${accounts.length} accounts`);
        
        // Get total stats
        const stats = await Account.getStats();
        console.log('📊 Account stats:', stats);

        // If product_id is specified, also get stock count for that product
        if (req.query.product_id) {
            const stock = await Account.getStock(req.query.product_id);
            console.log(`📦 Stock for ${req.query.product_id}: ${stock}`);
        }

        res.json({ 
            success: true, 
            accounts: accounts || [],
            pagination: {
                page,
                limit,
                total: stats?.total || 0,
                pages: Math.ceil((stats?.total || 0) / limit)
            }
        });

    } catch (error) {
        console.error('❌ Get accounts error:', error);
        console.error('Stack:', error.stack);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to load accounts',
            details: error.toString()
        });
    }
});

/**
 * POST /api/admin/accounts/upload
 * Upload multiple accounts from JSON
 */
router.post('/accounts/upload', authenticateToken, async (req, res) => {
    try {
        const { productId, accounts } = req.body;

        if (!productId || !accounts || !Array.isArray(accounts)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Product ID and accounts array are required' 
            });
        }

        if (accounts.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Accounts array cannot be empty' 
            });
        }

        console.log(`📤 Uploading ${accounts.length} accounts for product: ${productId}`);

        // Validate each account has required fields
        const invalidAccounts = accounts.filter(acc => !acc.email || !acc.password);
        if (invalidAccounts.length > 0) {
            return res.status(400).json({ 
                success: false, 
                error: `${invalidAccounts.length} accounts missing email or password` 
            });
        }

        // Add accounts to database
        const result = await Account.addAccounts(accounts.map(acc => ({
            productId,
            email: acc.email.trim(),
            password: acc.password,
            twofa: acc.twofa || acc.twofa_code || null,
            additional: acc.additional || {}
        })));

        // Update product stock in product.json
        const rolesPath = path.join(__dirname, '../../../data/product.json');
        if (fs.existsSync(rolesPath)) {
            try {
                const rolesData = JSON.parse(fs.readFileSync(rolesPath, 'utf8'));
                const roleIndex = (rolesData.roles || []).findIndex(r => r.id === productId);
                if (roleIndex !== -1) {
                    const stock = await Account.getStock(productId);
                    rolesData.roles[roleIndex].stock = stock;
                    fs.writeFileSync(rolesPath, JSON.stringify(rolesData, null, 2));
                    console.log(`📊 Updated stock for ${productId}: ${stock}`);
                }
            } catch (e) {
                console.error('Error updating product.json:', e);
            }
        }

        res.json({ 
            success: true, 
            message: `${result.added} accounts uploaded successfully`,
            errors: result.errors.length > 0 ? result.errors : undefined
        });

    } catch (error) {
        console.error('❌ Upload accounts error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to upload accounts'
        });
    }
});

/**
 * GET /api/admin/accounts/stats
 * Get account statistics
 */
router.get('/accounts/stats', authenticateToken, async (req, res) => {
    try {
        const stats = await Account.getStats();
        res.json({ 
            success: true, 
            stats: {
                total: stats.total || 0,
                available: stats.available || 0,
                sold: stats.sold || 0
            }
        });
    } catch (error) {
        console.error('❌ Account stats error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to load stats'
        });
    }
});

/**
 * GET /api/admin/accounts/:id
 * Get single account by ID
 */
router.get('/accounts/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        const account = await Account.getById(id);

        if (!account) {
            return res.status(404).json({ 
                success: false, 
                error: 'Account not found' 
            });
        }

        res.json({ 
            success: true, 
            account 
        });

    } catch (error) {
        console.error('❌ Get account error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to load account'
        });
    }
});

/**
 * DELETE /api/admin/accounts/:id
 * Delete an account (only if available)
 */
router.delete('/accounts/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Get account first to check status
        const account = await Account.getById(id);

        if (!account) {
            return res.status(404).json({ 
                success: false, 
                error: 'Account not found' 
            });
        }

        // Prevent deletion of sold accounts
        if (account.status === 'sold') {
            return res.status(400).json({ 
                success: false, 
                error: 'Cannot delete sold accounts' 
            });
        }

        // Delete the account
        await Account.delete(id);

        // Update product stock in product.json
        if (account.product_id) {
            const rolesPath = path.join(__dirname, '../../../data/product.json');
            if (fs.existsSync(rolesPath)) {
                try {
                    const rolesData = JSON.parse(fs.readFileSync(rolesPath, 'utf8'));
                    const roleIndex = (rolesData.roles || []).findIndex(r => r.id === account.product_id);
                    if (roleIndex !== -1) {
                        const stock = await Account.getStock(account.product_id);
                        rolesData.roles[roleIndex].stock = stock;
                        fs.writeFileSync(rolesPath, JSON.stringify(rolesData, null, 2));
                    }
                } catch (e) {
                    console.error('Error updating product.json:', e);
                }
            }
        }

        res.json({ 
            success: true, 
            message: 'Account deleted successfully' 
        });

    } catch (error) {
        console.error('❌ Delete account error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to delete account'
        });
    }
});

// ==================== ORDERS ROUTES ====================

/**
 * GET /api/admin/orders
 * Get all orders with pagination and filters
 */
router.get('/orders', authenticateToken, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        let sql = `SELECT * FROM orders WHERE 1=1`;
        const params = [];

        // Filter by status
        if (req.query.status) {
            sql += ` AND status = ?`;
            params.push(req.query.status);
        }

        // Filter by product
        if (req.query.product) {
            sql += ` AND role = ?`;
            params.push(req.query.product);
        }

        // Search by orderId or username
        if (req.query.search) {
            sql += ` AND (orderId LIKE ? OR username LIKE ?)`;
            params.push(`%${req.query.search}%`, `%${req.query.search}%`);
        }

        // Get total count for pagination
        const countResult = await new Promise((resolve, reject) => {
            db.get(`SELECT COUNT(*) as count FROM orders WHERE 1=1`, [], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        const total = countResult?.count || 0;

        // Add pagination
        sql += ` ORDER BY createdAt DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        // Get orders
        const orders = await new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Load product names from product.json
        const rolesPath = path.join(__dirname, '../../../data/product.json');
        let roles = [];
        if (fs.existsSync(rolesPath)) {
            try {
                const rolesData = JSON.parse(fs.readFileSync(rolesPath, 'utf8'));
                roles = rolesData.roles || [];
            } catch (e) {
                console.error('Error reading product.json:', e);
            }
        }

        // Add product names to orders
        const ordersWithNames = orders.map(order => ({
            ...order,
            productName: roles.find(r => r.id === order.role)?.name || order.role,
            accountData: order.accountData ? JSON.parse(order.accountData) : null
        }));

        res.json({
            success: true,
            orders: ordersWithNames,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('❌ Orders error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to load orders'
        });
    }
});

/**
 * POST /api/admin/orders/:orderId/complete
 * Manually complete an order and send account to customer
 */
router.post('/orders/:orderId/complete', authenticateToken, async (req, res) => {
    try {
        const { orderId } = req.params;
        const { accountId } = req.body;

        if (!accountId) {
            return res.status(400).json({ 
                success: false, 
                error: 'Account ID is required' 
            });
        }

        console.log(`✅ Completing order ${orderId} with account ${accountId}`);

        // Get order from database
        const order = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM orders WHERE orderId = ?', [orderId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!order) {
            return res.status(404).json({ 
                success: false, 
                error: 'Order not found' 
            });
        }

        // Check if order is pending
        if (order.status !== 'pending') {
            return res.status(400).json({ 
                success: false, 
                error: `Order is not pending (current status: ${order.status})` 
            });
        }

        // Get account by ID
        const account = await Account.getById(accountId);
        if (!account) {
            return res.status(404).json({ 
                success: false, 
                error: 'Account not found' 
            });
        }

        // Check if account is available
        if (account.status !== 'available') {
            return res.status(400).json({ 
                success: false, 
                error: `Account is not available (status: ${account.status})` 
            });
        }

        // Mark account as sold
        const soldAccount = await Account.markAsSold(account.product_id, orderId, order.username);
        
        if (!soldAccount) {
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to mark account as sold' 
            });
        }

        // Update order status to completed
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE orders SET 
                    status = 'completed',
                    accountData = ?,
                    completedAt = CURRENT_TIMESTAMP,
                    updatedAt = CURRENT_TIMESTAMP
                WHERE orderId = ?`,
                [JSON.stringify(soldAccount), orderId],
                function(err) {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Get product name from product.json
        const rolesPath = path.join(__dirname, '../../../data/product.json');
        let productName = order.role;
        if (fs.existsSync(rolesPath)) {
            try {
                const rolesData = JSON.parse(fs.readFileSync(rolesPath, 'utf8'));
                const role = (rolesData.roles || []).find(r => r.id === order.role);
                if (role) productName = role.name;
            } catch (e) {
                console.error('Error reading product.json:', e);
            }
        }

        // Send email to customer with account details
        try {
            await whatsappBot.sendAccountEmail(order.username, {
                orderId: order.orderId,
                productName: productName,
                amount: order.amount,
                accountData: soldAccount,
                customer: order.username,
                paymentMethod: order.paymentMethod
            });
            console.log(`✅ Email sent to ${order.username} for order ${orderId}`);
        } catch (emailError) {
            console.error('❌ Email sending failed:', emailError);
            // Don't fail the order if email fails, just log it
        }

        // Update role stock in product.json
        if (fs.existsSync(rolesPath)) {
            try {
                const rolesData = JSON.parse(fs.readFileSync(rolesPath, 'utf8'));
                const roleIndex = (rolesData.roles || []).findIndex(r => r.id === order.role);
                if (roleIndex !== -1) {
                    const stock = await Account.getStock(order.role);
                    rolesData.roles[roleIndex].stock = stock;
                    fs.writeFileSync(rolesPath, JSON.stringify(rolesData, null, 2));
                    console.log(`📊 Updated stock for ${order.role}: ${stock}`);
                }
            } catch (e) {
                console.error('Error updating product.json stock:', e);
            }
        }

        res.json({ 
            success: true, 
            message: 'Order completed successfully',
            account: {
                email: soldAccount.email,
                product: soldAccount.product_id
            }
        });

    } catch (error) {
        console.error('❌ Complete order error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to complete order'
        });
    }
});

/**
 * POST /api/admin/orders/:orderId/cancel
 * Cancel a pending order
 */
router.post('/orders/:orderId/cancel', authenticateToken, async (req, res) => {
    try {
        const { orderId } = req.params;
        const { reason } = req.body;

        // Get order from database
        const order = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM orders WHERE orderId = ?', [orderId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!order) {
            return res.status(404).json({ 
                success: false, 
                error: 'Order not found' 
            });
        }

        // Check if order is pending
        if (order.status !== 'pending') {
            return res.status(400).json({ 
                success: false, 
                error: `Order is not pending (current status: ${order.status})` 
            });
        }

        // Update order status to cancelled
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE orders SET 
                    status = 'cancelled',
                    failedReason = ?,
                    failedAt = CURRENT_TIMESTAMP,
                    updatedAt = CURRENT_TIMESTAMP
                WHERE orderId = ?`,
                [reason || 'Cancelled by admin', orderId],
                function(err) {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        res.json({ 
            success: true, 
            message: 'Order cancelled successfully' 
        });

    } catch (error) {
        console.error('❌ Cancel order error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to cancel order'
        });
    }
});

module.exports = router;