const db = require('../config/database');

const RedeemCode = {
    // Create new redeem code
    async create(codeData) {
        const sql = `
            INSERT INTO redeem_codes (code, role, used, usedBy, orderId) 
            VALUES (?, ?, ?, ?, ?)
        `;
        
        const params = [
            codeData.code,
            codeData.role,
            codeData.used ? 1 : 0,
            codeData.usedBy || null,
            codeData.orderId || null
        ];
        
        await db.run(sql, params);
        return this.findByCode(codeData.code);
    },
    
    // Find by code
    async findByCode(code) {
        return await db.get('SELECT * FROM redeem_codes WHERE code = ?', [code]);
    },
    
    // Get available code for role
    async getAvailableCode(role) {
        return await db.get(
            'SELECT * FROM redeem_codes WHERE role = ? AND used = 0 ORDER BY createdAt ASC LIMIT 1',
            [role]
        );
    },
    
    // Mark code as used
    async markAsUsed(code, usedBy, orderId = null) {
        const sql = `
            UPDATE redeem_codes 
            SET used = 1, usedBy = ?, usedAt = CURRENT_TIMESTAMP, orderId = ?
            WHERE code = ? AND used = 0
        `;
        
        const result = await db.run(sql, [usedBy, orderId, code]);
        
        if (result.changes > 0) {
            return this.findByCode(code);
        }
        return null;
    },
    
    // Get all codes with filters
    async findAll(filters = {}) {
        let sql = 'SELECT * FROM redeem_codes WHERE 1=1';
        const params = [];
        
        if (filters.role) {
            sql += ' AND role = ?';
            params.push(filters.role);
        }
        
        if (filters.used !== undefined) {
            sql += ' AND used = ?';
            params.push(filters.used ? 1 : 0);
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
        
        return await db.all(sql, params);
    },
    
    // Count codes
    async count(filters = {}) {
        let sql = 'SELECT COUNT(*) as total FROM redeem_codes WHERE 1=1';
        const params = [];
        
        if (filters.role) {
            sql += ' AND role = ?';
            params.push(filters.role);
        }
        
        if (filters.used !== undefined) {
            sql += ' AND used = ?';
            params.push(filters.used ? 1 : 0);
        }
        
        const result = await db.get(sql, params);
        return result.total;
    },
    
    // Add bulk codes
    async addBulk(codes) {
        const results = [];
        
        for (const codeData of codes) {
            try {
                const result = await this.create(codeData);
                results.push({ success: true, code: result.code });
            } catch (error) {
                results.push({ success: false, code: codeData.code, error: error.message });
            }
        }
        
        return results;
    },
    
    // Delete code by code string
    async delete(code) {
        const sql = 'DELETE FROM redeem_codes WHERE code = ? AND used = 0';
        const result = await db.run(sql, [code]);
        return result.changes > 0;
    },
    
    // Delete multiple codes
    async deleteMultiple(codes) {
        if (!Array.isArray(codes) || codes.length === 0) {
            return { deleted: 0, errors: [] };
        }
        
        const results = {
            deleted: 0,
            errors: []
        };
        
        // Delete in transaction if supported
        for (const code of codes) {
            try {
                // Check if code exists and is not used
                const existing = await this.findByCode(code);
                if (!existing) {
                    results.errors.push({ code, error: 'Code not found' });
                    continue;
                }
                
                if (existing.used) {
                    results.errors.push({ code, error: 'Cannot delete used code' });
                    continue;
                }
                
                const deleted = await this.delete(code);
                if (deleted) {
                    results.deleted++;
                }
            } catch (error) {
                results.errors.push({ code, error: error.message });
            }
        }
        
        return results;
    },
    
    // Get codes statistics
    async getStats() {
        const sql = `
            SELECT 
                role,
                COUNT(*) as total,
                SUM(CASE WHEN used = 1 THEN 1 ELSE 0 END) as used,
                SUM(CASE WHEN used = 0 THEN 1 ELSE 0 END) as available
            FROM redeem_codes 
            GROUP BY role
            ORDER BY total DESC
        `;
        
        return await db.all(sql);
    },
    
    // Search codes with pagination
    async search(query, filters = {}, page = 1, limit = 20) {
        let sql = 'SELECT * FROM redeem_codes WHERE 1=1';
        const params = [];
        
        // Search by code
        if (query) {
            sql += ' AND code LIKE ?';
            params.push(`%${query}%`);
        }
        
        // Apply filters
        if (filters.role) {
            sql += ' AND role = ?';
            params.push(filters.role);
        }
        
        if (filters.used !== undefined) {
            sql += ' AND used = ?';
            params.push(filters.used ? 1 : 0);
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
        
        const codes = await db.all(sql, params);
        
        return {
            codes,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        };
    },
    
    // Clean up expired codes (older than 30 days)
    async cleanupExpired() {
        const sql = `
            DELETE FROM redeem_codes 
            WHERE used = 0 
            AND createdAt < datetime('now', '-30 days')
        `;
        
        const result = await db.run(sql);
        return result.changes;
    },

    async count(filters = {}) {
        let sql = 'SELECT COUNT(*) as total FROM redeem_codes WHERE 1=1';
        const params = [];
        
        Object.keys(filters).forEach(key => {
            sql += ` AND ${key} = ?`;
            params.push(filters[key]);
        });
        
        const result = await db.get(sql, params);
        return result.total;
    },
    
    // Bulk update codes (mark as used/unused)
    async bulkUpdate(codes, updates) {
        if (!Array.isArray(codes) || codes.length === 0) {
            return { updated: 0, errors: [] };
        }
        
        const results = {
            updated: 0,
            errors: []
        };
        
        for (const code of codes) {
            try {
                const existing = await this.findByCode(code);
                if (!existing) {
                    results.errors.push({ code, error: 'Code not found' });
                    continue;
                }
                
                // Build update SQL
                const setClauses = [];
                const params = [];
                
                if (updates.used !== undefined) {
                    setClauses.push('used = ?');
                    params.push(updates.used ? 1 : 0);
                    
                    if (updates.used) {
                        setClauses.push('usedAt = CURRENT_TIMESTAMP');
                        if (updates.usedBy) {
                            setClauses.push('usedBy = ?');
                            params.push(updates.usedBy);
                        }
                        if (updates.orderId) {
                            setClauses.push('orderId = ?');
                            params.push(updates.orderId);
                        }
                    } else {
                        setClauses.push('usedAt = NULL');
                        setClauses.push('usedBy = NULL');
                        setClauses.push('orderId = NULL');
                    }
                }
                
                if (setClauses.length === 0) {
                    continue;
                }
                
                params.push(code);
                const updateSql = `UPDATE redeem_codes SET ${setClauses.join(', ')} WHERE code = ?`;
                
                const result = await db.run(updateSql, params);
                if (result.changes > 0) {
                    results.updated++;
                }
                
            } catch (error) {
                results.errors.push({ code, error: error.message });
            }
        }
        
        return results;
    }
};

module.exports = RedeemCode;