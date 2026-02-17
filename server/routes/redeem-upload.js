const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'GrowLyy.db');

console.log('📁 Database path:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ SQLite Connection Error:', err.message);
        process.exit(1);
    } else {
        console.log('✅ SQLite Connected Successfully!');
        initDatabase();
    }
});

async function checkAndAddColumns() {
    return new Promise((resolve) => {
        db.all(`PRAGMA table_info(orders)`, [], (err, rows) => {
            if (err) {
                console.error('Error checking orders table:', err);
                return resolve();
            }
            
            const columns = rows.map(r => r.name);
            console.log('📊 Existing columns in orders:', columns);
            
            const missingColumns = [
                { name: 'webhookData', type: 'TEXT', defaultValue: '{}' },
                { name: 'failedReason', type: 'TEXT', defaultValue: '' },
                { name: 'paymentStatus', type: 'TEXT', defaultValue: 'pending' },
                { name: 'updatedAt', type: 'DATETIME', defaultValue: 'CURRENT_TIMESTAMP' },
                { name: 'accountData', type: 'TEXT', defaultValue: '{}' }
            ];
            
            let columnsAdded = 0;
            missingColumns.forEach(col => {
                if (!columns.includes(col.name)) {
                    console.log(`🛠️ Adding missing column: ${col.name}`);
                    db.run(`ALTER TABLE orders ADD COLUMN ${col.name} ${col.type}`, (alterErr) => {
                        if (alterErr) {
                            console.error(`❌ Failed to add column ${col.name}:`, alterErr.message);
                        } else {
                            columnsAdded++;
                            console.log(`✅ Column ${col.name} added successfully`);
                            
                            if (col.defaultValue === '{}') {
                                db.run(`UPDATE orders SET ${col.name} = '{}' WHERE ${col.name} IS NULL`, () => {
                                    console.log(`✅ Set default value for ${col.name}`);
                                });
                            }
                        }
                    });
                }
            });
            
            setTimeout(() => {
                console.log(`✅ Column check completed. Added ${columnsAdded} columns.`);
                resolve();
            }, 1000);
        });
    });
}

class Account {
    static async getAvailable(productId) {
        return new Promise((resolve, reject) => {
            try {
                console.log(`🔍 Looking for available account for product: ${productId}`);
                
                db.get(
                    `SELECT * FROM accounts 
                     WHERE product_id = ? AND status = 'available' 
                     LIMIT 1`,
                    [productId],
                    (err, account) => {
                        if (err) {
                            console.error('❌ Error getting available account:', err);
                            reject(err);
                        } else {
                            if (account) {
                                console.log(`✅ Found account ID ${account.id} for product ${productId}`);
                                try {
                                    account.additional_info = JSON.parse(account.additional_info || '{}');
                                } catch (e) {
                                    account.additional_info = {};
                                }
                            } else {
                                console.log(`❌ No available accounts for product: ${productId}`);
                            }
                            resolve(account);
                        }
                    }
                );
            } catch (error) {
                console.error('❌ Error in getAvailable:', error);
                reject(error);
            }
        });
    }

    static async markAsSold(productId, orderId, customerEmail) {
        return new Promise((resolve, reject) => {
            try {
                console.log(`💰 Marking account as sold for product ${productId}, order ${orderId}`);
                
                db.get(
                    `SELECT id FROM accounts 
                     WHERE product_id = ? AND status = 'available' 
                     LIMIT 1`,
                    [productId],
                    (err, account) => {
                        if (err) {
                            console.error('❌ Error finding account to mark as sold:', err);
                            reject(err);
                            return;
                        }

                        if (!account) {
                            console.log(`⚠️ No available account found for product ${productId}`);
                            resolve(null);
                            return;
                        }

                        db.run(
                            `UPDATE accounts 
                             SET status = 'sold', 
                                 sold_at = CURRENT_TIMESTAMP,
                                 sold_to = ?,
                                 order_id = ?,
                                 updated_at = CURRENT_TIMESTAMP
                             WHERE id = ?`,
                            [customerEmail, orderId, account.id],
                            async function(updateErr) {
                                if (updateErr) {
                                    console.error('❌ Error marking account as sold:', updateErr);
                                    reject(updateErr);
                                    return;
                                }

                                if (this.changes > 0) {
                                    console.log(`✅ Account ${account.id} marked as sold for order ${orderId}`);
                                    
                                    const soldAccount = await new Promise((res, rej) => {
                                        db.get(
                                            `SELECT * FROM accounts WHERE id = ?`,
                                            [account.id],
                                            (err, row) => {
                                                if (err) rej(err);
                                                else {
                                                    try {
                                                        row.additional_info = JSON.parse(row.additional_info || '{}');
                                                    } catch (e) {
                                                        row.additional_info = {};
                                                    }
                                                    res(row);
                                                }
                                            }
                                        );
                                    });
                                    
                                    resolve(soldAccount);
                                } else {
                                    console.log(`❌ Failed to mark account ${account.id} as sold`);
                                    resolve(null);
                                }
                            }
                        );
                    }
                );
            } catch (error) {
                console.error('❌ Error in markAsSold:', error);
                reject(error);
            }
        });
    }

