const { Client, LocalAuth } = require('whatsapp-web.js');
const EventEmitter = require('events');

class WhatsAppClient extends EventEmitter {
    constructor() {
        super();
        this.client = null;
        this.qrCode = null;
        this.isReady = false;
        this.isAuthenticated = false;
        this.isInitializing = false;
        this.initRetryCount = 0;
        this.maxRetries = 3;
    }

    async initialize() {
        // Prevent multiple simultaneous initialization attempts
        if (this.isInitializing) {
            console.log('Initialization already in progress, skipping...');
            return;
        }

        this.isInitializing = true;

        // Clean up any existing client first
        if (this.client) {
            try {
                console.log('Destroying existing client before re-initialization...');
                await this.client.destroy();
            } catch (err) {
                console.log('Error destroying existing client:', err.message);
            }
            this.client = null;
        }

        try {
            this.client = new Client({
                authStrategy: new LocalAuth({
                    dataPath: './.wwebjs_auth'
                }),
                puppeteer: {
                    headless: true,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        '--disable-gpu'
                    ]
                }
            });

            // Track loading screen progress
            this.client.on('loading_screen', (percent, message) => {
                console.log(`WhatsApp loading: ${percent}% - ${message}`);
                this.emit('loading', { percent, message });
                
                // If loading reaches 100% and we're authenticated, consider it ready
                if (percent >= 100 && this.isAuthenticated && !this.isReady) {
                    console.log('Loading complete and authenticated - setting ready...');
                    setTimeout(() => {
                        if (!this.isReady && this.client) {
                            this.isReady = true;
                            this.qrCode = null;
                            this.emit('ready');
                            console.log('WhatsApp client is ready (via loading_screen 100%)');
                        }
                    }, 3000); // Wait 3 more seconds for safety
                }
            });

            // QR Code event
            this.client.on('qr', (qr) => {
                console.log('QR Code received');
                this.qrCode = qr;
                this.emit('qr', qr);
            });

            // Ready event - but wait for internal models to load
            this.client.on('ready', async () => {
                console.log('WhatsApp client is ready! Waiting for internal models...');
                this.isAuthenticated = true;
                this.qrCode = null;
                
                // Wait longer for internal WhatsApp models to fully initialize
                // This is necessary because 'ready' fires before all models are available
                console.log('Waiting 15 seconds for WhatsApp to fully initialize...');
                await new Promise(resolve => setTimeout(resolve, 15000));
                
                console.log('WhatsApp client is fully ready now!');
                this.isReady = true;
                this.emit('ready');
            });

            // Authenticated event
            this.client.on('authenticated', () => {
                console.log('WhatsApp client authenticated');
                this.isAuthenticated = true;
                this.emit('authenticated');
                
                // WhatsApp Web needs significant time to load internal stores
                // Use a progressive check instead of just a fixed delay
                this.startReadinessCheck();
            });

            // Authentication failure
            this.client.on('auth_failure', (msg) => {
                console.error('Authentication failure:', msg);
                this.isAuthenticated = false;
                this.emit('auth_failure', msg);
            });

            // Disconnected
            this.client.on('disconnected', (reason) => {
                console.log('WhatsApp client disconnected:', reason);
                this.isReady = false;
                this.isAuthenticated = false;
                this.emit('disconnected', reason);
            });

            // Message received
            this.client.on('message', (message) => {
                this.emit('message', message);
            });

            // Message sent
            this.client.on('message_create', (message) => {
                if (message.fromMe) {
                    this.emit('message_sent', message);
                }
            });

            // Initialize the client with error handling
            await this.client.initialize();
            this.initRetryCount = 0; // Reset retry count on success
            console.log('WhatsApp client initialization completed');
        } catch (error) {
            console.error('Error during initialization:', error.message);
            this.isInitializing = false;
            
            // Check if it's an execution context error (navigation during init)
            if (error.message && (error.message.includes('Execution context') || 
                error.message.includes('Protocol error') ||
                error.message.includes('Target closed'))) {
                
                // Retry logic
                if (this.initRetryCount < this.maxRetries) {
                    this.initRetryCount++;
                    console.log(`Retrying initialization (attempt ${this.initRetryCount}/${this.maxRetries})...`);
                    
                    // Wait before retry
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    return this.initialize();
                } else {
                    console.error('Max retries reached. Please restart the application.');
                    this.emit('init_failure', error.message);
                }
            } else {
                // Other errors - emit failure
                this.emit('init_failure', error.message || 'Unknown error');
            }
        } finally {
            this.isInitializing = false;
        }
    }

    // Progressive readiness check - verifies stores are actually ready
    async startReadinessCheck() {
        console.log('Starting progressive readiness check...');
        
        // Wait initial 15 seconds for basic initialization
        await new Promise(resolve => setTimeout(resolve, 15000));
        
        // Try to verify stores are ready by attempting a test getChats call
        let attempts = 0;
        const maxAttempts = 10;
        const checkInterval = 5000; // 5 seconds between checks
        
        const verifyStores = async () => {
            if (this.isReady) return; // Already ready via 'ready' event
            if (!this.client || !this.isAuthenticated) return;
            
            attempts++;
            console.log(`Readiness check attempt ${attempts}/${maxAttempts}...`);
            
            try {
                // Try to get chats - if it fails with 'update' error, stores aren't ready
                const testChats = await this.client.getChats();
                if (testChats && Array.isArray(testChats)) {
                    console.log(`Stores verified ready! Found ${testChats.length} chats.`);
                    this.isReady = true;
                    this.qrCode = null;
                    this.emit('ready');
                    return;
                }
            } catch (error) {
                console.log(`Readiness check failed: ${error.message}`);
                
                // If it's the 'update' error, stores aren't ready yet
                if (error.message && error.message.includes("reading 'update'")) {
                    if (attempts < maxAttempts) {
                        console.log(`Stores not ready yet. Next check in ${checkInterval / 1000}s...`);
                        setTimeout(verifyStores, checkInterval);
                    } else {
                        console.log('Max readiness check attempts reached. Setting ready anyway for retry logic.');
                        this.isReady = true;
                        this.qrCode = null;
                        this.emit('ready');
                    }
                    return;
                }
            }
            
            // For other cases, try again if attempts remaining
            if (attempts < maxAttempts) {
                setTimeout(verifyStores, checkInterval);
            } else {
                console.log('Readiness check complete, setting ready state.');
                this.isReady = true;
                this.qrCode = null;
                this.emit('ready');
            }
        };
        
        verifyStores();
    }

    async waitForReady(timeout = 10000) {
        if (this.isReady && this.client) return true;
        
        return new Promise((resolve) => {
            const startTime = Date.now();
            const checkReady = () => {
                if (this.isReady && this.client) {
                    resolve(true);
                } else if (Date.now() - startTime > timeout) {
                    resolve(false);
                } else {
                    setTimeout(checkReady, 500);
                }
            };
            checkReady();
        });
    }

    async getChats(retryCount = 0) {
        const MAX_RETRIES = 5;
        const BASE_DELAY = 1000; // 1 second base delay
        
        // Debug logging
        console.log(`getChats called: isReady=${this.isReady}, clientExists=${!!this.client}, hasGetChats=${!!this.client?.getChats}, retry=${retryCount}`);
        
        // Check both isReady and that client exists with getChats method
        if (!this.isReady || !this.client) {
            console.log('Client not ready yet');
            return [];
        }
        
        // Use optional chaining to safely call getChats
        try {
            if (typeof this.client?.getChats !== 'function') {
                console.log('getChats method not available yet');
                return [];
            }
            
            const chats = await this.client.getChats();
            if (chats && chats.length > 0) {
                console.log(`Fetched ${chats.length} chats successfully!`);
            } else {
                console.log('getChats returned empty array - WhatsApp may still be syncing');
            }
            return chats || [];
        } catch (error) {
            // Log the actual error for debugging
            console.log(`getChats error: ${error.message}`);
            
            // Check if it's the "update" property error - meaning stores aren't ready
            if (error.message && error.message.includes("reading 'update'") && retryCount < MAX_RETRIES) {
                // Exponential backoff: 1s, 2s, 4s, 8s, 16s
                const delay = BASE_DELAY * Math.pow(2, retryCount);
                console.log(`WhatsApp stores not ready yet. Retrying in ${delay / 1000}s... (attempt ${retryCount + 1}/${MAX_RETRIES})`);
                
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.getChats(retryCount + 1);
            }
            
            // For other errors or max retries reached, return empty array
            if (retryCount >= MAX_RETRIES) {
                console.log('Max retries reached for getChats. WhatsApp may need more time to sync.');
                // Mark as not ready so future calls trigger the sync check
                this.isReady = false;
                // Re-check after 30 seconds
                setTimeout(() => {
                    if (this.client && this.isAuthenticated) {
                        console.log('Re-enabling ready state after extended wait...');
                        this.isReady = true;
                    }
                }, 30000);
            }
            
            return [];
        }
    }

    async getChatById(chatId) {
        if (!this.isReady || !this.client) return null;
        try {
            return await this.client.getChatById(chatId);
        } catch (error) {
            console.log('Error getting chat by ID:', error.message);
            return null;
        }
    }

    async getMessages(chatId, limit = 50) {
        if (!this.isReady || !this.client) return [];
        try {
            const chat = await this.client.getChatById(chatId);
            if (!chat) return [];
            return await chat.fetchMessages({ limit });
        } catch (error) {
            console.log('Error fetching messages:', error.message);
            return [];
        }
    }

    async sendMessage(chatId, message) {
        if (!this.isReady || !this.client) throw new Error('Client not ready');
        try {
            const chat = await this.client.getChatById(chatId);
            if (!chat) throw new Error('Chat not found');
            return await chat.sendMessage(message);
        } catch (error) {
            console.error('Error sending message:', error.message);
            throw error;
        }
    }

    async getContactInfo(contactId) {
        if (!this.isReady || !this.client) return null;
        try {
            return await this.client.getContactById(contactId);
        } catch (error) {
            console.log('Error getting contact info:', error.message);
            return null;
        }
    }

    getStatus() {
        return {
            isReady: this.isReady,
            isAuthenticated: this.isAuthenticated,
            hasQR: !!this.qrCode
        };
    }

    getQRCode() {
        return this.qrCode;
    }

    async logout() {
        if (this.client) {
            await this.client.logout();
        }
    }

    async destroy() {
        if (this.client) {
            await this.client.destroy();
        }
    }
}

module.exports = new WhatsAppClient();
