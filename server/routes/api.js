const whatsappBot = require('./server/models/WhatsAppBot');

router.get('/bot/qr', async (req, res) => {
    try {
        const qrCode = await whatsappBot.getQRCode();
        
        if (!qrCode) {
            return res.status(200).json({
                success: false,
                message: 'QR Code belum tersedia. Tunggu beberapa detik...',
                isReady: whatsappBot.isReady
            });
        }
        
        res.json({
            success: true,
            qrCode: qrCode,
            isReady: whatsappBot.isReady,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('QR endpoint error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint untuk bot status
router.get('/bot/status', (req, res) => {
    const status = whatsappBot.getStatus();
    res.json(status);
});

// Endpoint untuk restart bot
router.post('/bot/restart', (req, res) => {
    whatsappBot.restart();
    res.json({ success: true, message: 'Bot restarting...' });
});