    static async getStock(productId) {
        return new Promise((resolve, reject) => {
            try {
                db.get(
                    `SELECT COUNT(*) as count FROM accounts 
                     WHERE product_id = ? AND status = 'available'`,
                    [productId],
                    (err, result) => {
                        if (err) {
                            console.error('❌ Error getting stock:', err);
                            reject(err);
                        } else {
                            resolve(result.count);
                        }
                    }
                );
            } catch (error) {
                console.error('❌ Error in getStock:', error);
                reject(error);
            }
        });
    }

    static async addAccounts(accounts) {
        return new Promise((resolve, reject) => {
            try {
                console.log(`📦 Adding ${accounts.length} accounts to database`);
                
                let added = 0;
                let errors = [];
                
                const stmt = db.prepare(
                    `INSERT INTO accounts (product_id, email, password, twofa_code, additional_info)
                     VALUES (?, ?, ?, ?, ?)`
                );
                
                accounts.forEach((acc, index) => {
                    try {
                        stmt.run([
                            acc.productId,
                            acc.email,
                            acc.password,
                            acc.twofa || null,
                            JSON.stringify(acc.additional || {})
                        ], function(err) {
                            if (err) {
                                console.error(`❌ Error adding account ${index + 1}:`, err.message);
                                errors.push({ index: index + 1, error: err.message });
                            } else {
                                added++;
                            }
                            
                            if (index === accounts.length - 1) {
                                stmt.finalize();
                                console.log(`✅ Added ${added} accounts, ${errors.length} errors`);
                                resolve({ added, errors });
                            }
                        });
                    } catch (e) {
                        console.error(`❌ Exception adding account ${index + 1}:`, e.message);
                        errors.push({ index: index + 1, error: e.message });
                        
                        if (index === accounts.length - 1) {
                            stmt.finalize();
                            resolve({ added, errors });
                        }
                    }
                });
                
            } catch (error) {
                console.error('❌ Error in addAccounts:', error);
                reject(error);
            }
        });
    }

    static async getAll(filters = {}) {
        return new Promise((resolve, reject) => {
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
                
                db.all(sql, params, (err, accounts) => {
                    if (err) {
                        console.error('❌ Error getting accounts:', err);
                        reject(err);
                    } else {
                        const parsedAccounts = accounts.map(acc => ({
                            ...acc,
                            additional_info: (() => {
                                try {
                                    return JSON.parse(acc.additional_info || '{}');
                                } catch {
                                    return {};
                                }
                            })()
                        }));
                        resolve(parsedAccounts);
                    }
                });
            } catch (error) {
                console.error('❌ Error in getAll:', error);
                reject(error);
            }
        });
    }

    static async delete(id) {
        return new Promise((resolve, reject) => {
            try {
                db.run(
                    `DELETE FROM accounts WHERE id = ?`,
                    [id],
                    function(err) {
                        if (err) {
                            console.error('❌ Error deleting account:', err);
                            reject(err);
                        } else {
                            console.log(`✅ Account ${id} deleted, rows affected: ${this.changes}`);
                            resolve({ success: true, changes: this.changes });
                        }
                    }
                );
            } catch (error) {
                console.error('❌ Error in delete:', error);
                reject(error);
            }
        });
    }

    static async getStats() {
        return new Promise((resolve, reject) => {
            try {
                db.get(`
                    SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
                        SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as sold
                    FROM accounts
                `, [], (err, stats) => {
                    if (err) {
                        console.error('❌ Error getting account stats:', err);
                        reject(err);
                    } else {
                        resolve({
                            total: stats.total || 0,
                            available: stats.available || 0,
                            sold: stats.sold || 0
                        });
                    }
                });
            } catch (error) {
                console.error('❌ Error in getStats:', error);
                reject(error);
            }
        });
    }

    static async getById(id) {
        return new Promise((resolve, reject) => {
            try {
                db.get(
                    `SELECT * FROM accounts WHERE id = ?`,
                    [id],
                    (err, account) => {
                        if (err) {
                            console.error('❌ Error getting account by id:', err);
                            reject(err);
                        } else {
                            if (account) {
                                try {
                                    account.additional_info = JSON.parse(account.additional_info || '{}');
                                } catch (e) {
                                    account.additional_info = {};
                                }
                            }
                            resolve(account);
                        }
                    }
                );
            } catch (error) {
                console.error('❌ Error in getById:', error);
                reject(error);
            }
        });
    }
}

