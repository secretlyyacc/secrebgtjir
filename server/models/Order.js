// server/models/Order.js
const db = require('../config/database');

const Order = {
    // Create new order
    async create(orderData) {
        const sql = `
            INSERT INTO orders (
                orderId, username, role, amount, status, 
                paymentMethod, productId, accountData
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const params = [
            orderData.orderId,
            orderData.username,
            orderData.role || orderData.productName,
            orderData.amount,
            orderData.status || 'pending',
            orderData.paymentMethod || null,
            orderData.productId || orderData.roleId,
            orderData.accountData ? JSON.stringify(orderData.accountData) : '{}'
        ];
        
        await db.run(sql, params);
        return this.findByOrderId(orderData.orderId);
    },
    
    // Find by order ID
    async findByOrderId(orderId) {
        const order = await db.get('SELECT * FROM orders WHERE orderId = ?', [orderId]);
        if (order) {
            try {
                order.accountData = JSON.parse(order.accountData || '{}');
            } catch (e) {
                order.accountData = {};
            }
            try {
                order.pakasirData = JSON.parse(order.pakasirData || '{}');
            } catch (e) {
                order.pakasirData = {};
            }
        }
        return order;
    },
    
    // Update order
    async update(orderId, updates) {
        const fields = [];
        const values = [];
        
        Object.keys(updates).forEach(key => {
            if (key !== 'orderId') {
                fields.push(`${key} = ?`);
                
                // Handle JSON data
                if ((key === 'accountData' || key === 'pakasirData') && updates[key]) {
                    values.push(JSON.stringify(updates[key]));
                } else {
                    values.push(updates[key]);
                }
            }
        });
        
        if (fields.length === 0) {
            return this.findByOrderId(orderId);
        }
        
        values.push(orderId);
        const sql = `UPDATE orders SET ${fields.join(', ')} WHERE orderId = ?`;
        
        await db.run(sql, values);
        return this.findByOrderId(orderId);
    },
    
    // Get all orders with filters
    async findAll(filters = {}) {
        let sql = 'SELECT * FROM orders WHERE 1=1';
        const params = [];
        
        if (filters.status) {
            sql += ' AND status = ?';
            params.push(filters.status);
        }
        
        if (filters.role) {
            sql += ' AND role = ?';
            params.push(filters.role);
        }
        
        if (filters.productId) {
            sql += ' AND productId = ?';
            params.push(filters.productId);
        }
        
        if (filters.username) {
            sql += ' AND username LIKE ?';
            params.push(`%${filters.username}%`);
        }
        
        sql += ' ORDER BY createdAt DESC';
        
        if (filters.limit) {
            sql += ' LIMIT ?';
            params.push(parseInt(filters.limit));
        }
        
        if (filters.offset) {
            sql += ' OFFSET ?';
            params.push(parseInt(filters.offset));
        }
        
        const orders = await db.all(sql, params);
        
        // Parse JSON data
        return orders.map(order => {
            try {
                order.accountData = JSON.parse(order.accountData || '{}');
            } catch (e) {
                order.accountData = {};
            }
            try {
                order.pakasirData = JSON.parse(order.pakasirData || '{}');
            } catch (e) {
                order.pakasirData = {};
            }
            return order;
        });
    },
    
    // Count orders
    async count(filters = {}) {
        let sql = 'SELECT COUNT(*) as total FROM orders WHERE 1=1';
        const params = [];
        
        if (filters.status) {
            sql += ' AND status = ?';
            params.push(filters.status);
        }
        
        if (filters.role) {
            sql += ' AND role = ?';
            params.push(filters.role);
        }
        
        const result = await db.get(sql, params);
        return result.total;
    },
    
    // Get revenue stats
    async getRevenue() {
        const sql = `
            SELECT 
                SUM(amount) as totalRevenue,
                COUNT(*) as totalOrders,
                SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) as completedRevenue,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedOrders,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pendingOrders,
                SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelledOrders
            FROM orders
        `;
        
        return await db.get(sql);
    },
    
    // Get daily/weekly/monthly stats
    async getTimeStats(period = 'daily') {
        let dateFormat;
        switch(period) {
            case 'daily':
                dateFormat = 'date(createdAt)';
                break;
            case 'weekly':
                dateFormat = 'strftime("%Y-%W", createdAt)';
                break;
            case 'monthly':
                dateFormat = 'strftime("%Y-%m", createdAt)';
                break;
            default:
                dateFormat = 'date(createdAt)';
        }
        
        const sql = `
            SELECT 
                ${dateFormat} as period,
                COUNT(*) as orders,
                SUM(amount) as revenue,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
            FROM orders
            GROUP BY period
            ORDER BY period DESC
            LIMIT 30
        `;
        
        return await db.all(sql);
    },
    
    // Search orders with pagination
    async search(query, filters = {}, page = 1, limit = 20) {
        let sql = 'SELECT * FROM orders WHERE 1=1';
        const params = [];
        
        // Search by orderId or username
        if (query) {
            sql += ' AND (orderId LIKE ? OR username LIKE ?)';
            params.push(`%${query}%`, `%${query}%`);
        }
        
        // Apply filters
        if (filters.status) {
            sql += ' AND status = ?';
            params.push(filters.status);
        }
        
        if (filters.role) {
            sql += ' AND role = ?';
            params.push(filters.role);
        }
        
        if (filters.productId) {
            sql += ' AND productId = ?';
            params.push(filters.productId);
        }
        
        // Date range filter
        if (filters.startDate) {
            sql += ' AND date(createdAt) >= date(?)';
            params.push(filters.startDate);
        }
        
        if (filters.endDate) {
            sql += ' AND date(createdAt) <= date(?)';
            params.push(filters.endDate);
        }
        
        // Count total for pagination
        const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
        const countResult = await db.get(countSql, params);
        const total = countResult.total;
        
        // Add ordering and pagination
        sql += ' ORDER BY createdAt DESC';
        
        const offset = (page - 1) * limit;
        sql += ' LIMIT ? OFFSET ?';
        params.push(limit, offset);
        
        const orders = await db.all(sql, params);
        
        // Parse JSON data
        const parsedOrders = orders.map(order => {
            try {
                order.accountData = JSON.parse(order.accountData || '{}');
            } catch (e) {
                order.accountData = {};
            }
            try {
                order.pakasirData = JSON.parse(order.pakasirData || '{}');
            } catch (e) {
                order.pakasirData = {};
            }
            return order;
        });
        
        return {
            orders: parsedOrders,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        };
    },
    
    // Delete order (admin only)
    async delete(orderId) {
        const sql = 'DELETE FROM orders WHERE orderId = ?';
        const result = await db.run(sql, [orderId]);
        return result.changes > 0;
    },
    
    // Get product statistics
    async getProductStats() {
        const sql = `
            SELECT 
                productId,
                role as productName,
                COUNT(*) as totalOrders,
                SUM(amount) as totalRevenue,
                AVG(amount) as avgAmount,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedOrders
            FROM orders
            GROUP BY productId
            ORDER BY totalOrders DESC
        `;
        
        return await db.all(sql);
    },

    async findOne(query) {
        if (query.orderId) {
            return await this.findByOrderId(query.orderId);
        }
        
        // Search with other query
        let sql = 'SELECT * FROM orders WHERE 1=1';
        const params = [];
        
        Object.keys(query).forEach(key => {
            sql += ` AND ${key} = ?`;
            params.push(query[key]);
        });
        
        sql += ' LIMIT 1';
        const order = await db.get(sql, params);
        
        if (order) {
            try {
                order.accountData = JSON.parse(order.accountData || '{}');
            } catch (e) {
                order.accountData = {};
            }
            try {
                order.pakasirData = JSON.parse(order.pakasirData || '{}');
            } catch (e) {
                order.pakasirData = {};
            }
        }
        return order;
    },
    
    async updateOne(query, updates) {
        if (query.orderId) {
            return await this.update(query.orderId, updates);
        }
        throw new Error('Update by orderId only supported');
    },
    
    async count(filters = {}) {
        let sql = 'SELECT COUNT(*) as total FROM orders WHERE 1=1';
        const params = [];
        
        Object.keys(filters).forEach(key => {
            sql += ` AND ${key} = ?`;
            params.push(filters[key]);
        });
        
        const result = await db.get(sql, params);
        return result.total;
    },
    
    // Get recent activity
    async getRecentActivity(limit = 10) {
        const sql = `
            SELECT 
                orderId,
                username,
                role as productName,
                amount,
                status,
                createdAt,
                productId,
                CASE 
                    WHEN status = 'completed' THEN 'success'
                    WHEN status = 'pending' THEN 'warning'
                    WHEN status = 'cancelled' THEN 'error'
                    ELSE 'info'
                END as statusType
            FROM orders
            ORDER BY createdAt DESC
            LIMIT ?
        `;
        
        return await db.all(sql, [limit]);
    },
    
    // Get pending orders count
    async getPendingCount() {
        const result = await db.get('SELECT COUNT(*) as count FROM orders WHERE status = "pending"');
        return result.count;
    },
    
    // Get completed orders count
    async getCompletedCount() {
        const result = await db.get('SELECT COUNT(*) as count FROM orders WHERE status = "completed"');
        return result.count;
    },
    
    // Update order with account data after manual completion
    async completeWithAccount(orderId, accountData) {
        const sql = `
            UPDATE orders 
            SET status = 'completed',
                accountData = ?,
                completedAt = CURRENT_TIMESTAMP,
                updatedAt = CURRENT_TIMESTAMP
            WHERE orderId = ?
        `;
        
        await db.run(sql, [JSON.stringify(accountData), orderId]);
        return this.findByOrderId(orderId);
    },
    
    // Cancel order
    async cancelOrder(orderId, reason = '') {
        const sql = `
            UPDATE orders 
            SET status = 'cancelled',
                failedReason = ?,
                failedAt = CURRENT_TIMESTAMP,
                updatedAt = CURRENT_TIMESTAMP
            WHERE orderId = ?
        `;
        
        await db.run(sql, [reason, orderId]);
        return this.findByOrderId(orderId);
    }
};

module.exports = Order;