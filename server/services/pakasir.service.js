const axios = require('axios');
const fs = require('fs');
const path = require('path');

class PakasirService {
    constructor() {
        // Load config dari file
        this.loadConfig();
        this.baseUrl = process.env.PAKASIR_BASE_URL || 'https://app.pakasir.com';
    }
    
    loadConfig() {
        try {
            const configPath = path.join(__dirname, '../../data/config.json');
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                
                // Prioritaskan dari config.json, fallback ke process.env
                this.projectSlug = config.pakasir?.project || 
                                   config.pakasir?.merchant_id || 
                                   process.env.PAKASIR_PROJECT_SLUG || 
                                   'gtlyy-payment';
                                   
                this.apiKey = config.pakasir?.api_key || 
                              process.env.PAKASIR_API_KEY || 
                              '';
                              
                console.log('✅ PakasirService: Using project slug =', this.projectSlug);
            } else {
                // Fallback ke environment variables
                this.projectSlug = process.env.PAKASIR_PROJECT_SLUG || 'gtps-shop';
                this.apiKey = process.env.PAKASIR_API_KEY || '';
                console.warn('⚠️ PakasirService: config.json not found, using env vars');
            }
        } catch (error) {
            console.error('❌ PakasirService: Error loading config', error.message);
            this.projectSlug = process.env.PAKASIR_PROJECT_SLUG || 'gtps-shop';
            this.apiKey = process.env.PAKASIR_API_KEY || '';
        }
    }

    // Create transaction via API (for QRIS/VA display on your site)
    async createTransaction(method, orderId, amount) {
        try {
            console.log('🔍 Creating transaction with project:', this.projectSlug);
            const response = await axios.post(
                `${this.baseUrl}/api/transactioncreate/${method}`,
                {
                    project: this.projectSlug,
                    order_id: orderId,
                    amount: amount,
                    api_key: this.apiKey
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );
            return response.data;
        } catch (error) {
            console.error('Pakasir API Error:', error.response?.data || error.message);
            throw error;
        }
    }

    // Get transaction details
    async getTransactionDetail(orderId, amount) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/api/transactiondetail`,
                {
                    params: {
                        project: this.projectSlug,
                        order_id: orderId,
                        amount: amount,
                        api_key: this.apiKey
                    }
                }
            );
            return response.data;
        } catch (error) {
            console.error('Pakasir API Error:', error.response?.data || error.message);
            throw error;
        }
    }

    // Cancel transaction
    async cancelTransaction(orderId, amount) {
        try {
            const response = await axios.post(
                `${this.baseUrl}/api/transactioncancel`,
                {
                    project: this.projectSlug,
                    order_id: orderId,
                    amount: amount,
                    api_key: this.apiKey
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );
            return response.data;
        } catch (error) {
            console.error('Pakasir API Error:', error.response?.data || error.message);
            throw error;
        }
    }

    // Simulate payment (sandbox mode only)
    async simulatePayment(orderId, amount) {
        try {
            const response = await axios.post(
                `${this.baseUrl}/api/paymentsimulation`,
                {
                    project: this.projectSlug,
                    order_id: orderId,
                    amount: amount,
                    api_key: this.apiKey
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );
            return response.data;
        } catch (error) {
            console.error('Pakasir API Error:', error.response?.data || error.message);
            throw error;
        }
    }

    // Generate payment URL (for redirect method)
    getPaymentUrl(orderId, amount, options = {}) {
        console.log('🔗 Generating URL with project:', this.projectSlug);
        let url = `${this.baseUrl}/pay/${this.projectSlug}/${amount}?order_id=${orderId}`;
        
        if (options.redirect) {
            url += `&redirect=${encodeURIComponent(options.redirect)}`;
        }
        
        if (options.qrisOnly) {
            url += `&qris_only=1`;
        }
        
        return url;
    }

    // Generate PayPal URL
    getPaypalUrl(orderId, amount) {
        return `${this.baseUrl}/paypal/${this.projectSlug}/${amount}?order_id=${orderId}`;
    }

    // Available payment methods
    getPaymentMethods() {
        return [
            { id: 'qris', name: 'QRIS' },
            { id: 'cimb_niaga_va', name: 'CIMB Niaga VA' },
            { id: 'bni_va', name: 'BNI VA' },
            { id: 'bri_va', name: 'BRI VA' },
            { id: 'maybank_va', name: 'Maybank VA' },
            { id: 'permata_va', name: 'Permata VA' },
            { id: 'atm_bersama_va', name: 'ATM Bersama VA' },
            { id: 'artha_graha_va', name: 'Artha Graha VA' },
            { id: 'bnc_va', name: 'BNC VA' },
            { id: 'sampoerna_va', name: 'Sampoerna VA' },
            { id: 'paypal', name: 'PayPal' }
        ];
    }
    
    // Reload config (berguna kalau config diubah runtime)
    reloadConfig() {
        this.loadConfig();
        console.log('🔄 PakasirService config reloaded');
    }
}

module.exports = new PakasirService();
