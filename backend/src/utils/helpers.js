/**
 * Format chat data for API response
 * @param {*} chat - Chat object
 * @param {*} lastMessage - Last message in chat
 * @param {*} messageCount - Number of messages fetched
 * @param {*} oldestMessageTimestamp - Timestamp of oldest/first message fetched
 * @param {boolean} allMessagesToday - True if ALL messages in chat are from today only
 */
function formatChat(chat, lastMessage = null, messageCount = 0, oldestMessageTimestamp = null, allMessagesToday = false) {
    // A chat is "first contact" / "new" if:
    // 1. Not a group
    // 2. ALL messages in the conversation are from today (no older messages exist)
    const isNewContactToday = !chat.isGroup && allMessagesToday && messageCount > 0;
    
    return {
        id: chat.id._serialized,
        name: chat.name || chat.id.user,
        isGroup: chat.isGroup,
        unreadCount: chat.unreadCount,
        timestamp: chat.timestamp,
        lastMessage: lastMessage ? formatMessage(lastMessage) : null,
        profilePicUrl: null, // Will be fetched separately if needed
        isArchived: chat.archived,
        isPinned: chat.pinned,
        isMuted: chat.isMuted,
        messageCount: messageCount,
        isFirstContact: isNewContactToday // New contact if ALL messages are from today
    };
}

/**
 * Format message data for API response
 */
function formatMessage(message, authorContact = null) {
    // Extract author info
    let authorInfo = null;
    if (message.author) {
        // Parse author ID to get phone number
        const authorNumber = message.author.split('@')[0];
        authorInfo = {
            id: message.author,
            number: authorNumber,
            name: authorContact?.pushname || authorContact?.name || null,
            profilePicUrl: null // Will be set separately if available
        };
    }

    // Extract media info if present
    let mediaInfo = null;
    if (message.hasMedia && message._data) {
        mediaInfo = {
            mimetype: message._data.mimetype || null,
            filename: message._data.filename || null,
            filesize: message._data.size || null,
            caption: message._data.caption || message.body || null,
            duration: message._data.duration || null, // For audio/video
            isGif: message._data.isGif || false,
            isViewOnce: message._data.isViewOnce || false,
            width: message._data.width || null,
            height: message._data.height || null
        };
    }

    return {
        id: message.id._serialized,
        body: message.body,
        timestamp: message.timestamp,
        fromMe: message.fromMe,
        author: message.author || null,
        authorInfo: authorInfo,
        type: message.type,
        hasMedia: message.hasMedia,
        mediaInfo: mediaInfo,
        isForwarded: message.isForwarded,
        isStatus: message.isStatus,
        isStarred: message.isStarred,
        ack: message.ack, // 0: pending, 1: sent, 2: delivered, 3: read
        mentionedIds: message.mentionedIds || [],
        quotedMsg: message.hasQuotedMsg ? message._data.quotedMsg : null
    };
}

/**
 * Format message with author details (async version that fetches contact info)
 */
async function formatMessageWithAuthor(message, client) {
    let authorContact = null;
    
    // If message has an author (group message), try to get contact info
    if (message.author && client) {
        try {
            authorContact = await client.getContactById(message.author);
        } catch (e) {
            console.log('Could not get author contact:', e.message);
        }
    }

    const formatted = formatMessage(message, authorContact);
    
    // Try to get profile picture
    if (message.author && client && formatted.authorInfo) {
        try {
            const profilePic = await client.getProfilePicUrl(message.author);
            formatted.authorInfo.profilePicUrl = profilePic || null;
        } catch (e) {
            // Profile pic might not be available
        }
    }

    return formatted;
}

/**
 * Check if a chat has been replied to (has outgoing message after last incoming)
 */
function hasBeenReplied(messages) {
    if (!messages || messages.length === 0) return false;
    
    // Find the last incoming message index
    let lastIncomingIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (!messages[i].fromMe) {
            lastIncomingIndex = i;
            break;
        }
    }
    
    if (lastIncomingIndex === -1) return true; // No incoming messages, so "replied"
    
    // Check if there's an outgoing message after the last incoming
    for (let i = lastIncomingIndex + 1; i < messages.length; i++) {
        if (messages[i].fromMe) {
            return true;
        }
    }
    
    return false;
}

/**
 * Filter chats by date range
 */
function filterByDateRange(timestamp, range) {
    if (!timestamp) return false;
    
    const messageDate = new Date(timestamp * 1000);
    const now = new Date();
    
    switch (range) {
        case 'today':
            return messageDate.toDateString() === now.toDateString();
        
        case 'week':
            const weekAgo = new Date(now);
            weekAgo.setDate(weekAgo.getDate() - 7);
            return messageDate >= weekAgo;
        
        case 'month':
            const monthAgo = new Date(now);
            monthAgo.setMonth(monthAgo.getMonth() - 1);
            return messageDate >= monthAgo;
        
        case 'all':
        default:
            return true;
    }
}

/**
 * Apply all filters to chats
 */
async function applyFilters(chats, filters, whatsappClient) {
    let filteredChats = [...chats];
    
    // Filter by chat type
    if (filters.chatType && filters.chatType !== 'all') {
        filteredChats = filteredChats.filter(chat => {
            if (filters.chatType === 'group') return chat.isGroup;
            if (filters.chatType === 'personal') return !chat.isGroup;
            return true;
        });
    }
    
    // Filter by read status
    if (filters.readStatus && filters.readStatus !== 'all') {
        filteredChats = filteredChats.filter(chat => {
            if (filters.readStatus === 'unread') return chat.unreadCount > 0;
            if (filters.readStatus === 'read') return chat.unreadCount === 0;
            return true;
        });
    }
    
    // Filter by date range
    if (filters.dateRange && filters.dateRange !== 'all') {
        filteredChats = filteredChats.filter(chat => 
            filterByDateRange(chat.timestamp, filters.dateRange)
        );
    }
    
    // Filter by search query
    if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase();
        filteredChats = filteredChats.filter(chat => 
            (chat.name && chat.name.toLowerCase().includes(query)) ||
            chat.id.user.includes(query)
        );
    }
    
    return filteredChats;
}

module.exports = {
    formatChat,
    formatMessage,
    formatMessageWithAuthor,
    hasBeenReplied,
    filterByDateRange,
    applyFilters
};

