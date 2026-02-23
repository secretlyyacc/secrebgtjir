// server.js
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { authenticateToken } = require('./server/middleware/auth');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const sqlite3 = require('sqlite3').verbose();
const stockSync = require('./server/services/stockSync.service');

const dbPath = path.join(__dirname, 'data', 'GrowLyy.db');

const log = {
    info: (...args) => console.log(`[INFO] ${new Date().toISOString()} -`, ...args),
    error: (...args) => console.error(`[ERROR] ${new Date().toISOString()} -`, ...args),
    warn: (...args) => console.warn(`[WARN] ${new Date().toISOString()} -`, ...args)
};

let whatsappBot;
try {
    whatsappBot = require('./server/models/WhatsAppBot');
    log.info('✅ WhatsApp/Email Bot initialized');
} catch (error) {
    log.error('❌ Failed to initialize WhatsApp/Email Bot:', error.message);
    whatsappBot = {
        isReady: false,
        getStatus: () => ({ isReady: false, hasQR: false, phoneNumber: null }),
        getQRCode: async () => null,
        getPairingCode: async () => ({ code: 'EMAIL-ONLY', expiresIn: 86400 }),
        createPhoneNumberPairing: async () => ({ id: 'test', phoneNumber: '', pairingCode: 'TEST' }),
        verifyPairingCode: async () => ({ success: true }),
        getPairingRequest: async () => null,
        sendRedeemCode: async () => ({ success: false, error: 'Bot not ready' }),
        sendMessage: async () => ({ success: false, error: 'Bot not ready' }),
        sendOrderNotification: async () => { log.info('Admin notification skipped - bot not ready'); },
        sendStockNotification: async () => { log.info('Stock notification skipped - bot not ready'); },
        restart: () => log.info('Restart called'),
        client: { info: null }
    };
}

let pakasirService;
try {
    pakasirService = require('./server/services/pakasir.service');
    log.info('✅ Pakasir Service initialized');
} catch (error) {
    log.error('❌ Failed to initialize Pakasir Service:', error.message);
    pakasirService = {
        getPaymentMethods: () => ([
            { id: 'qris', name: 'QRIS' },
            { id: 'bni_va', name: 'BNI VA' }
        ]),
        createTransaction: async () => { throw new Error('Pakasir service not ready'); },
        getPaymentUrl: () => '#',
        getPaypalUrl: () => '#',
        simulatePayment: async () => ({})
    };
}

let db;
try {
    db = require('./server/config/database');
    log.info('✅ Database initialized');
} catch (error) {
    log.warn('⚠️ Database not found, running with file-based storage:', error.message);
    db = null;
}

const app = express();
const PORT = process.env.PORT || 3000;
const HTTP_PORT = 80;
const HTTPS_PORT = 443;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
    log.info(`${req.method} ${req.url}`);
    next();
});

const ordersAccountsRoutes = require('./server/routes/admin/orders-accounts');
app.use('/api/admin', ordersAccountsRoutes);

const routeFiles = [
    { path: '/api/payment', file: 'payment' },
    { path: '/api/webhook', file: 'webhook' },
    { path: '/api/admin', file: 'admin' },
];

routeFiles.forEach(route => {
    try {
        const routePath = path.join(__dirname, 'server', 'routes', `${route.file}.js`);
        if (fs.existsSync(routePath)) {
            const routeModule = require(routePath);
            app.use(route.path, routeModule);
            log.info(`✅ Route loaded: ${route.path}`);
        } else {
            log.warn(`⚠️ Route file not found: ${routePath}`);
        }
    } catch (error) {
        log.warn(`⚠️ Route not loaded: ${route.path} - ${error.message}`);
    }
});

app.use('/api/admin/accounts', require('./server/routes/admin/accounts'));

app.get('/api/admin/verify', authenticateToken, (req, res) => {
    res.json({
        success: true,
        user: {
            id: req.user.id,
            username: req.user.username,
            role: req.user.role
        },
        message: 'Token is valid'
    });
});

