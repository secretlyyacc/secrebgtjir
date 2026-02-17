const db = require('../config/database');

const Account = {
    async getAvailable(productId) {
        try {
            return await db.get(
                `SELECT * FROM accounts 
                 WHERE product_id = ? AND status = 'available' 
                 LIMIT 1`,
                [productId]
            );
        } catch (error) {
            console.error('❌ Error in getAvailable:', error);
            throw error;
        }
    },

    async markAsSold(productId, orderId, customerEmail) {
        try {
            const account = await db.get(
                `SELECT id FROM accounts 
                 WHERE product_id = ? AND status = 'available' 
                 LIMIT 1`,
                [productId]
            );
            
            if (!account) return null;
            
            await db.run(
                `UPDATE accounts 
                 SET status = 'sold', 
                     sold_at = CURRENT_TIMESTAMP,
                     sold_to = ?,
                     order_id = ?,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [customerEmail, orderId, account.id]
            );
            
            return await db.get(
                `SELECT * FROM accounts WHERE id = ?`,
                [account.id]
            );
        } catch (error) {
            console.error('❌ Error in markAsSold:', error);
            throw error;
        }
    },

    async getStock(productId) {
        try {
            const result = await db.get(
                `SELECT COUNT(*) as count FROM accounts 
                 WHERE product_id = ? AND status = 'available'`,
                [productId]
            );
            return result?.count || 0;
        } catch (error) {
            console.error('❌ Error in getStock:', error);
            throw error;
        }
    },

    async addAccounts(accounts) {
        try {
            if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
                throw new Error('Invalid accounts array');
            }

            const results = {
                added: 0,
                errors: []
            };

            for (const acc of accounts) {
                try {
                    await db.run(
                        `INSERT INTO accounts (product_id, email, password, twofa_code, additional_info)
                         VALUES (?, ?, ?, ?, ?)`,
                        [
                            acc.productId,
                            acc.email?.trim(),
                            acc.password,
                            acc.twofa || acc.twofa_code || null,
                            JSON.stringify(acc.additional || {})
                        ]
                    );
                    results.added++;
                } catch (err) {
                    results.errors.push({
                        email: acc.email,
                        error: err.message
                    });
                    console.error('Error adding account:', err.message);
                }
            }

            return results;
        } catch (error) {
            console.error('❌ Error in addAccounts:', error);
            throw error;
        }
    },

    async getAll(filters = {}) {
        try {
            let sql = `SELECT * FROM accounts WHERE 1=1`;
            const params = [];
            
            if (filters.product_id) {
                sql += ` AND product_id = ?`;
                params.push(filters.product_id);
            }
            
            if (filters.status) {
                sql += ` AND status = ?`;
                params.push(filters.status);
            }
            
            sql += ` ORDER BY created_at DESC`;
            
            if (filters.limit) {
                sql += ` LIMIT ?`;
                params.push(filters.limit);
            }
            
            if (filters.offset) {
                sql += ` OFFSET ?`;
                params.push(filters.offset);
            }
            
            const accounts = await db.all(sql, params);
            
            return (accounts || []).map(acc => ({
                id: acc.id,
                product_id: acc.product_id,
                email: acc.email,
                password: acc.password,
                twofa_code: acc.twofa_code,
                additional_info: (() => {
                    try {
                        return JSON.parse(acc.additional_info || '{}');
                    } catch {
                        return {};
                    }
                })(),
                status: acc.status,
                sold_at: acc.sold_at,
                sold_to: acc.sold_to,
                order_id: acc.order_id,
                created_at: acc.created_at,
                updated_at: acc.updated_at
            }));
            
        } catch (error) {
            console.error('❌ Error in getAll:', error);
            throw error;
        }
    },

    async getById(id) {
        try {
            const account = await db.get(
                `SELECT * FROM accounts WHERE id = ?`,
                [id]
            );
            
            if (!account) return null;
            
            return {
                ...account,
                additional_info: (() => {
                    try {
                        return JSON.parse(account.additional_info || '{}');
                    } catch {
                        return {};
                    }
                })()
            };
        } catch (error) {
            console.error('❌ Error in getById:', error);
            throw error;
        }
    },

    async delete(id) {
        try {
            await db.run(`DELETE FROM accounts WHERE id = ?`, [id]);
            return { success: true };
        } catch (error) {
            console.error('❌ Error in delete:', error);
            throw error;
        }
    },

    async getStats() {
        try {
            const result = await db.get(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
                    SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as sold
                FROM accounts
            `);
            
            return {
                total: result?.total || 0,
                available: result?.available || 0,
                sold: result?.sold || 0
            };
        } catch (error) {
            console.error('❌ Error in getStats:', error);
            throw error;
        }
    },

    async update(id, updates) {
        try {
            const account = await this.getById(id);
            if (!account) throw new Error('Account not found');

            const fields = [];
            const values = [];

            if (updates.email) {
                fields.push('email = ?');
                values.push(updates.email);
            }
            if (updates.password) {
                fields.push('password = ?');
                values.push(updates.password);
            }
            if (updates.twofa_code !== undefined) {
                fields.push('twofa_code = ?');
                values.push(updates.twofa_code);
            }
            if (updates.additional) {
                fields.push('additional_info = ?');
                values.push(JSON.stringify(updates.additional));
            }
            if (updates.status) {
                fields.push('status = ?');
                values.push(updates.status);
            }

            fields.push('updated_at = CURRENT_TIMESTAMP');

            if (fields.length === 0) return account;

            values.push(id);
            
            await db.run(
                `UPDATE accounts SET ${fields.join(', ')} WHERE id = ?`,
                values
            );

            return await this.getById(id);
        } catch (error) {
            console.error('❌ Error in update:', error);
            throw error;
        }
    }
};

module.exports = Account;