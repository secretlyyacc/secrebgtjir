const db = require('../config/database');
const bcrypt = require('bcryptjs');

const Admin = {
    // Find by username
    async findByUsername(username) {
        return await db.get('SELECT * FROM admins WHERE username = ?', [username]);
    },
    
    // Create admin
    async create(adminData) {
        const hashedPassword = await bcrypt.hash(adminData.password, 10);
        
        const sql = `
            INSERT INTO admins (username, password, role) 
            VALUES (?, ?, ?)
        `;
        
        await db.run(sql, [
            adminData.username,
            hashedPassword,
            adminData.role || 'admin'
        ]);
        
        return this.findByUsername(adminData.username);
    },
    
    // Verify password
    async verifyPassword(username, password) {
        const admin = await this.findByUsername(username);
        
        if (!admin) {
            return false;
        }
        
        return await bcrypt.compare(password, admin.password);
    },
    
    // Update admin
    async update(username, updates) {
        const fields = [];
        const values = [];
        
        Object.keys(updates).forEach(key => {
            if (key !== 'username') {
                fields.push(`${key} = ?`);
                
                // Hash password if updating
                if (key === 'password') {
                    values.push(bcrypt.hashSync(updates[key], 10));
                } else {
                    values.push(updates[key]);
                }
            }
        });
        
        if (fields.length === 0) {
            return this.findByUsername(username);
        }
        
        values.push(username);
        const sql = `UPDATE admins SET ${fields.join(', ')} WHERE username = ?`;
        
        await db.run(sql, values);
        return this.findByUsername(username);
    },
    
    // Get all admins
    async findAll() {
        return await db.all('SELECT id, username, role, createdAt FROM admins ORDER BY createdAt DESC');
    },
    
    // Delete admin
    async delete(username) {
        // Don't delete the main admin
        if (username === 'admin') {
            throw new Error('Cannot delete main admin account');
        }
        
        const sql = 'DELETE FROM admins WHERE username = ?';
        const result = await db.run(sql, [username]);
        return result.changes > 0;
    }
};

module.exports = Admin;