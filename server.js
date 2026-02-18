require('dotenv').config();
const jwt = require('jsonwebtoken');
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
  //  { path: '/pending', file: 'pending' },
    //{ path: '/api/admin/redeem-codes', file: 'redeem-upload' }
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

// Endpoint untuk cek status stock
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
        const roles = require('./data/product.json');
        res.json(roles);
    } catch (error) {
        console.error('Error fetching roles data', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch roles' });
    }
});

app.get('/api/order/:orderId', (req, res) => {
    const { orderId } = req.params;
    console.log('🔍 Looking for order:', orderId);

    // Buat koneksi baru untuk setiap request (temporary fix)
    const tempDb = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
            console.error('❌ Cannot open database:', err.message);
            return res.status(500).json({ 
                success: false, 
                error: 'Database connection failed' 
            });
        }

        // Set timeout
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

            // Parse JSON fields
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
app.use('/api/admin/accounts', require('./server/routes/admin/accounts'));

function getOrderCount() {
    try {
        const ordersPath = path.join(__dirname, 'data', 'orders.json');
        if (fs.existsSync(ordersPath)) {
            const orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
            return orders.length;
        }
    } catch (error) {}
    return 0;
}

function getCompletedCount() {
    try {
        const ordersPath = path.join(__dirname, 'data', 'orders.json');
        if (fs.existsSync(ordersPath)) {
            const orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
            return orders.filter(o => o.status === 'completed').length;
        }
    } catch (error) {}
    return 0;
}

function getPendingCount() {
    try {
        const ordersPath = path.join(__dirname, 'data', 'orders.json');
        if (fs.existsSync(ordersPath)) {
            const orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
            return orders.filter(o => o.status === 'pending').length;
        }
    } catch (error) {}
    return 0;
}

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
            { id: 1, name: "Legendary", price: 100000, description: "Legendary Role", stock: 10 },
            { id: 2, name: "Mythic", price: 250000, description: "Mythic Role", stock: 5 },
            { id: 3, name: "Godly", price: 500000, description: "Godly Role", stock: 3 }
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

const pendingHtmlPath = path.join(pendingDir, 'pending.html');
if (!fs.existsSync(pendingHtmlPath)) {
    const pendingHtml = `<!DOCTYPE html>
<html>
<head>
    <title>Payment Status - LyyShop ID</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100">
    <div class="container mx-auto p-8">
        <div class="max-w-md mx-auto bg-white rounded-lg shadow-lg p-8 text-center">
            <div class="text-6xl mb-4">⏳</div>
            <h1 class="text-2xl font-bold mb-4">Payment Pending</h1>
            <p class="text-gray-600 mb-2">Order ID: <span id="orderId">ORDER_ID_PLACEHOLDER</span></p>
            <p class="text-gray-600 mb-6">Your payment is being processed.</p>
            
            <div class="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 mb-6 text-left">
                <p class="font-bold">📱 Payment Instructions:</p>
                <p class="text-sm mt-2">1. Complete the payment using QRIS or Virtual Account</p>
                <p class="text-sm">2. Wait for confirmation (usually 1-2 minutes)</p>
                <p class="text-sm">3. Redeem code will be sent via email</p>
            </div>
            
            <div class="space-y-3">
                <button onclick="checkStatus()" class="w-full bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
                    🔄 Check Status
                </button>
                <a href="/" class="block w-full bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600">
                    🏠 Back to Home
                </a>
            </div>
            
            <div id="statusMessage" class="mt-4 text-sm text-gray-600"></div>
        </div>
    </div>
    
    <script>
        const urlParams = new URLSearchParams(window.location.search);
        const orderId = urlParams.get('order') || 'ORDER_ID_PLACEHOLDER';
        document.getElementById('orderId').textContent = orderId;
        
        async function checkStatus() {
            const statusDiv = document.getElementById('statusMessage');
            statusDiv.innerHTML = 'Checking status...';
            
            try {
                const response = await fetch('/api/order/' + orderId);
                const data = await response.json();
                
                if (data.success && data.order) {
                    if (data.order.status === 'completed') {
                        statusDiv.innerHTML = '✅ Payment completed! Check your email for redeem code.';
                        statusDiv.className = 'mt-4 text-sm text-green-600 font-bold';
                    } else if (data.order.status === 'pending') {
                        statusDiv.innerHTML = '⏳ Payment still pending. Please complete your payment.';
                        statusDiv.className = 'mt-4 text-sm text-yellow-600';
                    } else {
                        statusDiv.innerHTML = 'Status: ' + data.order.status;
                        statusDiv.className = 'mt-4 text-sm text-gray-600';
                    }
                } else {
                    statusDiv.innerHTML = '❌ Order not found';
                    statusDiv.className = 'mt-4 text-sm text-red-600';
                }
            } catch (error) {
                statusDiv.innerHTML = '❌ Error checking status';
                statusDiv.className = 'mt-4 text-sm text-red-600';
            }
        }
        
        setTimeout(checkStatus, 3000);
        setInterval(checkStatus, 10000);
    </script>
</body>
</html>`;
    fs.writeFileSync(pendingHtmlPath, pendingHtml);
    log.info('✅ Created pending.html');
}

const scanHtmlPath = path.join(publicDir, 'scan.html');
if (!fs.existsSync(scanHtmlPath)) {
    const scanHtml = `<!DOCTYPE html>
<html>
<head>
    <title>WhatsApp Scanner - LyyShop ID</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100">
    <div class="container mx-auto p-8">
        <div class="max-w-md mx-auto bg-white rounded-lg shadow-lg p-8 text-center">
            <h1 class="text-2xl font-bold mb-4">🤖 WhatsApp Scanner</h1>
            <div id="qrContainer" class="bg-gray-50 p-4 rounded-lg mb-4">
                <img id="qrImage" src="" alt="QR Code" class="mx-auto max-w-full hidden">
                <div id="loadingText" class="text-gray-500">Loading QR code...</div>
            </div>
            <div id="status" class="text-sm mb-4"></div>
            <button onclick="refreshQR()" class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
                Refresh QR
            </button>
        </div>
    </div>
    <script>
        async function refreshQR() {
            const qrImage = document.getElementById('qrImage');
            const loadingText = document.getElementById('loadingText');
            const statusDiv = document.getElementById('status');
            
            qrImage.classList.add('hidden');
            loadingText.classList.remove('hidden');
            statusDiv.innerHTML = 'Fetching QR code...';
            
            try {
                const response = await fetch('/api/bot/qr');
                const data = await response.json();
                
                if (data.success && data.qrCode) {
                    qrImage.src = data.qrCode;
                    qrImage.classList.remove('hidden');
                    loadingText.classList.add('hidden');
                    statusDiv.innerHTML = 'Scan this QR code with WhatsApp';
                } else if (data.isReady) {
                    qrImage.classList.add('hidden');
                    loadingText.classList.add('hidden');
                    statusDiv.innerHTML = '✅ Bot is already connected and ready!';
                } else {
                    qrImage.classList.add('hidden');
                    loadingText.classList.remove('hidden');
                    loadingText.innerHTML = data.message || 'Waiting for QR code...';
                    statusDiv.innerHTML = '';
                }
            } catch (error) {
                statusDiv.innerHTML = 'Error: ' + error.message;
            }
        }
        
        refreshQR();
        setInterval(refreshQR, 5000);
    </script>
</body>
</html>`;
    fs.writeFileSync(scanHtmlPath, scanHtml);
    log.info('✅ Created scan.html');
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
    console.log(`   🔗 QR Scanner: http://localhost:${PORT}/scan`);
    console.log(`   🔗 Bot Status: http://localhost:${PORT}/api/bot/status`);
    console.log(`   🔗 Payment Methods: http://localhost:${PORT}/api/pakasir/methods`);
    console.log(`   🔗 Webhook Health: http://localhost:${PORT}/api/webhook/health`);
    console.log(`   🔗 Health Check: http://localhost:${PORT}/health`);
    console.log(`   🔗 Statistics: http://localhost:${PORT}/api/stats`);
    console.log('='.repeat(70));
    console.log(`📧 Email Service: growlycs@gmail.com`);
    console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
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



