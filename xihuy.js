const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data/GrowLyy.db');
const db = new sqlite3.Database(dbPath);

async function createAdmin() {
    try {
        // Hash password
        const password = 'admin123'; // Ganti dengan password yang diinginkan
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Insert admin
        db.run(`
            INSERT OR REPLACE INTO admins (username, password, role) 
            VALUES (?, ?, ?)
        `, ['admin', hashedPassword, 'superadmin'], function(err) {
            if (err) {
                console.error('❌ Error:', err.message);
            } else {
                console.log('✅ Admin created successfully!');
                console.log('Username: admin');
                console.log('Password: admin123');
                console.log('ID:', this.lastID);
            }
            db.close();
        });
        
    } catch (error) {
        console.error('❌ Error:', error);
        db.close();
    }
}

// Create table if not exists
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'admin',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, () => {
        createAdmin();
    });
});