// server/routes/admin/accounts.js
const express = require('express');
const router = express.Router();
const { Account } = require('../../config/database');
const path = require('path');
const fs = require('fs');

// ==================== PRODUCT UPDATE ENDPOINT ====================
router.put('/products/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { price, description, stock } = req.body;
        
        console.log('📝 Updating product:', id, { price, description, stock });
        
        const rolesPath = path.join(__dirname, '../../../data/product.json');
        
        if (!fs.existsSync(rolesPath)) {
            return res.status(404).json({ 
                success: false, 
                error: 'Product file not found' 
            });
        }
        
        const rolesData = JSON.parse(fs.readFileSync(rolesPath, 'utf8'));
        const productIndex = rolesData.roles.findIndex(p => p.id === id);
        
        if (productIndex === -1) {
            return res.status(404).json({ 
                success: false, 
                error: 'Product not found' 
            });
        }
        
        if (price !== undefined) {
            rolesData.roles[productIndex].price = price.toString();
        }
        
        if (description !== undefined) {
            rolesData.roles[productIndex].description = description;
        }
        
        if (stock !== undefined) {
            rolesData.roles[productIndex].stock = stock.toString();
        }
        
        fs.writeFileSync(rolesPath, JSON.stringify(rolesData, null, 2));
        
        console.log('✅ Product updated successfully');
        
        res.json({ 
            success: true, 
            message: 'Product updated successfully',
            product: rolesData.roles[productIndex]
        });
        
    } catch (error) {
        console.error('❌ Error updating product:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to update product' 
        });
    }
});

// ==================== ACCOUNTS ROUTES ====================
router.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        
        const accounts = await Account.getAll({
            product_id: req.query.product_id,
            status: req.query.status,
            limit,
            offset
        });
        
        const total = await Account.getStats();
        
        res.json({ 
            success: true, 
            accounts,
            pagination: {
                page,
                limit,
                total: total.total,
                pages: Math.ceil(total.total / limit)
            }
        });
    } catch (error) {
        console.error('Error getting accounts:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/upload', async (req, res) => {
    try {
        const { productId, accounts } = req.body;
        
        if (!productId || !accounts || !Array.isArray(accounts)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Product ID and accounts array are required' 
            });
        }
        
        console.log(`📤 Uploading ${accounts.length} accounts for product: ${productId}`);
        
        const result = await Account.addAccounts(accounts.map(acc => ({
            productId,
            email: acc.email,
            password: acc.password,
            twofa: acc.twofa || acc.twofa_code || null,
            additional: acc.additional || {}
        })));
        
        const rolesPath = path.join(__dirname, '../../../data/product.json');
        if (fs.existsSync(rolesPath)) {
            const rolesData = JSON.parse(fs.readFileSync(rolesPath, 'utf8'));
            const productIndex = rolesData.roles.findIndex(r => r.id === productId);
            if (productIndex !== -1) {
                const stock = await Account.getStock(productId);
                rolesData.roles[productIndex].stock = stock.toString();
                fs.writeFileSync(rolesPath, JSON.stringify(rolesData, null, 2));
            }
        }
        
        res.json({ 
            success: true, 
            message: `${result.added} accounts added successfully`,
            errors: result.errors.length > 0 ? result.errors : undefined
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const account = await Account.getById(id);
        if (!account) {
            return res.status(404).json({ success: false, error: 'Account not found' });
        }
        
        if (account.status === 'sold') {
            return res.status(400).json({ 
                success: false, 
                error: 'Cannot delete sold accounts' 
            });
        }
        
        await Account.delete(id);
        
        const rolesPath = path.join(__dirname, '../../../data/product.json');
        if (fs.existsSync(rolesPath) && account.product_id) {
            const rolesData = JSON.parse(fs.readFileSync(rolesPath, 'utf8'));
            const productIndex = rolesData.roles.findIndex(r => r.id === account.product_id);
            if (productIndex !== -1) {
                const stock = await Account.getStock(account.product_id);
                rolesData.roles[productIndex].stock = stock.toString();
                fs.writeFileSync(rolesPath, JSON.stringify(rolesData, null, 2));
            }
        }
        
        res.json({ success: true, message: 'Account deleted successfully' });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/stats', async (req, res) => {
    try {
        const stats = await Account.getStats();
        res.json({ success: true, stats });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const account = await Account.getById(id);
        
        if (!account) {
            return res.status(404).json({ success: false, error: 'Account not found' });
        }
        
        res.json({ success: true, account });
    } catch (error) {
        console.error('Error getting account:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        const account = await Account.getById(id);
        if (!account) {
            return res.status(404).json({ success: false, error: 'Account not found' });
        }
        
        if (account.status === 'sold') {
            return res.status(400).json({ 
                success: false, 
                error: 'Cannot update sold accounts' 
            });
        }
        
        await Account.update(id, updates);
        
        const updatedAccount = await Account.getById(id);
        res.json({ success: true, account: updatedAccount });
    } catch (error) {
        console.error('Update error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
