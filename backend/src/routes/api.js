const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const whatsappClient = require('../whatsapp/accountManager'); // Use accountManager for multi-account support
const { formatChat, formatMessage, hasBeenReplied, applyFilters } = require('../utils/helpers');

// Get QR Code
router.get('/qr', async (req, res) => {
    try {
        const qr = whatsappClient.getQRCode();
        if (!qr) {
            return res.json({ 
                success: false, 
                message: 'No QR code available. Client may already be authenticated.' 
            });
        }
        
        // Generate QR code as data URL
        const qrDataUrl = await QRCode.toDataURL(qr, {
            width: 300,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#ffffff'
            }
        });
        
        res.json({ success: true, qrCode: qrDataUrl, qrRaw: qr });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get connection status
router.get('/status', async (req, res) => {
    const status = whatsappClient.getStatus();
    // Check if we can get chats (indicates syncing complete)
    let isSyncing = false;
    if (status.isAuthenticated && !status.hasQR) {
        // Client is authenticated but might still be syncing
        isSyncing = !status.isReady;
    }
    res.json({ success: true, ...status, isSyncing });
});

// Get all chats with filters
router.get('/chats', async (req, res) => {
    try {
        const status = whatsappClient.getStatus();
        // Return empty array if not ready yet (instead of error)
        if (!status.isReady && !status.isAuthenticated) {
            return res.json({ 
                success: true, 
                count: 0,
                chats: [],
                message: 'WhatsApp client initializing...' 
            });
        }

        const filters = {
            chatType: req.query.chatType || 'all',
            readStatus: req.query.readStatus || 'all',
            dateRange: req.query.dateRange || 'all',
            searchQuery: req.query.search || '',
            replyStatus: req.query.replyStatus || 'all',
            contactType: req.query.contactType || 'all' // 'all', 'new', 'existing'
        };

        let chats = await whatsappClient.getChats();
        
        // Apply basic filters
        chats = await applyFilters(chats, filters, whatsappClient);
        
        // Get today's date for comparison
        const today = new Date();
        const todayStr = today.toDateString();
        
        // Format chats and add reply status
        const formattedChats = await Promise.all(chats.map(async (chat) => {
            // Get more messages to check if all are from today
            const messages = await chat.fetchMessages({ limit: 100 });
            const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
            const messageCount = messages.length;
            
            // Sort messages by timestamp (oldest first) to correctly identify the first message
            const sortedMessages = [...messages].sort((a, b) => a.timestamp - b.timestamp);
            
            // Get the first (oldest) message timestamp
            const firstMessage = sortedMessages.length > 0 ? sortedMessages[0] : null;
            const firstMessageTimestamp = firstMessage ? firstMessage.timestamp : null;
            
            // Check if ALL messages are from today (no messages before today)
            // This is a NEW contact only if the oldest message is from today
            let allMessagesToday = false;
            if (sortedMessages.length > 0 && firstMessageTimestamp) {
                const oldestMsgDate = new Date(firstMessageTimestamp * 1000);
                // New contact if the oldest message is from today
                allMessagesToday = oldestMsgDate.toDateString() === todayStr;
            }
            
            const formatted = formatChat(chat, lastMessage, messageCount, firstMessageTimestamp, allMessagesToday);
            formatted.hasBeenReplied = hasBeenReplied(sortedMessages);
            return formatted;
        }));
        
        // Filter by reply status
        let result = formattedChats;
        if (filters.replyStatus === 'replied') {
            result = formattedChats.filter(c => c.hasBeenReplied);
        } else if (filters.replyStatus === 'not-replied') {
            result = formattedChats.filter(c => !c.hasBeenReplied);
        }
        
        // Filter by contact type (new/existing)
        if (filters.contactType === 'new') {
            result = result.filter(c => c.isFirstContact);
        } else if (filters.contactType === 'existing') {
            result = result.filter(c => !c.isFirstContact);
        }
        
        // Sort by timestamp (newest first)
        result.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        res.json({ 
            success: true, 
            count: result.length,
            chats: result 
        });
    } catch (error) {
        console.error('Error fetching chats:', error);
        // Return empty array instead of error to avoid breaking the UI
        res.json({ 
            success: true, 
            count: 0,
            chats: [],
            message: 'WhatsApp still syncing, please wait...' 
        });
    }
});

// Search across all chats and messages
router.get('/search', async (req, res) => {
    try {
        const status = whatsappClient.getStatus();
        if (!status.isReady && !status.isAuthenticated) {
            return res.json({ 
                success: true, 
                results: [],
                message: 'WhatsApp client initializing...' 
            });
        }

        const query = (req.query.q || '').toLowerCase().trim();
        if (!query || query.length < 2) {
            return res.json({ 
                success: true, 
                results: [],
                message: 'Query must be at least 2 characters' 
            });
        }

        const chats = await whatsappClient.getChats();
        const results = [];
        const maxChatsToSearch = 50; // Limit for performance
        const maxMessagesPerChat = 100;

        // Search in chat names first
        const matchingChats = chats.filter(chat => {
            const name = (chat.name || '').toLowerCase();
            const number = chat.id.user || '';
            return name.includes(query) || number.includes(query);
        }).slice(0, 10);

        for (const chat of matchingChats) {
            results.push({
                type: 'chat',
                chatId: chat.id._serialized,
                chatName: chat.name || chat.id.user,
                isGroup: chat.isGroup,
                matchText: chat.name || chat.id.user,
                timestamp: chat.timestamp
            });
        }

        // Search in messages (limited for performance)
        const chatsToSearch = chats.slice(0, maxChatsToSearch);
        
        for (const chat of chatsToSearch) {
            try {
                const messages = await chat.fetchMessages({ limit: maxMessagesPerChat });
                
                for (const msg of messages) {
                    if (msg.body && msg.body.toLowerCase().includes(query)) {
                        results.push({
                            type: 'message',
                            chatId: chat.id._serialized,
                            chatName: chat.name || chat.id.user,
                            isGroup: chat.isGroup,
                            messageId: msg.id._serialized,
                            matchText: msg.body,
                            fromMe: msg.fromMe,
                            timestamp: msg.timestamp
                        });
                    }
                }
            } catch (e) {
                console.log(`Could not search messages in chat ${chat.id._serialized}:`, e.message);
            }
        }

        // Sort by timestamp (newest first)
        results.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        // Limit total results
        const limitedResults = results.slice(0, 50);

        res.json({ 
            success: true, 
            query: query,
            count: limitedResults.length,
            results: limitedResults 
        });
    } catch (error) {
        console.error('Error searching:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// Get messages for a specific chat
router.get('/chats/:id/messages', async (req, res) => {
    try {
        const status = whatsappClient.getStatus();
        if (!status.isReady && !status.isAuthenticated) {
            return res.json({ 
                success: true, 
                count: 0,
                messages: [],
                message: 'WhatsApp client initializing...' 
            });
        }

        const chatId = req.params.id;
        const limit = parseInt(req.query.limit) || 50;
        
        const messages = await whatsappClient.getMessages(chatId, limit);
        
        // Check if this is a group chat
        const chat = await whatsappClient.getChatById(chatId);
        const isGroup = chat ? chat.isGroup : false;
        
        let formattedMessages;
        if (isGroup && whatsappClient.client) {
            // For groups, get author info for each message
            const { formatMessageWithAuthor } = require('../utils/helpers');
            formattedMessages = await Promise.all(
                messages.map(msg => formatMessageWithAuthor(msg, whatsappClient.client))
            );
        } else {
            formattedMessages = messages.map(formatMessage);
        }

        // Add deleted messages that were saved
        const deletedMessages = whatsappClient.getDeletedMessagesForChat(chatId);
        if (deletedMessages && deletedMessages.length > 0) {
            // Format deleted messages
            const formattedDeletedMsgs = deletedMessages.map(msg => ({
                id: msg.id,
                body: msg.body,
                timestamp: msg.timestamp,
                fromMe: msg.fromMe,
                author: msg.author,
                authorInfo: null,
                type: 'revoked',
                hasMedia: false,
                mediaInfo: null,
                isForwarded: false,
                isStatus: false,
                isStarred: false,
                isDeleted: true,
                ack: 3,
                mentionedIds: [],
                quotedMsg: null,
                deletedAt: msg.deletedAt
            }));
            
            // Add to messages list (avoid duplicates)
            const existingIds = new Set(formattedMessages.map(m => m.id));
            for (const delMsg of formattedDeletedMsgs) {
                if (!existingIds.has(delMsg.id)) {
                    formattedMessages.push(delMsg);
                }
            }
        }

        // Sort messages by timestamp (oldest first) for proper chat display
        formattedMessages.sort((a, b) => a.timestamp - b.timestamp);

        res.json({ 
            success: true, 
            count: formattedMessages.length,
            messages: formattedMessages 
        });
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Download media from a message
router.get('/messages/:id/media', async (req, res) => {
    try {
        const status = whatsappClient.getStatus();
        if (!status.isReady && !status.isAuthenticated) {
            return res.status(503).json({ 
                success: false, 
                message: 'WhatsApp client not ready yet' 
            });
        }

        const messageId = req.params.id;
        
        // Find the message
        const chats = await whatsappClient.getChats();
        let targetMessage = null;
        
        for (const chat of chats) {
            try {
                const messages = await chat.fetchMessages({ limit: 100 });
                targetMessage = messages.find(m => m.id._serialized === messageId);
                if (targetMessage) break;
            } catch (e) {
                continue;
            }
        }
        
        if (!targetMessage) {
            return res.status(404).json({ success: false, message: 'Message not found' });
        }
        
        if (!targetMessage.hasMedia) {
            return res.status(400).json({ success: false, message: 'Message has no media' });
        }
        
        // Download the media
        const media = await targetMessage.downloadMedia();
        
        if (!media) {
            return res.status(404).json({ success: false, message: 'Could not download media' });
        }
        
        res.json({
            success: true,
            media: {
                mimetype: media.mimetype,
                data: media.data, // Base64 encoded
                filename: media.filename || null,
                filesize: media.filesize || null
            }
        });
    } catch (error) {
        console.error('Error downloading media:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Download media directly (returns raw file)
router.get('/messages/:id/media/download', async (req, res) => {
    try {
        const status = whatsappClient.getStatus();
        if (!status.isReady && !status.isAuthenticated) {
            return res.status(503).send('WhatsApp client not ready');
        }

        const messageId = req.params.id;
        const chatId = req.query.chatId;
        
        if (!chatId) {
            return res.status(400).send('Chat ID required');
        }
        
        // Get messages from specific chat
        const messages = await whatsappClient.getMessages(chatId, 200);
        const targetMessage = messages.find(m => m.id._serialized === messageId);
        
        if (!targetMessage) {
            return res.status(404).send('Message not found');
        }
        
        if (!targetMessage.hasMedia) {
            return res.status(400).send('Message has no media');
        }
        
        // Download the media
        const media = await targetMessage.downloadMedia();
        
        if (!media) {
            return res.status(404).send('Could not download media');
        }
        
        // Set appropriate headers
        const filename = media.filename || `media_${Date.now()}`;
        res.setHeader('Content-Type', media.mimetype);
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        
        // Send the buffer
        const buffer = Buffer.from(media.data, 'base64');
        res.send(buffer);
    } catch (error) {
        console.error('Error downloading media:', error);
        res.status(500).send('Error downloading media');
    }
});

router.post('/chats/:id/send', async (req, res) => {
    try {
        const status = whatsappClient.getStatus();
        if (!status.isReady && !status.isAuthenticated) {
            return res.status(503).json({ 
                success: false, 
                message: 'WhatsApp client not ready yet. Please wait.' 
            });
        }

        const chatId = req.params.id;
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ 
                success: false, 
                message: 'Message is required' 
            });
        }

        const sentMessage = await whatsappClient.sendMessage(chatId, message);
        
        res.json({ 
            success: true, 
            message: formatMessage(sentMessage) 
        });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get chat info
router.get('/chats/:id', async (req, res) => {
    try {
        const status = whatsappClient.getStatus();
        if (!status.isReady && !status.isAuthenticated) {
            return res.json({ 
                success: false, 
                message: 'WhatsApp client initializing...' 
            });
        }

        const chatId = req.params.id;
        const chat = await whatsappClient.getChatById(chatId);
        
        if (!chat) {
            return res.status(404).json({ 
                success: false, 
                message: 'Chat not found' 
            });
        }

        const messages = await chat.fetchMessages({ limit: 10 });
        const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
        const formatted = formatChat(chat, lastMessage);
        formatted.hasBeenReplied = hasBeenReplied(messages);

        res.json({ success: true, chat: formatted });
    } catch (error) {
        console.error('Error fetching chat:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get profile picture for a chat
router.get('/chats/:id/picture', async (req, res) => {
    try {
        const status = whatsappClient.getStatus();
        if (!status.isReady && !status.isAuthenticated) {
            return res.json({ 
                success: false, 
                profilePicUrl: null 
            });
        }

        const chatId = req.params.id;
        
        try {
            const client = whatsappClient.getActiveClient();
            if (client) {
                const profilePicUrl = await client.getProfilePicUrl(chatId);
                return res.json({ 
                    success: true, 
                    profilePicUrl: profilePicUrl || null 
                });
            }
        } catch (e) {
            // Profile pic might not be available
        }
        
        res.json({ success: true, profilePicUrl: null });
    } catch (error) {
        console.error('Error fetching profile picture:', error);
        res.json({ success: true, profilePicUrl: null });
    }
});

// Pin/Unpin a chat
router.post('/chats/:id/pin', async (req, res) => {
    try {
        const chatId = req.params.id;
        const chat = await whatsappClient.getChatById(chatId);
        
        if (!chat) {
            return res.status(404).json({ success: false, message: 'Chat not found' });
        }

        await chat.pin();
        res.json({ success: true, message: 'Chat pinned successfully' });
    } catch (error) {
        console.error('Error pinning chat:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/chats/:id/unpin', async (req, res) => {
    try {
        const chatId = req.params.id;
        const chat = await whatsappClient.getChatById(chatId);
        
        if (!chat) {
            return res.status(404).json({ success: false, message: 'Chat not found' });
        }

        await chat.unpin();
        res.json({ success: true, message: 'Chat unpinned successfully' });
    } catch (error) {
        console.error('Error unpinning chat:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Archive/Unarchive a chat
router.post('/chats/:id/archive', async (req, res) => {
    try {
        const chatId = req.params.id;
        const chat = await whatsappClient.getChatById(chatId);
        
        if (!chat) {
            return res.status(404).json({ success: false, message: 'Chat not found' });
        }

        await chat.archive();
        res.json({ success: true, message: 'Chat archived successfully' });
    } catch (error) {
        console.error('Error archiving chat:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/chats/:id/unarchive', async (req, res) => {
    try {
        const chatId = req.params.id;
        const chat = await whatsappClient.getChatById(chatId);
        
        if (!chat) {
            return res.status(404).json({ success: false, message: 'Chat not found' });
        }

        await chat.unarchive();
        res.json({ success: true, message: 'Chat unarchived successfully' });
    } catch (error) {
        console.error('Error unarchiving chat:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get contact presence (online/offline/last seen)
router.get('/contacts/:id/presence', async (req, res) => {
    try {
        const status = whatsappClient.getStatus();
        if (!status.isReady && !status.isAuthenticated) {
            return res.json({ 
                success: false, 
                message: 'WhatsApp client not ready',
                presence: null
            });
        }

        const contactId = req.params.id;
        
        let contact = null;
        try {
            contact = await whatsappClient.getContactInfo(contactId);
        } catch (e) {
            // Contact not found
        }

        // Try to get presence info
        let presence = null;
        try {
            // Get the chat to access presence
            const chat = await whatsappClient.getChatById(contactId);
            if (chat && chat.presence) {
                presence = {
                    isOnline: chat.presence === 'available' || chat.presence === 'composing',
                    status: chat.presence,
                    lastSeen: chat.lastSeen ? chat.lastSeen : null
                };
            }
        } catch (e) {
            // Could not get presence
        }

        // Build response with safe access
        const contactInfo = contact && contact.id ? {
            id: contact.id._serialized || contactId,
            name: contact.name || contact.pushname || contact.number || contactId.split('@')[0],
            number: contact.number || contactId.split('@')[0],
            isMyContact: contact.isMyContact || false,
            isWAContact: contact.isWAContact || true
        } : {
            id: contactId,
            name: contactId.split('@')[0],
            number: contactId.split('@')[0],
            isMyContact: false,
            isWAContact: true
        };

        res.json({ 
            success: true, 
            contact: contactInfo,
            presence: presence
        });
    } catch (error) {
        console.error('Error getting contact presence:', error.message);
        res.json({ success: false, error: error.message, presence: null });
    }
});


// Get analytics/statistics
router.get('/analytics', async (req, res) => {
    try {
        const status = whatsappClient.getStatus();
        if (!status.isReady && !status.isAuthenticated) {
            return res.json({ 
                success: false, 
                message: 'WhatsApp client initializing...' 
            });
        }

        const chats = await whatsappClient.getChats();
        
        // Initialize counters
        let totalChats = chats.length;
        let individualChats = 0;
        let groupChats = 0;
        let unreadChats = 0;
        let repliedChats = 0;
        let notRepliedChats = 0;
        let totalMessagesReceived = 0;
        let totalMessagesSent = 0;
        let todayChats = 0;
        let thisWeekChats = 0;
        let thisMonthChats = 0;
        let newContactsToday = 0; // New contacts counter
        
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
        const todayStr = now.toDateString();
        const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).getTime() / 1000;
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;
        
        // Response time tracking
        let totalResponseTime = 0;
        let responseCount = 0;
        
        // Per-chat analytics
        const chatAnalytics = [];
        
        for (const chat of chats) {
            const isGroup = chat.isGroup;
            if (isGroup) {
                groupChats++;
            } else {
                individualChats++;
            }
            
            if (chat.unreadCount > 0) {
                unreadChats++;
            }
            
            // Fetch messages for detailed analysis
            try {
                const messages = await chat.fetchMessages({ limit: 50 });
                
                let chatSent = 0;
                let chatReceived = 0;
                let hasReply = false;
                let lastIncoming = null;
                let firstReply = null;
                
                for (const msg of messages) {
                    if (msg.fromMe) {
                        chatSent++;
                        totalMessagesSent++;
                        if (lastIncoming && !firstReply) {
                            firstReply = msg.timestamp;
                            const responseTime = firstReply - lastIncoming;
                            totalResponseTime += responseTime;
                            responseCount++;
                        }
                        hasReply = true;
                    } else {
                        chatReceived++;
                        totalMessagesReceived++;
                        if (!hasReply) {
                            lastIncoming = msg.timestamp;
                        }
                    }
                }
                
                if (hasReply) {
                    repliedChats++;
                } else if (chatReceived > 0) {
                    notRepliedChats++;
                }
                
                // Time-based analytics
                const chatTimestamp = chat.timestamp || (messages.length > 0 ? messages[messages.length - 1].timestamp : 0);
                if (chatTimestamp >= todayStart) todayChats++;
                if (chatTimestamp >= weekStart) thisWeekChats++;
                if (chatTimestamp >= monthStart) thisMonthChats++;
                
                // Check if this is a new contact today (all messages are from today)
                let isNewContactToday = false;
                if (!isGroup && messages.length > 0 && messages.length < 50) {
                    // Sort messages by timestamp to get the actual oldest message
                    const sortedMessages = [...messages].sort((a, b) => a.timestamp - b.timestamp);
                    const oldestMessage = sortedMessages[0];
                    const oldestMsgDate = new Date(oldestMessage.timestamp * 1000);
                    
                    // Check if oldest message is from today
                    if (oldestMsgDate.toDateString() === todayStr) {
                        // Also verify all messages are from today
                        const allFromToday = sortedMessages.every(msg => {
                            const msgDate = new Date(msg.timestamp * 1000);
                            return msgDate.toDateString() === todayStr;
                        });
                        isNewContactToday = allFromToday;
                    }
                }
                if (isNewContactToday) newContactsToday++;
                
                // Add to per-chat analytics
                chatAnalytics.push({
                    id: chat.id._serialized,
                    name: chat.name || chat.id.user,
                    isGroup,
                    messagesSent: chatSent,
                    messagesReceived: chatReceived,
                    totalMessages: chatSent + chatReceived,
                    hasBeenReplied: hasReply,
                    unreadCount: chat.unreadCount,
                    lastMessageTime: chatTimestamp,
                    isNewContact: isNewContactToday
                });
            } catch (err) {
                console.log('Error analyzing chat:', err.message);
            }
        }
        
        // Calculate averages
        const avgResponseTime = responseCount > 0 ? Math.round(totalResponseTime / responseCount) : 0;
        const replyRate = totalChats > 0 ? Math.round((repliedChats / totalChats) * 100) : 0;
        
        // Format response time
        const formatDuration = (seconds) => {
            if (seconds < 60) return `${seconds}s`;
            if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
            return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
        };
        
        const analytics = {
            overview: {
                totalChats,
                individualChats,
                groupChats,
                unreadChats,
                repliedChats,
                notRepliedChats,
                newContactsToday,
                replyRate: `${replyRate}%`,
                avgResponseTime: formatDuration(avgResponseTime),
                avgResponseTimeSeconds: avgResponseTime
            },
            messages: {
                totalSent: totalMessagesSent,
                totalReceived: totalMessagesReceived,
                total: totalMessagesSent + totalMessagesReceived
            },
            timeRange: {
                today: todayChats,
                thisWeek: thisWeekChats,
                thisMonth: thisMonthChats
            },
            topChats: chatAnalytics
                .sort((a, b) => b.totalMessages - a.totalMessages)
                .slice(0, 10),
            pendingReplies: chatAnalytics
                .filter(c => !c.hasBeenReplied && c.messagesReceived > 0)
                .sort((a, b) => b.lastMessageTime - a.lastMessageTime)
        };

        res.json({ success: true, analytics });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Logout
router.post('/logout', async (req, res) => {
    try {
        await whatsappClient.logout();
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        console.error('Error logging out:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ACCOUNT MANAGEMENT API ====================
const accountManager = require('../whatsapp/accountManager');

// Get all accounts
router.get('/accounts', async (req, res) => {
    try {
        const accounts = accountManager.getAllAccounts();
        res.json({ success: true, accounts });
    } catch (error) {
        console.error('Error getting accounts:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create new account
router.post('/accounts', async (req, res) => {
    try {
        const { name } = req.body;
        const account = await accountManager.createAccount(name);
        res.json({ 
            success: true, 
            account: {
                id: account.id,
                name: account.name,
                createdAt: account.createdAt
            }
        });
    } catch (error) {
        console.error('Error creating account:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get account status
router.get('/accounts/:accountId/status', async (req, res) => {
    try {
        const { accountId } = req.params;
        const status = accountManager.getAccountStatus(accountId);
        if (!status) {
            return res.status(404).json({ success: false, error: 'Account not found' });
        }
        res.json({ success: true, status });
    } catch (error) {
        console.error('Error getting account status:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Initialize account (start WhatsApp client)
router.post('/accounts/:accountId/initialize', async (req, res) => {
    try {
        const { accountId } = req.params;
        await accountManager.initializeAccount(accountId);
        res.json({ success: true, message: 'Account initialization started' });
    } catch (error) {
        console.error('Error initializing account:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Switch to account
router.post('/accounts/:accountId/switch', async (req, res) => {
    try {
        const { accountId } = req.params;
        await accountManager.switchAccount(accountId);
        const account = accountManager.getAccountStatus(accountId);
        res.json({ 
            success: true, 
            message: 'Switched to account', 
            account: account,
            status: account // Keep for backward compatibility
        });
    } catch (error) {
        console.error('Error switching account:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Rename account
router.put('/accounts/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { name } = req.body;
        accountManager.renameAccount(accountId, name);
        res.json({ success: true, message: 'Account renamed' });
    } catch (error) {
        console.error('Error renaming account:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete account
router.delete('/accounts/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        await accountManager.deleteAccount(accountId);
        res.json({ success: true, message: 'Account deleted' });
    } catch (error) {
        console.error('Error deleting account:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get QR code for specific account
router.get('/accounts/:accountId/qr', async (req, res) => {
    try {
        const { accountId } = req.params;
        const qr = accountManager.getQRCode(accountId);
        if (!qr) {
            return res.json({ 
                success: false, 
                message: 'No QR code available for this account.' 
            });
        }
        
        const qrDataUrl = await QRCode.toDataURL(qr, {
            width: 300,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#ffffff'
            }
        });
        
        res.json({ success: true, qrCode: qrDataUrl, qrRaw: qr });
    } catch (error) {
        console.error('Error getting QR code:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Logout from specific account
router.post('/accounts/:accountId/logout', async (req, res) => {
    try {
        const { accountId } = req.params;
        await accountManager.logoutAccount(accountId);
        res.json({ success: true, message: 'Logged out from account' });
    } catch (error) {
        console.error('Error logging out from account:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
