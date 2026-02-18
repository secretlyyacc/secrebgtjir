// server/services/stockSync.service.js
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

class StockSyncService {
    constructor() {
        this.dbPath = path.join(__dirname, '../../data/GrowLyy.db');
        this.productPath = path.join(__dirname, '../../data/product.json');
        this.logFile = path.join(__dirname, '../../logs/stock-sync.log');
    }

    log(message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${type}] ${message}\n`;
        console.log(logMessage.trim());
        
        const logsDir = path.join(__dirname, '../../logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
        fs.appendFileSync(this.logFile, logMessage);
    }

    async getAccountsCountByProduct() {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    this.log(`Database connection error: ${err.message}`, 'ERROR');
                    reject(err);
                }
            });

            const query = `
                SELECT 
                    product_id,
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
                    SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as sold
                FROM accounts 
                GROUP BY product_id
            `;

            db.all(query, [], (err, rows) => {
                if (err) {
                    this.log(`Query error: ${err.message}`, 'ERROR');
                    reject(err);
                } else {
                    const stats = {};
                    rows.forEach(row => {
                        stats[row.product_id] = {
                            total: row.total,
                            available: row.available || 0,
                            sold: row.sold || 0
                        };
                    });
                    this.log(`Retrieved stats for ${rows.length} products from database`);
                    resolve(stats);
                }
                db.close();
            });
        });
    }

    async updateProductJson(dbStats) {
        try {
            if (!fs.existsSync(this.productPath)) {
                this.log(`Product file not found at ${this.productPath}`, 'ERROR');
                return false;
            }

            const productData = JSON.parse(fs.readFileSync(this.productPath, 'utf8'));
            let updated = false;

            if (!productData.roles || !Array.isArray(productData.roles)) {
                this.log('Invalid product.json format: missing roles array', 'ERROR');
                return false;
            }

            productData.roles.forEach(product => {
                const stats = dbStats[product.id];
                if (stats) {
                    const oldStock = parseInt(product.stock) || 0;
                    const newStock = stats.available;
                    
                    if (oldStock !== newStock) {
                        this.log(`Updating stock for ${product.id}: ${oldStock} -> ${newStock} (Available accounts: ${stats.available}, Total: ${stats.total})`);
                        product.stock = newStock.toString();
                        updated = true;
                    }
                } else {
                    if (parseInt(product.stock) !== 0) {
                        this.log(`Setting stock to 0 for ${product.id} (no accounts found)`);
                        product.stock = '0';
                        updated = true;
                    }
                }
            });

            if (updated) {
                fs.writeFileSync(this.productPath, JSON.stringify(productData, null, 2));
                this.log('Product.json updated successfully');
                return true;
            } else {
                this.log('No stock updates needed');
                return false;
            }
        } catch (error) {
            this.log(`Error updating product.json: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async syncStock() {
        this.log('Starting stock synchronization...');
        try {
            const dbStats = await this.getAccountsCountByProduct();
            const updated = await this.updateProductJson(dbStats);
            
            if (updated) {
                this.log('Stock synchronization completed with updates');
            } else {
                this.log('Stock synchronization completed - no changes needed');
            }
            
            return {
                success: true,
                updated,
                stats: dbStats
            };
        } catch (error) {
            this.log(`Sync failed: ${error.message}`, 'ERROR');
            return {
                success: false,
                error: error.message
            };
        }
    }

    async getDetailedStockReport() {
        try {
            const dbStats = await this.getAccountsCountByProduct();
            const productData = JSON.parse(fs.readFileSync(this.productPath, 'utf8'));
            
            const report = {
                timestamp: new Date().toISOString(),
                products: []
            };

            productData.roles.forEach(product => {
                const stats = dbStats[product.id] || { total: 0, available: 0, sold: 0 };
                report.products.push({
                    id: product.id,
                    name: product.name,
                    price: product.price,
                    stockInJson: parseInt(product.stock) || 0,
                    actualAvailable: stats.available,
                    totalAccounts: stats.total,
                    soldAccounts: stats.sold,
                    needsUpdate: (parseInt(product.stock) || 0) !== stats.available
                });
            });

            return report;
        } catch (error) {
            this.log(`Error generating report: ${error.message}`, 'ERROR');
            return null;
        }
    }
}

module.exports = new StockSyncService();