app.post('/api/admin/stock/sync', authenticateToken, async (req, res) => {
    try {
        const result = await stockSync.syncStock();
        res.json({
            success: result.success,
            message: result.success ? 'Stock synchronized successfully' : 'Sync failed',
            updated: result.updated,
            error: result.error
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/admin/stock/status', authenticateToken, async (req, res) => {
    try {
        const report = await stockSync.getDetailedStockReport();
        res.json({
            success: true,
            report
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/bot/status', (req, res) => {
    try {
        const status = whatsappBot.getStatus();
        res.json({
            success: true,
            ...status,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        log.error('Error getting bot status:', error);
        res.json({ 
            success: false, 
            isReady: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

app.post('/api/bot/send-test', async (req, res) => {
    try {
        const { phone, message } = req.body;
        
        if (!phone) {
            return res.json({ 
                success: false, 
                error: 'Phone number required' 
            });
        }
        
        const result = await whatsappBot.sendMessage(
            phone, 
            message || '✅ Test message from LyyShop ID Bot'
        );
        
        res.json({ success: true, ...result });
    } catch (error) {
        log.error('Error sending test message:', error);
        res.json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.post('/api/whatsapp/send-redeem', async (req, res) => {
    try {
        const { orderId } = req.body;
        
        if (!orderId) {
            return res.json({ 
                success: false, 
                error: 'Order ID required' 
            });
        }
        
        const ordersPath = path.join(__dirname, 'data', 'orders.json');
        if (!fs.existsSync(ordersPath)) {
            return res.json({ success: false, error: 'Orders database not found' });
        }
        
        const orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
        const order = orders.find(o => o.orderId === orderId);
        
        if (!order) {
            return res.json({ success: false, error: 'Order not found' });
        }
        
        if (order.status !== 'completed' || !order.redeemCode) {
            return res.json({ 
                success: false, 
                error: 'Order not completed or no redeem code',
                status: order.status
            });
        }
        
        const rolesPath = path.join(__dirname, 'data', 'product.json');
        let productName = 'Product';
        if (fs.existsSync(rolesPath)) {
            const roles = JSON.parse(fs.readFileSync(rolesPath, 'utf8'));
            const role = roles.roles?.find(r => r.id == order.roleId) || roles.find(r => r.id == order.roleId);
            if (role) productName = role.name;
        }
        
        const orderData = {
            orderId: order.orderId,
            productName: productName,
            amount: order.amount || 0,
            redeemCode: order.redeemCode,
            username: order.username,
            customer: order.username,
            status: order.status
        };
        
        const result = await whatsappBot.sendRedeemCode(order.username, orderData);
        
        const updatedOrders = orders.map(o => {
            if (o.orderId === orderId) {
                return { 
                    ...o, 
                    whatsappSent: true,
                    whatsappSentAt: new Date().toISOString(),
                    emailMessageId: result.messageId
                };
            }
            return o;
        });
        fs.writeFileSync(ordersPath, JSON.stringify(updatedOrders, null, 2));
        
        res.json({ 
            success: true, 
            message: 'Redeem code sent',
            ...result 
        });
        
    } catch (error) {
        log.error('Error sending redeem:', error);
        res.json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.get('/api/pakasir/methods', (req, res) => {
    try {
        const methods = pakasirService.getPaymentMethods();
        res.json({ success: true, methods });
    } catch (error) {
        log.error('Error getting payment methods:', error);
        res.json({ success: false, error: error.message });
    }
});

app.get('/api/pakasir/status', (req, res) => {
    res.json({
        success: true,
        configured: !!(process.env.PAKASIR_API_KEY && process.env.PAKASIR_PROJECT_SLUG),
        project: process.env.PAKASIR_PROJECT_SLUG || null,
        mode: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString()
    });
});

app.get('/pending.html', (req, res) => {
    const pendingPath = path.join(__dirname, 'pending', 'pending.html');
    if (fs.existsSync(pendingPath)) {
        let html = fs.readFileSync(pendingPath, 'utf8');
        if (req.query.order) {
            html = html.replace(/ORDER_ID_PLACEHOLDER/g, req.query.order);
        }
        res.send(html);
    } else {
        res.redirect(`/?order=${req.query.order || ''}`);
    }
});

app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.send('Index page not found');
    }
});

app.get('/admin', (req, res) => {
    const adminPath = path.join(__dirname, 'admin.html');
    if (fs.existsSync(adminPath)) {
        res.sendFile(adminPath);
    } else {
        res.send('Admin page not found');
    }
});

app.get('/api/roles', (req, res) => {
    try {
        const rolesPath = path.join(__dirname, 'data', 'product.json');
        if (fs.existsSync(rolesPath)) {
            const roles = JSON.parse(fs.readFileSync(rolesPath, 'utf8'));
            res.json(roles);
        } else {
            res.status(404).json({ error: 'Product file not found' });
        }
    } catch (error) {
        console.error('Error fetching roles data', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch roles' });
    }
});

app.get('/api/order/:orderId', (req, res) => {
    const { orderId } = req.params;
    console.log('🔍 Looking for order:', orderId);

    const tempDb = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
            console.error('❌ Cannot open database:', err.message);
            return res.status(500).json({ 
                success: false, 
                error: 'Database connection failed' 
            });
        }

        const timer = setTimeout(() => {
            console.error('❌ Order fetch timeout for:', orderId);
            tempDb.close();
            res.status(504).json({ 
                success: false, 
                error: 'Request timeout' 
            });
        }, 5000);

        tempDb.get('SELECT * FROM orders WHERE orderId = ?', [orderId], (err, row) => {
            clearTimeout(timer);
            
            if (err) {
                console.error('❌ Database error:', err.message);
                tempDb.close();
                return res.status(500).json({ 
                    success: false, 
                    error: 'Database error' 
                });
            }

            tempDb.close();

            if (!row) {
                console.log('❌ Order not found:', orderId);
                return res.status(404).json({ 
                    success: false, 
                    error: 'Order not found' 
                });
            }

            try {
                if (row.pakasirData) row.pakasirData = JSON.parse(row.pakasirData);
                if (row.accountData) row.accountData = JSON.parse(row.accountData);
            } catch (e) {
                console.warn('⚠️ Error parsing JSON for order:', orderId);
            }

            console.log('✅ Order found:', orderId);
            res.json({ 
                success: true, 
                order: row 
            });
        });
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        services: {
            whatsappBot: whatsappBot.isReady ? 'connected' : 'disconnected',
            pakasir: !!(process.env.PAKASIR_API_KEY && process.env.PAKASIR_PROJECT_SLUG) ? 'configured' : 'not configured',
            database: db ? 'connected' : 'file-based'
        },
        environment: process.env.NODE_ENV || 'development',
        port: PORT
    });
});

app.get('/api/stats', async (req, res) => {
    try {
        let stats = {
            orders: { total: 0, completed: 0, pending: 0, cancelled: 0 },
            whatsapp: {
                connected: whatsappBot.isReady,
                phoneNumber: whatsappBot.client?.info?.wid?.user || 'Not connected'
            },
            pakasir: {
                configured: !!(process.env.PAKASIR_API_KEY && process.env.PAKASIR_PROJECT_SLUG),
                project: process.env.PAKASIR_PROJECT_SLUG || null
            },
            system: {
                uptime: process.uptime(),
                nodeVersion: process.version,
                memory: process.memoryUsage(),
                platform: process.platform
            }
        };
        
        const ordersPath = path.join(__dirname, 'data', 'orders.json');
        if (fs.existsSync(ordersPath)) {
            const orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
            stats.orders.total = orders.length;
            stats.orders.completed = orders.filter(o => o.status === 'completed').length;
            stats.orders.pending = orders.filter(o => o.status === 'pending').length;
            stats.orders.cancelled = orders.filter(o => o.status === 'cancelled').length;
        }
        
        res.json({ success: true, stats });
    } catch (error) {
        log.error('Error fetching stats:', error);
        res.json({ success: false, error: 'Failed to fetch statistics' });
    }
});

app.use((req, res) => {
    res.status(404).json({ 
        success: false, 
        error: 'Route not found',
        path: req.path,
        timestamp: new Date().toISOString()
    });
});

app.use((error, req, res, next) => {
    log.error('Unhandled error:', error);
    res.status(500).json({
        success: false,
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
    });
});

const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
    log.info('✅ Created public directory');
}

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    log.info('✅ Created data directory');
}

const pendingDir = path.join(__dirname, 'pending');
if (!fs.existsSync(pendingDir)) {
    fs.mkdirSync(pendingDir, { recursive: true });
    log.info('✅ Created pending directory');
}

const rolesPath = path.join(dataDir, 'product.json');
if (!fs.existsSync(rolesPath)) {
    const defaultRoles = {
        roles: [
            { id: "spotify_2_bulan", name: "Spotify 2 Bulan", price: "5000", description: "Spotify Premium 2 Bulan", image: "/img/role/spotify.png", role_id: 1, stock: "0" },
            { id: "panel_do_10_droplet", name: "Panel Digital Ocean 10 Droplet", price: "40000", description: "Panel Digital Ocean dengan 10 Droplet", image: "/img/role/digitalocean.png", role_id: 2, stock: "0" },
            { id: "panel_do_3_droplet", name: "Panel Digital Ocean 3 Droplet", price: "30000", description: "Panel Digital Ocean dengan 3 Droplet", image: "/img/role/digitalocean.png", role_id: 3, stock: "0" },
            { id: "netflix_1_bulan", name: "Netflix 1 Bulan", price: "20000", description: "Netflix Premium 1 Bulan", image: "/img/role/netflix.png", role_id: 4, stock: "0" },
            { id: "wetv_1_bulan", name: "WeTV 1 Bulan", price: "15000", description: "WeTV Premium 1 Bulan", image: "/img/role/wetv.jpg", role_id: 5, stock: "0" },
            { id: "viu_trial", name: "VIU 1 Bulan", price: "15000", description: "VIU Premium 1 Bulan", image: "/img/role/viu.png", role_id: 6, stock: "0" }
        ]
    };
    fs.writeFileSync(rolesPath, JSON.stringify(defaultRoles, null, 2));
    log.info('✅ Created default product.json');
}

const ordersPath = path.join(dataDir, 'orders.json');
if (!fs.existsSync(ordersPath)) {
    fs.writeFileSync(ordersPath, JSON.stringify([], null, 2));
    log.info('✅ Created orders.json');
}

const httpServer = http.createServer(app);
httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    log.info(`🌐 HTTP Server running on port ${HTTP_PORT}`);
});

try {
    const webCrt = path.join(__dirname, 'web.crt');
    const webKey = path.join(__dirname, 'web.key');
    
    if (fs.existsSync(webCrt) && fs.existsSync(webKey)) {
        const httpsOptions = {
            cert: fs.readFileSync(webCrt),
            key: fs.readFileSync(webKey)
        };
        
        const httpsServer = https.createServer(httpsOptions, app);
        httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
            log.info(`🔒 HTTPS Server running on port ${HTTPS_PORT}`);
        });
    } else {
        log.warn('⚠️ SSL certificate files not found, HTTPS server not started');
    }
} catch (error) {
    log.error('❌ Failed to start HTTPS server:', error.message);
}

(async () => {
    try {
        console.log('\n🔄 Initial stock synchronization...');
        await stockSync.syncStock();
        console.log('✅ Initial sync completed\n');
    } catch (error) {
        console.error('❌ Initial sync failed:', error.message);
    }
})();

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 LyyShop ID SERVER BERHASIL DIJALANKAN!');
    console.log('='.repeat(70));
    console.log(`📡 Internal Port: ${PORT}`);
    console.log(`🌍 HTTP Port: ${HTTP_PORT}`);
    console.log(`🔒 HTTPS Port: ${HTTPS_PORT}`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log('='.repeat(70));
    console.log('📊 SERVICE STATUS:');
    console.log(`   📱 WhatsApp/Email Bot: ${whatsappBot.isReady ? '✅ READY' : '⏳ WAITING'}`);
    console.log(`   💳 Pakasir Payment: ${process.env.PAKASIR_API_KEY && process.env.PAKASIR_PROJECT_SLUG ? '✅ CONFIGURED' : '⚠️ NOT CONFIGURED'}`);
    console.log(`   🗄️ Database: ${db ? '✅ CONNECTED' : '⚠️ FILE-BASED'}`);
    console.log('='.repeat(70));
    console.log('📌 AVAILABLE ENDPOINTS:');
    console.log(`   🔗 Home: http://localhost:${PORT}/`);
    console.log(`   🔗 Admin Panel: http://localhost:${PORT}/admin`);
    console.log(`   🔗 Products: http://localhost:${PORT}/api/roles`);
    console.log(`   🔗 Accounts: http://localhost:${PORT}/api/admin/accounts`);
    console.log(`   🔗 Webhook: http://localhost:${PORT}/api/webhook/pakasir`);
    console.log(`   🔗 Update Product: PUT /api/admin/accounts/products/:id`);
    console.log('='.repeat(70) + '\n');
});

process.on('SIGTERM', () => {
    log.info('SIGTERM received, shutting down...');
    server.close(() => {
        log.info('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    log.info('SIGINT received, shutting down...');
    server.close(() => {
        log.info('Server closed');
        process.exit(0);
    });
});

module.exports = app;
