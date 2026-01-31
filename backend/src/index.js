const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const apiRoutes = require('./routes/api');
const whatsappClient = require('./whatsapp/accountManager'); // Multi-account support

const app = express();
const server = http.createServer(app);

// CORS configuration
const corsOptions = {
    origin: ['http://localhost:4200', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Socket.IO setup
const io = new Server(server, {
    cors: corsOptions
});

// API Routes
app.use('/api', apiRoutes);

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    // Send current status to newly connected client
    socket.emit('status', whatsappClient.getStatus());
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// WhatsApp client event handlers (now from accountManager)
whatsappClient.on('qr', async ({ accountId, qr }) => {
    const QRCode = require('qrcode');
    try {
        const qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
        io.emit('qr', { qrCode: qrDataUrl, qrRaw: qr, accountId });
    } catch (error) {
        console.error('Error generating QR code:', error);
    }
});

whatsappClient.on('loading', (data) => {
    io.emit('loading', data);
});

whatsappClient.on('ready', ({ accountId }) => {
    io.emit('ready', { message: 'WhatsApp client is ready', accountId });
    io.emit('status', whatsappClient.getStatus());
});

whatsappClient.on('authenticated', ({ accountId }) => {
    io.emit('authenticated', { message: 'Authentication successful', accountId });
    io.emit('status', whatsappClient.getStatus());
});

whatsappClient.on('auth_failure', ({ accountId, message }) => {
    io.emit('auth_failure', { message, accountId });
    io.emit('status', whatsappClient.getStatus());
});

whatsappClient.on('disconnected', ({ accountId, reason }) => {
    io.emit('disconnected', { reason, accountId });
    io.emit('status', whatsappClient.getStatus());
});

whatsappClient.on('message', ({ accountId, message }) => {
    io.emit('message', {
        id: message.id._serialized,
        body: message.body,
        from: message.from,
        timestamp: message.timestamp,
        fromMe: message.fromMe,
        type: message.type,
        accountId
    });
});

whatsappClient.on('message_sent', ({ accountId, message }) => {
    io.emit('message_sent', {
        id: message.id._serialized,
        body: message.body,
        to: message.to || message.id.remote,
        timestamp: message.timestamp,
        type: message.type,
        accountId
    });
});

// Handle initialization failures
whatsappClient.on('init_failure', (error) => {
    console.error('WhatsApp client initialization failed:', error);
    io.emit('init_failure', { message: error });
});

// Handle account switched event
whatsappClient.on('account_switched', ({ accountId }) => {
    console.log('Account switched to:', accountId);
    io.emit('account_switched', { accountId });
    io.emit('status', whatsappClient.getStatus());
});

// Handle account created event
whatsappClient.on('account_created', ({ id, name }) => {
    console.log('Account created:', id, name);
    io.emit('account_created', { id, name });
});

// Initialize WhatsApp client
console.log('Initializing WhatsApp client...');
whatsappClient.initialize().catch(err => {
    console.error('Unhandled initialization error:', err.message);
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`API available at http://localhost:${PORT}/api`);
    console.log(`Socket.IO available at http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    await whatsappClient.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Shutting down gracefully...');
    await whatsappClient.destroy();
    process.exit(0);
});

// Handle unhandled promise rejections (prevents crashes from Puppeteer errors)
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit - try to keep the server running
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error.message);
    // Check if it's a recoverable Puppeteer error
    if (error.message.includes('Execution context') || 
        error.message.includes('Protocol error') ||
        error.message.includes('Target closed')) {
        console.log('Puppeteer error detected, attempting to recover...');
        // The WhatsApp client will handle retry internally
    } else {
        // For other fatal errors, exit
        process.exit(1);
    }
});