function initDatabase() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            orderId TEXT UNIQUE NOT NULL,
            username TEXT NOT NULL,
            role TEXT NOT NULL,
            productId TEXT,
            amount INTEGER NOT NULL,
            status TEXT DEFAULT 'pending',
            paymentMethod TEXT,
            accountData TEXT DEFAULT '{}',
            pakasirData TEXT DEFAULT '{}',
            webhookData TEXT DEFAULT '{}',
            failedReason TEXT DEFAULT '',
            paymentStatus TEXT DEFAULT 'pending',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            paidAt DATETIME,
            completedAt DATETIME,
            failedAt DATETIME
        )`, async (err) => {
            if (err) {
                console.error('❌ Orders table error:', err.message);
            } else {
                console.log('✅ Orders table ready');
                await checkAndAddColumns();
            }
        });

        db.run(`CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id TEXT NOT NULL,
            email TEXT NOT NULL,
            password TEXT NOT NULL,
            twofa_code TEXT,
            additional_info TEXT DEFAULT '{}',
            status TEXT DEFAULT 'available',
            sold_at DATETIME,
            sold_to TEXT,
            order_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) {
                console.error('❌ Accounts table error:', err.message);
            } else {
                console.log('✅ Accounts table ready');
                
                db.run(`CREATE INDEX idx_accounts_product_status ON accounts(product_id, status)`, (idxErr) => {
                    if (idxErr) console.error('❌ Error creating index:', idxErr.message);
                });
                
                db.run(`CREATE INDEX idx_accounts_order ON accounts(order_id)`, (idxErr) => {
                    if (idxErr) console.error('❌ Error creating order index:', idxErr.message);
                });
            }
        });

        db.run(`CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            price INTEGER NOT NULL,
            description TEXT,
            image TEXT,
            category TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) {
                console.error('❌ Products table error:', err.message);
            } else {
                console.log('✅ Products table ready');
            }
        });

        db.run(`CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'admin',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, async (err) => {
            if (err) {
                console.error('❌ Admins table error:', err.message);
            } else {
                console.log('✅ Admins table ready');

                bcrypt.hash('admin123', 10, (hashErr, hash) => {
                    if (hashErr) {
                        console.error('❌ Error hashing password:', hashErr.message);
                        return;
                    }

                    db.run(
                        `INSERT OR IGNORE INTO admins (username, password, role) VALUES (?, ?, ?)`,
                        ['admin', hash, 'superadmin'],
                        (insertErr) => {
                            if (insertErr) console.error('❌ Admin insert error:', insertErr.message);
                            else console.log('✅ Default admin created: admin / admin123');
                        }
                    );
                });
            }
        });

        db.run(`CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            value TEXT NOT NULL,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) {
                console.error('❌ Settings table error:', err.message);
            } else {
                console.log('✅ Settings table ready');

                const defaults = [
                    ['shop_name', 'GrowLyy Shop'],
                    ['currency', 'IDR'],
                    ['pakasir_api_key', 'uuj5Pc69gr3L5xdwPZXBJi7ZoWW94LaJ'],
                    ['pakasir_slug', 'gtlyy-payment'],
                    ['webhook_url', ''],
                    ['discord_webhook', ''],
                    ['telegram_bot_token', ''],
                    ['telegram_chat_id', '']
                ];

                defaults.forEach(([key, value]) => {
                    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, 
                        [key, value],
                        (insertErr) => {
                            if (insertErr) console.error(`❌ Error inserting ${key}:`, insertErr.message);
                        }
                    );
                });
            }
        });

        db.run(`CREATE TABLE IF NOT EXISTS payment_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            orderId TEXT,
            event TEXT,
            data TEXT,
            ip TEXT,
            userAgent TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) console.error('❌ Payment logs table error:', err.message);
            else console.log('✅ Payment logs table ready');
        });
    });
}

module.exports = {
    run: (sql, params = []) => {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, changes: this.changes });
            });
        });
    },

    get: (sql, params = []) => {
        return new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    },

    all: (sql, params = []) => {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },

    close: () => {
        return new Promise((resolve, reject) => {
            db.close((err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    },

    columnExists: (table, column) => {
        return new Promise((resolve, reject) => {
            db.get(
                `SELECT COUNT(*) as count FROM pragma_table_info('${table}') WHERE name = ?`,
                [column],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row.count > 0);
                }
            );
        });
    },

    db: db,

    Account: Account
};