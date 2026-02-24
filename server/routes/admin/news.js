// server/routes/admin/news.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { authenticateToken } = require('../../middleware/auth');

// PERBAIKAN PATH: data folder ada di root, bukan di server
const NEWS_PATH = path.join(__dirname, '../../../data/news.json');

function readNews() {
    try {
        // Buat folder data dulu kalau belum ada
        const dataDir = path.join(__dirname, '../../../data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        if (!fs.existsSync(NEWS_PATH)) {
            // Buat file default kalau belum ada
            const defaultNews = { active: null, history: [] };
            fs.writeFileSync(NEWS_PATH, JSON.stringify(defaultNews, null, 2));
            return defaultNews;
        }
        
        return JSON.parse(fs.readFileSync(NEWS_PATH, 'utf8'));
    } catch (error) {
        console.error('Error reading news:', error);
        return { active: null, history: [] };
    }
}

function writeNews(data) {
    try {
        // Pastikan folder data ada
        const dataDir = path.join(__dirname, '../../../data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        fs.writeFileSync(NEWS_PATH, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing news:', error);
        return false;
    }
}

// Public endpoint - no auth needed
router.get('/active', (req, res) => {
    try {
        const news = readNews();
        res.json({
            success: true,
            news: news.active || null
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admin endpoints - perlu auth
router.get('/all', authenticateToken, (req, res) => {
    try {
        const news = readNews();
        res.json({
            success: true,
            active: news.active,
            history: news.history || []
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/', authenticateToken, (req, res) => {
    try {
        const { title, message, imageUrl, isActive } = req.body;
        
        if (!title || !message) {
            return res.status(400).json({
                success: false,
                error: 'Title and message are required'
            });
        }

        const news = readNews();
        const newNews = {
            id: Date.now().toString(),
            title: title.substring(0, 100),
            message: message.substring(0, 1000),
            imageUrl: imageUrl || null,
            isActive: isActive === true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        if (isActive) {
            // Deactivate previous news
            if (news.active) {
                news.history = news.history || [];
                news.history.unshift({
                    ...news.active,
                    deactivatedAt: new Date().toISOString()
                });
                news.history = news.history.slice(0, 20);
            }
            news.active = newNews;
        } else {
            news.history = news.history || [];
            news.history.unshift({
                ...newNews,
                deactivatedAt: new Date().toISOString()
            });
            news.history = news.history.slice(0, 20);
        }

        if (writeNews(news)) {
            res.json({
                success: true,
                message: 'News saved successfully',
                news: newNews
            });
        } else {
            res.status(500).json({ success: false, error: 'Failed to save news' });
        }
    } catch (error) {
        console.error('Error saving news:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/deactivate', authenticateToken, (req, res) => {
    try {
        const news = readNews();
        
        if (news.active) {
            news.history = news.history || [];
            news.history.unshift({
                ...news.active,
                deactivatedAt: new Date().toISOString()
            });
            news.active = null;
            news.history = news.history.slice(0, 20);
            
            if (writeNews(news)) {
                res.json({ success: true, message: 'News deactivated' });
            } else {
                res.status(500).json({ success: false, error: 'Failed to save' });
            }
        } else {
            res.json({ success: true, message: 'No active news' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/history/:id', authenticateToken, (req, res) => {
    try {
        const { id } = req.params;
        const news = readNews();
        
        if (news.history) {
            news.history = news.history.filter(item => item.id !== id);
            if (writeNews(news)) {
                res.json({ success: true, message: 'News deleted' });
            } else {
                res.status(500).json({ success: false, error: 'Failed to save' });
            }
        } else {
            res.json({ success: true, message: 'No history' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
