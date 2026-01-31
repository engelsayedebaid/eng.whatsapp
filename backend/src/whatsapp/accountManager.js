const { Client, LocalAuth } = require('whatsapp-web.js');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

/**
 * Account Manager - Manages multiple WhatsApp accounts
 */
class AccountManager extends EventEmitter {
    constructor() {
        super();
        this.accounts = new Map(); // accountId -> WhatsAppAccount
        this.activeAccountId = null;
        this.maxAccounts = 10;
        this.configPath = path.join(__dirname, '../../data/accounts.json');
        this.deletedMessagesPath = path.join(__dirname, '../../data/deleted_messages.json');
        
        // Store for deleted messages
        this.deletedMessages = new Map();
        
        // Ensure data directory exists
        const dataDir = path.dirname(this.configPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        // Load saved accounts config and deleted messages
        this.loadAccountsConfig();
        this.loadDeletedMessages();
    }

    // Load deleted messages from file
    loadDeletedMessages() {
        try {
            if (fs.existsSync(this.deletedMessagesPath)) {
                const data = JSON.parse(fs.readFileSync(this.deletedMessagesPath, 'utf8'));
                this.deletedMessages = new Map(Object.entries(data));
                console.log(`Loaded ${this.deletedMessages.size} deleted messages from storage`);
            }
        } catch (err) {
            console.log('Could not load deleted messages:', err.message);
        }
    }

    // Save deleted messages to file
    saveDeletedMessages() {
        try {
            const data = Object.fromEntries(this.deletedMessages);
            fs.writeFileSync(this.deletedMessagesPath, JSON.stringify(data, null, 2));
        } catch (err) {
            console.log('Could not save deleted messages:', err.message);
        }
    }

    // Save a deleted message
    saveDeletedMessage(messageData) {
        this.deletedMessages.set(messageData.id, messageData);
        this.saveDeletedMessages();
    }

    // Get all deleted messages for a chat
    getDeletedMessagesForChat(chatId) {
        const result = [];
        for (const [id, msg] of this.deletedMessages) {
            if (msg.chatId === chatId) {
                result.push(msg);
            }
        }
        return result;
    }

    loadAccountsConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                const data = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                this.activeAccountId = data.activeAccountId || null;
                
                // Create account entries (but don't initialize clients yet)
                if (data.accounts && Array.isArray(data.accounts)) {
                    data.accounts.forEach(acc => {
                        // Check if session exists for this account
                        const sessionPath = path.join(__dirname, `../../.wwebjs_auth/session-${acc.id}`);
                        const hasSession = fs.existsSync(sessionPath);
                        
                        console.log(`Loading account ${acc.id} (${acc.name}), session exists: ${hasSession}`);
                        
                        this.accounts.set(acc.id, {
                            id: acc.id,
                            name: acc.name,
                            phone: acc.phone || null,
                            createdAt: acc.createdAt,
                            client: null,
                            isReady: false,
                            isAuthenticated: false, // Will be set when client initializes
                            isInitializing: false,
                            qrCode: null,
                            hasStoredSession: hasSession // Track if session file exists
                        });
                    });
                }
                console.log(`Loaded ${this.accounts.size} accounts from config`);
            }
        } catch (error) {
            console.error('Error loading accounts config:', error);
        }
    }

    saveAccountsConfig() {
        try {
            const data = {
                activeAccountId: this.activeAccountId,
                accounts: Array.from(this.accounts.values()).map(acc => ({
                    id: acc.id,
                    name: acc.name,
                    phone: acc.phone,
                    createdAt: acc.createdAt
                }))
            };
            fs.writeFileSync(this.configPath, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Error saving accounts config:', error);
        }
    }

    generateAccountId() {
        return 'acc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Create a new account
     */
    async createAccount(name) {
        if (this.accounts.size >= this.maxAccounts) {
            throw new Error(`Maximum ${this.maxAccounts} accounts allowed`);
        }

        const id = this.generateAccountId();
        const account = {
            id,
            name: name || `Account ${this.accounts.size + 1}`,
            phone: null,
            createdAt: Date.now(),
            client: null,
            isReady: false,
            isAuthenticated: false,
            isInitializing: false,
            qrCode: null
        };

        this.accounts.set(id, account);
        
        // If this is the first account, set it as active
        if (this.accounts.size === 1) {
            this.activeAccountId = id;
        }
        
        this.saveAccountsConfig();
        this.emit('account_created', { id, name: account.name });
        
        return account;
    }

    /**
     * Delete an account
     */
    async deleteAccount(accountId) {
        const account = this.accounts.get(accountId);
        if (!account) {
            throw new Error('Account not found');
        }

        // Destroy client if exists
        if (account.client) {
            try {
                await account.client.logout();
                await account.client.destroy();
            } catch (err) {
                console.log('Error destroying client:', err.message);
            }
        }

        // Delete auth data
        const authPath = path.join(__dirname, `../../.wwebjs_auth/session-${accountId}`);
        if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
        }

        this.accounts.delete(accountId);

        // If deleted account was active, switch to first available
        if (this.activeAccountId === accountId) {
            const firstAccount = this.accounts.keys().next().value;
            this.activeAccountId = firstAccount || null;
        }

        this.saveAccountsConfig();
        this.emit('account_deleted', { id: accountId });
    }

    /**
     * Rename an account
     */
    renameAccount(accountId, newName) {
        const account = this.accounts.get(accountId);
        if (!account) {
            throw new Error('Account not found');
        }

        account.name = newName;
        this.saveAccountsConfig();
        this.emit('account_renamed', { id: accountId, name: newName });
    }

    /**
     * Initialize a specific account's WhatsApp client
     */
    async initializeAccount(accountId) {
        const account = this.accounts.get(accountId);
        if (!account) {
            throw new Error('Account not found');
        }

        if (account.isInitializing) {
            console.log(`Account ${accountId} is already initializing`);
            return;
        }

        account.isInitializing = true;

        // Destroy existing client if any
        if (account.client) {
            try {
                await account.client.destroy();
            } catch (err) {
                console.log('Error destroying existing client:', err.message);
            }
        }

        try {
            const authPath = path.join(__dirname, '../../.wwebjs_auth');
            console.log(`[${accountId}] Using auth path: ${authPath}`);
            
            const client = new Client({
                authStrategy: new LocalAuth({
                    clientId: accountId,
                    dataPath: authPath
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
                    ],
                    // Increase timeout for slow connections
                    timeout: 60000
                },
                // Restore session from stored data
                restartOnAuthFail: true
            });

            account.client = client;

            // Session saved event - confirms session was persisted
            client.on('remote_session_saved', () => {
                console.log(`[${accountId}] ✅ Remote session saved successfully`);
            });

            // QR Code event
            client.on('qr', (qr) => {
                console.log(`[${accountId}] QR Code received`);
                account.qrCode = qr;
                this.emit('qr', { accountId, qr });
            });

            // Loading screen
            client.on('loading_screen', (percent, message) => {
                console.log(`[${accountId}] Loading: ${percent}% - ${message}`);
                this.emit('loading', { accountId, percent, message });
                
                // Fallback: If loading reaches 99% or more and authenticated, start checking store availability
                if (percent >= 99 && account.isAuthenticated && !account.isReady) {
                    console.log(`[${accountId}] Loading at ${percent}%, will check store availability...`);
                    
                    // Use the safer checkAndSetReady function with delay
                    setTimeout(() => {
                        if (!account.isReady) {
                            this.checkAndSetReady(accountId, 0);
                        }
                    }, 15000); // Wait 15 seconds before checking
                }
            });

            // Ready event
            client.on('ready', async () => {
                console.log(`[${accountId}] WhatsApp client is ready!`);
                account.isAuthenticated = true;
                account.qrCode = null;
                
                // Get phone number
                try {
                    const info = client.info;
                    if (info && info.wid) {
                        account.phone = info.wid.user;
                        this.saveAccountsConfig();
                    }
                } catch (err) {
                    console.log('Could not get phone info:', err.message);
                }
                
                // Wait for internal models
                await new Promise(resolve => setTimeout(resolve, 10000));
                
                account.isReady = true;
                account.isInitializing = false;
                this.emit('ready', { accountId });
            });

            // Authenticated
            client.on('authenticated', () => {
                console.log(`[${accountId}] Authenticated`);
                account.isAuthenticated = true;
                this.emit('authenticated', { accountId });
                
                // Start checking for store readiness after a delay
                setTimeout(() => this.checkAndSetReady(accountId), 20000);
            });

            // Auth failure
            client.on('auth_failure', (msg) => {
                console.error(`[${accountId}] Auth failure:`, msg);
                account.isAuthenticated = false;
                account.isInitializing = false;
                this.emit('auth_failure', { accountId, message: msg });
            });

            // Disconnected
            client.on('disconnected', (reason) => {
                console.log(`[${accountId}] Disconnected:`, reason);
                account.isReady = false;
                account.isAuthenticated = false;
                this.emit('disconnected', { accountId, reason });
            });

            // Message events
            client.on('message', (message) => {
                // Fallback: If we receive a message, the client is definitely ready
                if (!account.isReady && account.isAuthenticated) {
                    console.log(`[${accountId}] Received message, marking as ready (fallback)`);
                    account.isReady = true;
                    account.isInitializing = false;
                    
                    // Get phone number if not set
                    if (!account.phone) {
                        try {
                            const info = client.info;
                            if (info && info.wid) {
                                account.phone = info.wid.user;
                                this.saveAccountsConfig();
                            }
                        } catch (err) {
                            console.log('Could not get phone info:', err.message);
                        }
                    }
                    
                    this.emit('ready', { accountId });
                }
                this.emit('message', { accountId, message });
            });

            client.on('message_create', (message) => {
                if (message.fromMe) {
                    this.emit('message_sent', { accountId, message });
                }
            });

            // Message revoked/deleted for everyone
            client.on('message_revoke_everyone', async (message, revokedMsg) => {
                console.log(`[${accountId}] Message revoked for everyone:`, message.id._serialized);
                
                // Save the original message before it's deleted
                if (revokedMsg) {
                    const chatId = message.from || message.to;
                    const deletedMsgData = {
                        id: revokedMsg.id._serialized,
                        chatId: chatId,
                        body: revokedMsg.body || '[Media]',
                        timestamp: revokedMsg.timestamp,
                        fromMe: revokedMsg.fromMe,
                        author: revokedMsg.author || null,
                        type: 'revoked',
                        hasMedia: revokedMsg.hasMedia || false,
                        deletedAt: Date.now(),
                        originalType: revokedMsg.type,
                        accountId: accountId
                    };
                    
                    this.saveDeletedMessage(deletedMsgData);
                    console.log(`[${accountId}] Saved deleted message:`, revokedMsg.id._serialized);
                }
                
                this.emit('message_revoked', { accountId, message, revokedMsg });
            });

            await client.initialize();
            console.log(`[${accountId}] Client initialization completed`);

        } catch (error) {
            console.error(`[${accountId}] Initialization error:`, error.message);
            account.isInitializing = false;
            throw error;
        }
    }

    /**
     * Switch active account
     */
    async switchAccount(accountId) {
        const account = this.accounts.get(accountId);
        if (!account) {
            throw new Error('Account not found');
        }

        // Save previous account state before switching
        const previousAccountId = this.activeAccountId;
        if (previousAccountId && previousAccountId !== accountId) {
            const previousAccount = this.accounts.get(previousAccountId);
            if (previousAccount) {
                console.log(`[${previousAccountId}] Saving previous account state before switch`);
                // Keep the client alive but mark that we're switching away
                this.saveAccountsConfig();
            }
        }

        this.activeAccountId = accountId;
        this.saveAccountsConfig();
        
        // Initialize if not already
        if (!account.client && !account.isInitializing) {
            console.log(`[${accountId}] Initializing account on switch`);
            await this.initializeAccount(accountId);
        } else if (account.client && !account.isReady && !account.isInitializing) {
            // Client exists but not ready, try to reinitialize
            console.log(`[${accountId}] Client exists but not ready, reinitializing...`);
            await this.initializeAccount(accountId);
        }

        this.emit('account_switched', { accountId });
        return account;
    }

    /**
     * Get active account
     */
    getActiveAccount() {
        if (!this.activeAccountId) {
            return null;
        }
        return this.accounts.get(this.activeAccountId) || null;
    }

    /**
     * Get active client
     */
    getActiveClient() {
        const account = this.getActiveAccount();
        return account ? account.client : null;
    }

    /**
     * Get client property for backward compatibility
     */
    get client() {
        return this.getActiveClient();
    }

    /**
     * Get all accounts (without client objects)
     */
    getAllAccounts() {
        // Check and fix ready state for each account before returning
        for (const acc of this.accounts.values()) {
            if (acc.client && acc.isAuthenticated && !acc.isReady) {
                try {
                    const info = acc.client.info;
                    if (info && info.wid) {
                        console.log(`[${acc.id}] Fixing ready state in getAllAccounts`);
                        acc.isReady = true;
                        acc.isInitializing = false;
                        if (!acc.phone) {
                            acc.phone = info.wid.user;
                            this.saveAccountsConfig();
                        }
                    }
                } catch (err) {
                    // Client not ready yet
                }
            }
        }
        
        return Array.from(this.accounts.values()).map(acc => ({
            id: acc.id,
            name: acc.name,
            phone: acc.phone,
            createdAt: acc.createdAt,
            isReady: acc.isReady,
            isAuthenticated: acc.isAuthenticated,
            isInitializing: acc.isInitializing,
            hasQR: !!acc.qrCode,
            isActive: acc.id === this.activeAccountId
        }));
    }

    /**
     * Get account status
     */
    getAccountStatus(accountId) {
        const account = this.accounts.get(accountId);
        if (!account) {
            return null;
        }

        // Check if client is actually ready but isReady flag is wrong
        if (account.client && account.isAuthenticated && !account.isReady) {
            // Try to check if client is actually working
            try {
                const info = account.client.info;
                if (info && info.wid) {
                    console.log(`[${accountId}] Fixing ready state - client is working`);
                    account.isReady = true;
                    account.isInitializing = false;
                    if (!account.phone) {
                        account.phone = info.wid.user;
                        this.saveAccountsConfig();
                    }
                }
            } catch (err) {
                // Client not ready yet
            }
        }

        return {
            id: account.id,
            name: account.name,
            phone: account.phone,
            isReady: account.isReady,
            isAuthenticated: account.isAuthenticated,
            isInitializing: account.isInitializing,
            hasQR: !!account.qrCode,
            isActive: account.id === this.activeAccountId
        };
    }

    /**
     * Get QR Code for account
     */
    getQRCode(accountId) {
        const account = this.accounts.get(accountId);
        return account ? account.qrCode : null;
    }

    /**
     * Logout from account
     */
    async logoutAccount(accountId) {
        const account = this.accounts.get(accountId);
        if (!account || !account.client) {
            throw new Error('Account not found or not initialized');
        }

        await account.client.logout();
        account.isReady = false;
        account.isAuthenticated = false;
        account.phone = null;
        this.saveAccountsConfig();
    }

    /**
     * Check and set ready state for an account
     */
    async checkAndSetReady(accountId, retryCount = 0) {
        const maxRetries = 60; // Max 5 minutes (60 * 5 seconds)
        const account = this.accounts.get(accountId);
        
        if (!account || account.isReady) return;
        
        if (!account.client) {
            console.log(`[${accountId}] No client available for ready check (${retryCount}/${maxRetries})`);
            if (retryCount < maxRetries) {
                setTimeout(() => this.checkAndSetReady(accountId, retryCount + 1), 5000);
            }
            return;
        }

        // Check if pupPage is available
        if (!account.client.pupPage) {
            console.log(`[${accountId}] Browser page not initialized (${retryCount}/${maxRetries})`);
            if (retryCount < maxRetries) {
                setTimeout(() => this.checkAndSetReady(accountId, retryCount + 1), 5000);
            }
            return;
        }
        
        try {
            if (account.client.pupPage.isClosed()) {
                console.log(`[${accountId}] Browser page is closed (${retryCount}/${maxRetries})`);
                if (retryCount < maxRetries) {
                    setTimeout(() => this.checkAndSetReady(accountId, retryCount + 1), 5000);
                }
                return;
            }
        } catch (pageErr) {
            console.log(`[${accountId}] Error checking page state (${retryCount}/${maxRetries}):`, pageErr.message);
            if (retryCount < maxRetries) {
                setTimeout(() => this.checkAndSetReady(accountId, retryCount + 1), 5000);
            }
            return;
        }
        
        // Check if getChats function exists
        if (typeof account.client.getChats !== 'function') {
            console.log(`[${accountId}] getChats not available yet (${retryCount}/${maxRetries})`);
            if (retryCount < maxRetries) {
                setTimeout(() => this.checkAndSetReady(accountId, retryCount + 1), 5000);
            }
            return;
        }

        try {
            const testChats = await account.client.getChats();
            if (testChats && Array.isArray(testChats)) {
                const info = account.client.info;
                if (info && info.wid) {
                    account.phone = info.wid.user;
                    this.saveAccountsConfig();
                }
                account.isReady = true;
                account.isInitializing = false;
                console.log(`[${accountId}] Client marked as ready (retry check)`);
                this.emit('ready', { accountId });
            } else {
                console.log(`[${accountId}] Store still not ready, will retry... (${retryCount}/${maxRetries})`);
                if (retryCount < maxRetries) {
                    setTimeout(() => this.checkAndSetReady(accountId, retryCount + 1), 5000);
                }
            }
        } catch (err) {
            console.log(`[${accountId}] Store check failed (${retryCount}/${maxRetries}):`, err.message);
            if (retryCount < maxRetries) {
                setTimeout(() => this.checkAndSetReady(accountId, retryCount + 1), 5000);
            }
        }
    }

    // Proxy methods for backward compatibility with existing API
    // Cache for getChats results to reduce redundant calls
    _chatsCache = null;
    _chatsCacheTime = 0;
    _chatsCacheDuration = 3000; // 3 seconds cache

    async getChats() {
        const account = this.getActiveAccount();
        if (!account) {
            console.log('getChats: No active account');
            return [];
        }
        
        const client = account.client;
        if (!client) {
            console.log('getChats: No active client');
            return [];
        }
        
        // Check if the client's internal store is ready
        if (!account.isReady && !account.isAuthenticated) {
            console.log('getChats: Account not authenticated yet');
            return [];
        }
        
        // Return cached result if still valid
        const now = Date.now();
        if (this._chatsCache && (now - this._chatsCacheTime) < this._chatsCacheDuration) {
            return this._chatsCache;
        }
        
        try {
            // Check if pupPage exists and is not closed
            if (!client.pupPage) {
                console.log('getChats: Browser page not initialized');
                return this._chatsCache || [];
            }
            
            try {
                if (client.pupPage.isClosed()) {
                    console.log('getChats: Browser page is closed');
                    return this._chatsCache || [];
                }
            } catch (pageErr) {
                console.log('getChats: Error checking page state:', pageErr.message);
                return this._chatsCache || [];
            }
            
            // Check if getChats function exists on the client
            if (typeof client.getChats !== 'function') {
                console.log('getChats: getChats function not available on client');
                return this._chatsCache || [];
            }
            
            // Additional check: verify internal store is ready
            try {
                const info = client.info;
                if (!info || !info.wid) {
                    console.log('getChats: Client info not available yet');
                    return this._chatsCache || [];
                }
            } catch (infoErr) {
                console.log('getChats: Error getting client info:', infoErr.message);
                return this._chatsCache || [];
            }
            
            const chats = await client.getChats();
            
            // Update cache
            this._chatsCache = chats;
            this._chatsCacheTime = now;
            
            // Mark as ready if we successfully got chats
            if (chats && Array.isArray(chats) && !account.isReady) {
                console.log(`[${account.id}] Got chats successfully, marking as ready`);
                account.isReady = true;
                account.isInitializing = false;
                this.emit('ready', { accountId: account.id });
            }
            
            return chats;
        } catch (err) {
            console.log('getChats error:', err.message);
            // Return cached array if store not ready yet
            return this._chatsCache || [];
        }
    }

    async getChatById(chatId) {
        const client = this.getActiveClient();
        if (!client) throw new Error('No active client');
        return client.getChatById(chatId);
    }

    async sendMessage(chatId, content, options) {
        const client = this.getActiveClient();
        if (!client) throw new Error('No active client');
        return client.sendMessage(chatId, content, options);
    }

    async getContactById(contactId) {
        const client = this.getActiveClient();
        if (!client) throw new Error('No active client');
        return client.getContactById(contactId);
    }

    async getMessages(chatId, limitOrOptions) {
        const client = this.getActiveClient();
        if (!client) throw new Error('No active client');
        const chat = await client.getChatById(chatId);
        // Support both number (limit) and options object
        const options = typeof limitOrOptions === 'number' 
            ? { limit: limitOrOptions } 
            : limitOrOptions;
        return chat.fetchMessages(options);
    }

    async getContactInfo(contactId) {
        const client = this.getActiveClient();
        if (!client) throw new Error('No active client');
        try {
            const contact = await client.getContactById(contactId);
            const chat = await contact.getChat();
            return {
                contact,
                lastSeen: contact.lastSeen,
                isOnline: contact.isOnline || false,
                chat
            };
        } catch (err) {
            console.log('Error getting contact info:', err.message);
            return null;
        }
    }

    getStatus() {
        const account = this.getActiveAccount();
        if (!account) {
            return {
                isReady: false,
                isAuthenticated: false,
                hasQR: false,
                activeAccountId: null
            };
        }

        return {
            isReady: account.isReady,
            isAuthenticated: account.isAuthenticated,
            hasQR: !!account.qrCode,
            activeAccountId: this.activeAccountId,
            accountName: account.name,
            phone: account.phone
        };
    }

    getQRCode() {
        const account = this.getActiveAccount();
        return account ? account.qrCode : null;
    }

    async logout() {
        if (this.activeAccountId) {
            await this.logoutAccount(this.activeAccountId);
        }
    }

    async initialize() {
        console.log('AccountManager initializing...');
        
        // First, initialize all accounts that have stored sessions
        const accountsWithSessions = Array.from(this.accounts.values())
            .filter(acc => acc.hasStoredSession);
        
        console.log(`Found ${accountsWithSessions.length} accounts with stored sessions`);
        
        // Initialize active account FIRST (priority)
        if (this.activeAccountId && this.accounts.has(this.activeAccountId)) {
            console.log(`Initializing active account: ${this.activeAccountId}`);
            try {
                await this.initializeAccount(this.activeAccountId);
                // Wait for session to stabilize before initializing other accounts
                await new Promise(resolve => setTimeout(resolve, 5000));
            } catch (err) {
                console.log(`[${this.activeAccountId}] Init error:`, err.message);
            }
        } else if (this.accounts.size === 0) {
            // Create default account if none exists
            console.log('No accounts found, creating default account');
            const defaultAccount = await this.createAccount('Main Account');
            await this.initializeAccount(defaultAccount.id);
        } else {
            // Initialize first account
            const firstId = this.accounts.keys().next().value;
            this.activeAccountId = firstId;
            this.saveAccountsConfig();
            console.log(`Initializing first account: ${firstId}`);
            await this.initializeAccount(firstId);
        }
        
        // Initialize other accounts with sessions SEQUENTIALLY (not in parallel)
        // This prevents conflicts with LocalAuth and Puppeteer
        for (const acc of accountsWithSessions) {
            if (acc.id !== this.activeAccountId) {
                console.log(`[${acc.id}] Initializing account with stored session (sequential)`);
                try {
                    await this.initializeAccount(acc.id);
                    // Wait between account initializations to prevent conflicts
                    await new Promise(resolve => setTimeout(resolve, 3000));
                } catch (err) {
                    console.log(`[${acc.id}] Background init error:`, err.message);
                }
            }
        }
        
        console.log('AccountManager initialization complete');
    }

    async destroy() {
        // Destroy all active clients
        for (const [accountId, account] of this.accounts) {
            if (account.client) {
                try {
                    await account.client.destroy();
                    console.log(`[${accountId}] Client destroyed`);
                } catch (err) {
                    console.log(`[${accountId}] Error destroying client:`, err.message);
                }
            }
        }
    }
}

module.exports = new AccountManager();
