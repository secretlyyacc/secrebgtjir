const { Resend } = require('resend');
const fs = require('fs');
const path = require('path');

class WhatsAppBot {
    constructor() {
        this.isReady = false;
        this.config = this.loadConfig();
        this.resend = null;
        this.retryCount = 0;
        this.maxRetries = 5;
        this.initializing = false;
        this.initialize();
    }
    
    loadConfig() {
        try {
            const configPath = path.join(__dirname, '../../data/config.json');
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                console.log('✅ Config loaded from /data/config.json');
                return config;
            }
            
            console.warn('⚠️ Config file not found, using default config');
            return {
                whatsapp: {
                    adminNumber: 'akunpanelovh111@gmail.com',
                    autoSend: true,
                    retryAttempts: 3,
                    botPhoneNumber: ''
                }
            };
        } catch (error) {
            console.error('❌ Error loading config:', error);
            return { whatsapp: {} };
        }
    }
    
    initialize() {
        if (this.initializing) {
            console.log('⏳ Resend service already initializing...');
            return;
        }
        
        this.initializing = true;
        console.log('📧 Initializing Resend Email Service...');
        
        try {
            this.resend = new Resend('re_Ug5a5Azx_Pp2bXpXWApUwGMXtM6L8XDos');
            
            const timeout = setTimeout(() => {
                console.log('⏱️ Resend connection timeout, retrying...');
                this.handleFailure('timeout');
            }, 10000);
            
            this.resend.emails.send({
                from: 'noreply@mail.gtpsnet.my.id',
                to: 'akunpanelovh111@gmail.com',
                subject: 'Resend Test',
                html: '<p>Resend service initialized successfully</p>'
            }).then(() => {
                clearTimeout(timeout);
                console.log('✅ Resend service is ready');
                this.isReady = true;
                this.retryCount = 0;
                this.initializing = false;
                
                setTimeout(() => {
                    this.checkAndReplyToAdmin();
                }, 2000);
            }).catch((error) => {
                clearTimeout(timeout);
                console.error('❌ Resend service verification failed:', error.message);
                this.isReady = false;
                this.initializing = false;
                this.handleFailure('verify_error');
            });
            
        } catch (error) {
            console.error('❌ Failed to initialize Resend service:', error.message);
            this.isReady = false;
            this.initializing = false;
            this.handleFailure('init_error');
        }
    }
    
    handleFailure(reason) {
        this.retryCount++;
        
        if (this.retryCount <= this.maxRetries) {
            const delay = Math.min(10000 * this.retryCount, 60000);
            console.log(`🔄 Retrying in ${delay/1000} seconds... (Attempt ${this.retryCount}/${this.maxRetries})`);
            
            setTimeout(() => {
                console.log('🔄 Re-initializing Resend service...');
                this.initialize();
            }, delay);
        } else {
            console.error(`❌ Max retries (${this.maxRetries}) reached for Resend service`);
            console.log('⚠️ Email service will run in fallback mode');
            this.isReady = false;
            this.initializing = false;
        }
    }
    
    async getQRCode() {
        return null;
    }
    
    async getPairingCode() {
        return {
            code: 'EMAIL-ONLY',
            expiresAt: Date.now() + 86400000,
            expiresIn: 86400
        };
    }
    
    async getPairingRequest() {
        return null;
    }
    
    async createPhoneNumberPairing(phoneNumber) {
        return {
            id: 'EMAIL-' + Date.now(),
            phoneNumber: this.formatEmail(phoneNumber),
            pairingCode: 'EMAIL-MODE',
            expiresAt: Date.now() + 86400000,
            status: 'verified',
            method: 'email'
        };
    }
    
    async verifyPairingCode(phoneNumber, code) {
        return {
            success: true,
            message: 'Email mode active, no verification needed'
        };
    }
    
    async generateNewPairingCode() {
        return {
            code: 'EMAIL-ONLY',
            expiresAt: Date.now() + 86400000,
            expiresIn: 86400
        };
    }
    
    async sendAccountEmail(email, orderData) {
        if (!this.isReady || !this.resend) {
            console.log('⚠️ Resend service not ready, saving to queue');
            return {
                success: false,
                error: 'Email service not ready',
                queued: true,
                message: 'Order confirmed but email notification delayed',
                orderData: orderData
            };
        }
        
        try {
            const formattedEmail = this.formatEmail(email);
            
            const htmlContent = this.createProfessionalHtml(orderData);
            const textContent = this.createProfessionalText(orderData);
            
            const { data, error } = await this.resend.emails.send({
                from: 'noreply@mail.gtpsnet.my.id',
                to: formattedEmail,
                subject: `✨ Account Details - ${orderData.productName} (Order #${orderData.orderId})`,
                html: htmlContent,
                text: textContent
            });
            
            if (error) {
                console.error('❌ Resend API error:', error);
                throw new Error(error.message);
            }
            
            console.log(`📤 Account details sent via Resend to ${formattedEmail}`);
            
            await this.sendOrderNotification(orderData);
            
            return {
                success: true,
                phone: formattedEmail,
                message: 'Account details sent successfully via email',
                timestamp: new Date().toISOString(),
                messageId: data?.id
            };
            
        } catch (error) {
            console.error(`❌ Error sending email to ${email}:`, error.message);
            
            if (error.message.includes('connect') || error.message.includes('network')) {
                this.handleFailure('send_error');
            }
            
            return {
                success: false,
                error: error.message,
                fallback: true,
                accountData: orderData.accountData,
                message: 'Email failed but order completed. Please contact admin.'
            };
        }
    }
    
    async sendMessage(email, text) {
        if (!this.isReady || !this.resend) {
            return { success: false, error: 'Email service not ready' };
        }
        
        try {
            const formattedEmail = this.formatEmail(email);
            
            const { data, error } = await this.resend.emails.send({
                from: 'noreply@mail.gtpsnet.my.id',
                to: formattedEmail,
                subject: 'Pesan dari LyyShop ID',
                html: `<div style="font-family: Arial; padding: 20px;">${text.replace(/\n/g, '<br>')}</div>`,
                text: text
            });
            
            if (error) {
                return { success: false, error: error.message };
            }
            
            return { success: true, phone: formattedEmail, messageId: data?.id };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    
    async sendOrderNotification(orderData) {
        if (!this.config?.whatsapp?.adminNumber || !this.resend) {
            return;
        }
        
        try {
            const adminEmail = this.config.whatsapp.adminNumber;
            
            const message = `🛒 NEW ORDER RECEIVED\n\n` +
                           `═══════════════════════════\n\n` +
                           `Order ID: ${orderData.orderId || 'N/A'}\n` +
                           `Product: ${orderData.productName || 'N/A'}\n` +
                           `Price: Rp ${orderData.amount ? parseInt(orderData.amount).toLocaleString() : '0'}\n` +
                           `Customer: ${orderData.customer || orderData.username || 'N/A'}\n` +
                           `Payment Method: ${orderData.paymentMethod || 'N/A'}\n\n` +
                           `Account Details:\n` +
                           `Email: ${orderData.accountData?.email || 'N/A'}\n` +
                           `Password: ${orderData.accountData?.password || 'N/A'}\n` +
                           `2FA: ${orderData.accountData?.twofa || orderData.accountData?.twofa_code || 'None'}\n\n` +
                           `Time: ${new Date().toLocaleString('id-ID')}\n` +
                           `Email Status: ${this.isReady ? '✅ SENT TO CUSTOMER' : '❌ FAILED'}`;
            
            if (this.isReady) {
                await this.resend.emails.send({
                    from: 'noreply@mail.gtpsnet.my.id',
                    to: adminEmail,
                    subject: `🛒 New Order: ${orderData.orderId}`,
                    text: message
                });
                console.log(`📤 Admin notification sent to ${adminEmail}`);
            } else {
                console.log(`📝 Admin notification saved:`, message);
            }
        } catch (error) {
            console.error('Admin notification error:', error.message);
        }
    }
    
    async sendStockNotification(productName) {
        if (!this.config?.whatsapp?.adminNumber || !this.resend) {
            return;
        }
        
        try {
            const adminEmail = this.config.whatsapp.adminNumber;
            
            const message = `⚠️ STOCK ALERT\n\n` +
                           `══════════════\n\n` +
                           `Product: ${productName}\n` +
                           `Status: Low Stock\n` +
                           `Time: ${new Date().toLocaleString('id-ID')}\n\n` +
                           `Please add more accounts to stock immediately.`;
            
            if (this.isReady) {
                await this.resend.emails.send({
                    from: 'noreply@mail.gtpsnet.my.id',
                    to: adminEmail,
                    subject: '⚠️ Low Stock Alert',
                    text: message
                });
            } else {
                console.log(`📝 Stock alert saved:`, message);
            }
        } catch (error) {
            console.error('Stock notification error:', error.message);
        }
    }
    
    async checkAndReplyToAdmin() {
        if (!this.isReady || !this.resend || !this.config?.whatsapp?.adminNumber) {
            return;
        }
        
        try {
            const adminEmail = this.config.whatsapp.adminNumber;
            
            const message = `🚀 EMAIL SERVICE ACTIVE\n\n` +
                           `═══════════════════════\n\n` +
                           `Your email service is now online and ready to send account details to customers.\n\n` +
                           `📧 From: noreply@mail.gtpsnet.my.id\n` +
                           `📊 Status: Active\n` +
                           `⏰ Time: ${new Date().toLocaleString('id-ID')}\n\n` +
                           `All new orders will automatically receive their account credentials via email.`;
            
            await this.resend.emails.send({
                from: 'noreply@mail.gtpsnet.my.id',
                to: adminEmail,
                subject: '✅ Email Service Started',
                text: message
            });
            
            console.log(`📤 Startup notification sent to admin`);
            
        } catch (error) {
            console.error('❌ Failed to send startup notification:', error.message);
        }
    }
    
    formatEmail(email) {
        if (!email) return '';
        let cleaned = email.trim().toLowerCase();
        cleaned = cleaned.replace(/\s+/g, '');
        if (!cleaned.includes('@')) {
            cleaned = cleaned + '@gmail.com';
        }
        return cleaned;
    }
    
    createProfessionalHtml(orderData) {
        const amount = orderData.amount ? parseInt(orderData.amount).toLocaleString('id-ID') : '0';
        const accountData = orderData.accountData || {};
        const additional = accountData.additional || accountData.additional_info || {};
        const orderId = orderData.orderId || 'N/A';
        const productName = orderData.productName || 'Product';
        const customerName = orderData.customer || orderData.username || 'Customer';
        const date = new Date().toLocaleDateString('id-ID', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
        
        const bannerUrl = 'https://shop.lyxtech.xyz/img/banner.png';
        
        let additionalInfoHtml = '';
        if (Object.keys(additional).length > 0) {
            additionalInfoHtml = '<tr><td colspan="2" style="padding: 15px 0 5px 0;"><strong>Additional Information:</strong></td></tr>';
            for (const [key, value] of Object.entries(additional)) {
                if (value) {
                    additionalInfoHtml += `<tr><td style="padding: 5px 0 5px 20px;">• ${key}:</td><td style="padding: 5px 0;"><strong>${value}</strong></td></tr>`;
                }
            }
        }
        
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Account Details - LyyShop ID</title>
            </head>
            <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                <div style="max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
                    
                    <!-- Header with Banner -->
                    <div style="position: relative; text-align: center;">
                        <img src="${bannerUrl}" alt="LyyShop ID Banner" style="width: 100%; height: auto; display: block;" onerror="this.style.display='none'">
                        <div style="background: linear-gradient(135deg, #667eea, #764ba2); padding: 30px 20px; ${!bannerUrl ? 'display: block;' : ''}">
                            <h1 style="color: white; margin: 0; font-size: 32px; text-shadow: 2px 2px 4px rgba(0,0,0,0.2);">🎮 LyyShop ID</h1>
                            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">Premium Gaming Accounts</p>
                        </div>
                    </div>
                    
                    <!-- Main Content -->
                    <div style="padding: 40px 30px;">
                        <!-- Greeting -->
                        <div style="margin-bottom: 30px;">
                            <h2 style="color: #333; margin: 0 0 5px 0;">Hello, ${customerName}!</h2>
                            <p style="color: #666; margin: 0;">Thank you for your purchase. Here are your account details:</p>
                        </div>
                        
                        <!-- Order Summary Card -->
                        <div style="background: linear-gradient(135deg, #f5f7fa 0%, #e4e8f0 100%); border-radius: 12px; padding: 20px; margin-bottom: 30px;">
                            <h3 style="color: #333; margin: 0 0 15px 0; border-bottom: 2px solid #667eea; padding-bottom: 10px;">📋 Order Summary</h3>
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr>
                                    <td style="padding: 8px 0; color: #555;">Order ID:</td>
                                    <td style="padding: 8px 0; font-weight: 600; color: #333;">${orderId}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 0; color: #555;">Product:</td>
                                    <td style="padding: 8px 0; font-weight: 600; color: #333;">${productName}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 0; color: #555;">Amount:</td>
                                    <td style="padding: 8px 0; font-weight: 600; color: #28a745;">Rp ${amount}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 0; color: #555;">Purchase Date:</td>
                                    <td style="padding: 8px 0; color: #666;">${date}</td>
                                </tr>
                            </table>
                        </div>
                        
                        <!-- Account Details Card -->
                        <div style="background: linear-gradient(135deg, #fff5f5 0%, #ffe8e8 100%); border-radius: 12px; padding: 20px; margin-bottom: 30px; border: 2px solid #ff6b6b;">
                            <h3 style="color: #c92a2a; margin: 0 0 15px 0; border-bottom: 2px solid #ff6b6b; padding-bottom: 10px;">🔐 Account Credentials</h3>
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr>
                                    <td style="padding: 12px 0; background-color: #fff; border-radius: 8px 0 0 8px;">
                                        <div style="background-color: #f0f0f0; padding: 10px; border-radius: 8px 0 0 8px;">
                                            <strong style="color: #555;">📧 Email:</strong>
                                        </div>
                                    </td>
                                    <td style="padding: 12px 0; background-color: #fff; border-radius: 0 8px 8px 0;">
                                        <div style="background-color: #e8f5e9; padding: 10px; border-radius: 0 8px 8px 0; font-family: monospace; font-size: 16px;">
                                            ${accountData.email || 'N/A'}
                                        </div>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 12px 0; background-color: #fff;">
                                        <div style="background-color: #f0f0f0; padding: 10px;">
                                            <strong style="color: #555;">🔑 Password:</strong>
                                        </div>
                                    </td>
                                    <td style="padding: 12px 0; background-color: #fff;">
                                        <div style="background-color: #fff3cd; padding: 10px; font-family: monospace; font-size: 16px;">
                                            ${accountData.password || 'N/A'}
                                        </div>
                                    </td>
                                </tr>
                                ${accountData.twofa || accountData.twofa_code ? `
                                <tr>
                                    <td style="padding: 12px 0; background-color: #fff;">
                                        <div style="background-color: #f0f0f0; padding: 10px;">
                                            <strong style="color: #555;">🔐 2FA Code:</strong>
                                        </div>
                                    </td>
                                    <td style="padding: 12px 0; background-color: #fff;">
                                        <div style="background-color: #d1ecf1; padding: 10px; font-family: monospace; font-size: 16px;">
                                            ${accountData.twofa || accountData.twofa_code || 'N/A'}
                                        </div>
                                    </td>
                                </tr>
                                ` : ''}
                                ${additionalInfoHtml}
                            </table>
                        </div>
                        
                        <!-- Important Notes -->
                        <div style="background-color: #fff3cd; border-left: 6px solid #ffc107; padding: 20px; border-radius: 8px; margin-bottom: 30px;">
                            <h4 style="color: #856404; margin: 0 0 10px 0;">⚠️ Important Security Notes:</h4>
                            <ul style="margin: 0; padding-left: 20px; color: #856404;">
                                <li style="margin-bottom: 8px;">Change the password immediately after logging in</li>
                                <li style="margin-bottom: 8px;">Do not share these credentials with anyone</li>
                                <li style="margin-bottom: 8px;">Enable 2FA if not already enabled</li>
                                <li style="margin-bottom: 8px;">Contact admin if you experience any issues</li>
                            </ul>
                        </div>
                        
                        <!-- Instructions -->
                        <div style="background-color: #e8f5e9; border-left: 6px solid #28a745; padding: 20px; border-radius: 8px; margin-bottom: 30px;">
                            <h4 style="color: #155724; margin: 0 0 10px 0;">📱 How to Login:</h4>
                            <ol style="margin: 0; padding-left: 20px; color: #155724;">
                                <li style="margin-bottom: 8px;">Open the game client</li>
                                <li style="margin-bottom: 8px;">Click on "Login" button</li>
                                <li style="margin-bottom: 8px;">Enter the email and password above</li>
                                <li style="margin-bottom: 8px;">If prompted, enter the 2FA code</li>
                                <li style="margin-bottom: 8px;">Enjoy your new account!</li>
                            </ol>
                        </div>
                        
                        <!-- Support -->
                        <div style="text-align: center; padding-top: 20px; border-top: 2px solid #eee;">
                            <p style="color: #666; margin: 0 0 10px 0;">Need help? Contact our support team:</p>
                            <a href="mailto:support@gtpsnet.my.id" style="color: #667eea; text-decoration: none; font-weight: 600;">support@gtpsnet.my.id</a>
                            <p style="color: #999; font-size: 12px; margin-top: 20px;">© 2026 LyyShop ID. All rights reserved.</p>
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `;
    }
    
    createProfessionalText(orderData) {
        const amount = orderData.amount ? parseInt(orderData.amount).toLocaleString('id-ID') : '0';
        const accountData = orderData.accountData || {};
        const additional = accountData.additional || accountData.additional_info || {};
        const orderId = orderData.orderId || 'N/A';
        const productName = orderData.productName || 'Product';
        const customerName = orderData.customer || orderData.username || 'Customer';
        const date = new Date().toLocaleDateString('id-ID');
        
        let text = `========================================\n`;
        text += `           LyyShop ID - ACCOUNT DETAILS\n`;
        text += `========================================\n\n`;
        
        text += `Hello ${customerName},\n\n`;
        text += `Thank you for your purchase! Here are your account details:\n\n`;
        
        text += `ORDER SUMMARY\n`;
        text += `----------------------------------------\n`;
        text += `Order ID:    ${orderId}\n`;
        text += `Product:     ${productName}\n`;
        text += `Amount:      Rp ${amount}\n`;
        text += `Date:        ${date}\n\n`;
        
        text += `ACCOUNT CREDENTIALS\n`;
        text += `----------------------------------------\n`;
        text += `Email:       ${accountData.email || 'N/A'}\n`;
        text += `Password:    ${accountData.password || 'N/A'}\n`;
        
        if (accountData.twofa || accountData.twofa_code) {
            text += `2FA Code:    ${accountData.twofa || accountData.twofa_code}\n`;
        }
        
        if (Object.keys(additional).length > 0) {
            text += `\nADDITIONAL INFORMATION\n`;
            text += `----------------------------------------\n`;
            for (const [key, value] of Object.entries(additional)) {
                if (value) {
                    text += `${key}: ${value}\n`;
                }
            }
        }
        
        text += `\nIMPORTANT NOTES\n`;
        text += `----------------------------------------\n`;
        text += `• Change password immediately after login\n`;
        text += `• Do not share credentials with anyone\n`;
        text += `• Enable 2FA if not already enabled\n`;
        text += `• Contact admin if you experience issues\n\n`;
        
        text += `HOW TO LOGIN\n`;
        text += `----------------------------------------\n`;
        text += `1. Open the game client\n`;
        text += `2. Click on "Login" button\n`;
        text += `3. Enter the email and password above\n`;
        text += `4. If prompted, enter the 2FA code\n`;
        text += `5. Enjoy your new account!\n\n`;
        
        text += `Need help? Contact: support@gtpsnet.my.id\n\n`;
        text += `========================================\n`;
        text += `     © 2026 LyyShop ID. All rights reserved.\n`;
        text += `========================================`;
        
        return text;
    }
    
    getStatus() {
        return {
            isReady: this.isReady,
            hasQR: false,
            pairingCode: 'EMAIL-ONLY',
            pairingRequest: null,
            isWaitingForPairingCode: false,
            phoneNumber: 'growlycs@gmail.com',
            pushname: this.isReady ? 'Resend Service (Active)' : 'Resend Service (Offline)',
            platform: 'Resend API',
            adminNumber: this.config?.whatsapp?.adminNumber || 'Not set',
            sessionExists: true,
            retryCount: this.retryCount,
            maxRetries: this.maxRetries,
            timestamp: new Date().toISOString()
        };
    }
    
    logout() {
        console.log('👋 Logging out email service...');
        this.isReady = false;
        return Promise.resolve({ success: true });
    }
    
    restart() {
        console.log('🔄 Restarting Resend service...');
        this.isReady = false;
        this.initializing = false;
        this.retryCount = 0;
        setTimeout(() => {
            this.initialize();
        }, 2000);
    }
    
    destroy() {
        this.isReady = false;
        this.initializing = false;
        this.resend = null;
    }
}

let whatsappBot = null;

try {
    whatsappBot = new WhatsAppBot();
    console.log('✅ Resend Service instance created');
} catch (error) {
    console.error('❌ Failed to create Resend Service:', error.message);
    whatsappBot = {
        isReady: false,
        getStatus: () => ({ isReady: false, error: 'Initialization failed' }),
        sendAccountEmail: async () => ({ success: false, error: 'Service not available' }),
        sendMessage: async () => ({ success: false, error: 'Service not available' }),
        sendOrderNotification: async () => {},
        sendStockNotification: async () => {},
        getQRCode: async () => null,
        getPairingCode: async () => ({ code: 'ERROR' }),
        createPhoneNumberPairing: async () => null,
        verifyPairingCode: async () => ({ success: false }),
        getPairingRequest: async () => null,
        generateNewPairingCode: async () => ({ code: 'ERROR' }),
        checkAndReplyToAdmin: async () => {},
        restart: () => console.log('Service not available'),
        destroy: () => {},
        logout: () => Promise.resolve({ success: true })
    };
}

process.on('SIGINT', () => {
    console.log('\n👋 Shutting down email service...');
    if (whatsappBot && whatsappBot.destroy) whatsappBot.destroy();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n👋 Terminating email service...');
    if (whatsappBot && whatsappBot.destroy) whatsappBot.destroy();
    process.exit(0);
});

setInterval(() => {
    if (whatsappBot && !whatsappBot.isReady && !whatsappBot.initializing) {
        console.log('🔄 Auto-recovery: Resend service not ready, attempting restart...');
        whatsappBot.restart();
    }
}, 60000);

module.exports = whatsappBot;
