const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'GrowLyy_super_secret_key_2026_change_this';

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }
    
    try {
        const verified = jwt.verify(token, JWT_SECRET);
        req.admin = verified;
        next();
    } catch (error) {
        console.error('Token verification error:', error.message);
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired. Please login again.' });
        }
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(403).json({ error: 'Invalid token.' });
        }
        
        return res.status(403).json({ error: 'Access denied. Invalid token.' });
    }
};

module.exports = { authenticateToken, JWT_SECRET };