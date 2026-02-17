require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('../server/models/Admin');
const connectDB = require('../server/config/database');

async function setupAdmin() {
    try {
        await connectDB();
        
        // Check if admin exists
        const existingAdmin = await Admin.findOne({ username: 'admin' });
        
        if (existingAdmin) {
            console.log('✅ Admin already exists');
            process.exit(0);
        }
        
        // Create default admin
        const admin = new Admin({
            username: 'admin',
            password: 'GrowLyy2026',
            role: 'superadmin'
        });
        
        await admin.save();
        console.log('✅ Default admin created:');
        console.log('   Username: admin');
        console.log('   Password: GrowLyy2026');
        console.log('\n⚠️  CHANGE THIS PASSWORD IMMEDIATELY!');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Setup error:', error);
        process.exit(1);
    }
}

setupAdmin();