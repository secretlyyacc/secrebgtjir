// server/services/stockSync.service.js
const fs = require('fs');
const path = require('path');

class StockSyncService {
    constructor() {
        this.dbPath = path.join(__dirname, '../../data/GrowLyy.db');
        this.productPath = path.join(__dirname, '../../data/product.json');
        this.accountsPath = path.join(__dirname, '../../data/accounts.json');
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
        try {
            fs.appendFileSync(this.logFile, logMessage);
        } catch (e) {
            // Ignore log file errors
        }
    }

    async getAccountsCountByProduct() {
        try {
            if (!fs.existsSync(this.accountsPath)) {
                return {};
            }

            const accountsData = JSON.parse(fs.readFileSync(this.accountsPath, 'utf8'));
            const stats = {};

            accountsData.forEach(account => {
                const productId = account.product_id;
                if (!stats[productId]) {
                    stats[productId] = { total: 0, available: 0, sold: 0 };
                }
                stats[productId].total++;
                if (account.status === 'available') {
                    stats[productId].available++;
                } else if (account.status === 'sold') {
                    stats[productId].sold++;
                }
            });

            this.log(`Retrieved stats for ${Object.keys(stats).length} products from accounts.json`);
            return stats;
        } catch (error) {
            this.log(`Error reading accounts: ${error.message}`, 'ERROR');
            return {};
        }
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
            
            if (!fs.existsSync(this.productPath)) {
                return { products: [] };
            }

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
            return { products: [] };
        }
    }
}

module.exports = new StockSyncService();
