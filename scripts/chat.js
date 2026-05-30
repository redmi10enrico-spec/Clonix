/**
 * 💬 CLONIX CHAT SYSTEM
 * 
 * Features:
 * - End-to-End Encryption (E2E) using Web Crypto API
 * - Real-time messaging via Socket.io
 * - Connection-based chat (only matched users can chat)
 * - Online/offline status
 * - Typing indicators
 * - Auto-scroll messages
 */

const API_BASE_URL = window.API_CONFIG?.API_URL || 'http://localhost:3001/api';
const SOCKET_URL = window.API_CONFIG?.SOCKET_URL || 'http://localhost:3001';

// ============================================
// 🔐 E2E ENCRYPTION MODULE (Web Crypto API)
// ============================================

class E2EEncryption {
    constructor() {
        this.keyPair = null;
        this.sharedSecrets = new Map(); // userId -> sharedSecret
    }

    // Generate RSA key pair for user
    async generateKeyPair() {
        try {
            this.keyPair = await window.crypto.subtle.generateKey(
                {
                    name: 'RSA-OAEP',
                    modulusLength: 2048,
                    publicExponent: new Uint8Array([1, 0, 1]),
                    hash: 'SHA-256'
                },
                true, // extractable
                ['encrypt', 'decrypt']
            );
            return this.keyPair;
        } catch (error) {
            console.error('Error generating key pair:', error);
            throw error;
        }
    }

    // Export public key to string (for sharing)
    async exportPublicKey() {
        if (!this.keyPair) {
            throw new Error('Key pair not generated');
        }
        
        try {
            const exported = await window.crypto.subtle.exportKey(
                'spki',
                this.keyPair.publicKey
            );
            return btoa(String.fromCharCode(...new Uint8Array(exported)));
        } catch (error) {
            console.error('Error exporting public key:', error);
            throw error;
        }
    }

    async exportKeyPair() {
        if (!this.keyPair) {
            throw new Error('Key pair not generated');
        }

        const [publicKey, privateKey] = await Promise.all([
            window.crypto.subtle.exportKey('jwk', this.keyPair.publicKey),
            window.crypto.subtle.exportKey('jwk', this.keyPair.privateKey)
        ]);

        return { publicKey, privateKey };
    }

    async importKeyPair(keyData) {
        if (!keyData?.publicKey || !keyData?.privateKey) {
            throw new Error('Stored key pair is incomplete');
        }

        const [publicKey, privateKey] = await Promise.all([
            window.crypto.subtle.importKey(
                'jwk',
                keyData.publicKey,
                {
                    name: 'RSA-OAEP',
                    hash: 'SHA-256'
                },
                true,
                ['encrypt']
            ),
            window.crypto.subtle.importKey(
                'jwk',
                keyData.privateKey,
                {
                    name: 'RSA-OAEP',
                    hash: 'SHA-256'
                },
                true,
                ['decrypt']
            )
        ]);

        this.keyPair = { publicKey, privateKey };
        return this.keyPair;
    }

    // Import another user's public key
    async importPublicKey(publicKeyString) {
        try {
            const binaryString = atob(publicKeyString);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            const publicKey = await window.crypto.subtle.importKey(
                'spki',
                bytes.buffer,
                {
                    name: 'RSA-OAEP',
                    hash: 'SHA-256'
                },
                false,
                ['encrypt']
            );
            return publicKey;
        } catch (error) {
            console.error('Error importing public key:', error);
            throw error;
        }
    }

    // Generate AES key for symmetric encryption
    async generateAESKey() {
        return await window.crypto.subtle.generateKey(
            {
                name: 'AES-GCM',
                length: 256
            },
            true,
            ['encrypt', 'decrypt']
        );
    }

    // Encrypt message using hybrid encryption
    async encryptMessage(message, recipientPublicKeyString) {
        try {
            // Import recipient's public key
            const recipientPublicKey = await this.importPublicKey(recipientPublicKeyString);
            
            // Generate AES key for this message
            const aesKey = await this.generateAESKey();
            
            // Generate IV
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            
            // Encrypt message with AES-GCM
            const encoder = new TextEncoder();
            const messageData = encoder.encode(message);
            
            const encryptedContent = await window.crypto.subtle.encrypt(
                {
                    name: 'AES-GCM',
                    iv: iv
                },
                aesKey,
                messageData
            );
            
            // Export AES key and encrypt it with recipient's public key
            const exportedAESKey = await window.crypto.subtle.exportKey('raw', aesKey);
            const encryptedKey = await window.crypto.subtle.encrypt(
                {
                    name: 'RSA-OAEP'
                },
                recipientPublicKey,
                exportedAESKey
            );
            
            // Combine encrypted key, iv, and encrypted content
            const encryptedKeyArray = new Uint8Array(encryptedKey);
            const encryptedContentArray = new Uint8Array(encryptedContent);
            
            // Create payload: [keyLength(4 bytes)][encryptedKey][iv(12 bytes)][encryptedContent]
            const keyLength = encryptedKeyArray.length;
            const payload = new Uint8Array(4 + keyLength + 12 + encryptedContentArray.length);
            
            // Write key length (4 bytes, big-endian)
            const view = new DataView(payload.buffer);
            view.setUint32(0, keyLength, false);
            
            // Write encrypted key
            payload.set(encryptedKeyArray, 4);
            
            // Write IV
            payload.set(iv, 4 + keyLength);
            
            // Write encrypted content
            payload.set(encryptedContentArray, 4 + keyLength + 12);
            
            // Convert to base64 for transport
            return btoa(String.fromCharCode(...payload));
        } catch (error) {
            console.error('Error encrypting message:', error);
            throw error;
        }
    }

    // Decrypt message
    async decryptMessage(encryptedPayload) {
        try {
            if (!this.keyPair) {
                throw new Error('Key pair not available for decryption');
            }
            
            // Decode base64
            const binaryString = atob(encryptedPayload);
            const payload = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                payload[i] = binaryString.charCodeAt(i);
            }
            
            // Read key length
            const view = new DataView(payload.buffer);
            const keyLength = view.getUint32(0, false);
            
            // Extract encrypted key
            const encryptedKey = payload.slice(4, 4 + keyLength);
            
            // Extract IV
            const iv = payload.slice(4 + keyLength, 4 + keyLength + 12);
            
            // Extract encrypted content
            const encryptedContent = payload.slice(4 + keyLength + 12);
            
            // Decrypt AES key with private key
            const aesKeyData = await window.crypto.subtle.decrypt(
                {
                    name: 'RSA-OAEP'
                },
                this.keyPair.privateKey,
                encryptedKey
            );
            
            // Import AES key
            const aesKey = await window.crypto.subtle.importKey(
                'raw',
                aesKeyData,
                {
                    name: 'AES-GCM',
                    length: 256
                },
                false,
                ['decrypt']
            );
            
            // Decrypt content
            const decryptedData = await window.crypto.subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: iv
                },
                aesKey,
                encryptedContent
            );
            
            // Decode to string
            const decoder = new TextDecoder();
            return decoder.decode(decryptedData);
        } catch (error) {
            console.error('Error decrypting message:', error);
            return '[Messaggio crittato - impossibile decifrare]';
        }
    }
}

// ============================================
// 💬 CHAT MANAGER
// ============================================

class ChatManager {
    constructor() {
        this.socket = null;
        this.e2e = new E2EEncryption();
        this.currentUser = null;
        this.connections = [];
        this.currentChat = null; // { userId, publicKey, messages }
        this.publicKeys = new Map(); // userId -> publicKey
        this.onlineUsers = new Set();
        this.typingTimeout = null;
        
        this.init();
    }

    async init() {
        // Get current user
        const userStr = localStorage.getItem('currentUser');
        const token = localStorage.getItem('authToken');
        
        if (!userStr || !token) {
            console.warn('ChatManager: User not authenticated');
            return;
        }
        
        this.currentUser = JSON.parse(userStr);
        this.token = token;
        
        // Generate or load E2E keys
        await this.setupE2E();
        
        // Initialize Socket.io
        this.initSocket();
        
        console.log('✅ ChatManager initialized');
    }

    async setupE2E() {
        try {
            const storedKeys = localStorage.getItem(`e2e_keys_${this.currentUser.id}`);

            if (storedKeys) {
                try {
                    await this.e2e.importKeyPair(JSON.parse(storedKeys));
                } catch (error) {
                    console.warn('Stored E2E keys are invalid, generating a new pair:', error);
                    localStorage.removeItem(`e2e_keys_${this.currentUser.id}`);
                }
            }

            if (!this.e2e.keyPair) {
                await this.e2e.generateKeyPair();
                const keyData = await this.e2e.exportKeyPair();
                localStorage.setItem(`e2e_keys_${this.currentUser.id}`, JSON.stringify(keyData));
            }

            const publicKey = await this.e2e.exportPublicKey();
            
            // Upload public key to server
            await fetch(`${API_BASE_URL}/keys/public`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ publicKey })
            });
            
            console.log('E2E keys loaded and public key uploaded');
        } catch (error) {
            console.error('Error setting up E2E:', error);
        }
    }

    initSocket() {
        try {
            this.socket = io(SOCKET_URL, {
                auth: { token: this.token },
                transports: ['websocket', 'polling']
            });

            this.socket.on('connect', () => {
                console.log('🔌 Socket connected');
                this.updateConnectionStatus(true);
            });

            this.socket.on('disconnect', () => {
                console.log('🔌 Socket disconnected');
                this.updateConnectionStatus(false);
            });

            this.socket.on('online_users', ({ users }) => {
                this.onlineUsers = new Set(users);
                this.updateOnlineStatusUI();
            });

            this.socket.on('user_online', ({ userId }) => {
                this.onlineUsers.add(userId);
                this.updateOnlineStatusUI();
            });

            this.socket.on('user_offline', ({ userId }) => {
                this.onlineUsers.delete(userId);
                this.updateOnlineStatusUI();
            });

            this.socket.on('new_message', async (data) => {
                await this.handleNewMessage(data);
            });

            this.socket.on('typing', ({ userId, isTyping }) => {
                this.updateTypingIndicator(userId, isTyping);
            });

            this.socket.on('messages_read', ({ by }) => {
                this.updateReadStatus(by);
            });

            this.socket.on('new_connection', ({ userId }) => {
                // Reload connections
                this.loadConnections();
            });

        } catch (error) {
            console.error('Error initializing socket:', error);
        }
    }

    updateConnectionStatus(connected) {
        const indicator = document.getElementById('chatConnectionStatus');
        if (indicator) {
            indicator.className = connected ? 'connected' : 'disconnected';
            indicator.title = connected ? 'Connesso' : 'Disconnesso';
        }
    }

    // Load connections from API
    async loadConnections() {
        try {
            const response = await fetch(`${API_BASE_URL}/connections`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.connections = data.connections;
                this.renderConnections();
                
                // Update connection count
                const countEl = document.getElementById('connectionsCount');
                if (countEl) {
                    countEl.textContent = `${this.connections.length} connession${this.connections.length === 1 ? 'e' : 'i'}`;
                }
            }
        } catch (error) {
            console.error('Error loading connections:', error);
        }
    }

    renderConnections() {
        const container = document.getElementById('connectionsList');
        if (!container) return;

        if (this.connections.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>Nessun match ancora. Vai nella sezione Match per trovare persone!</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.connections.map(conn => `
            <div class="connection-item ${this.currentChat?.userId === conn.user_id ? 'active' : ''}" 
                 data-user-id="${conn.user_id}"
                 onclick="window.chatManager?.openChat(${conn.user_id}, '${this.escapeJsString(this.getDisplayName(conn))}')">
                <div class="connection-avatar ${conn.isOnline ? 'online' : ''}">
                    ${this.avatarHTML(conn)}
                    ${conn.isOnline ? '<span class="online-dot"></span>' : ''}
                </div>
                <div class="connection-info">
                    <h4>${this.escapeHtml(this.getDisplayName(conn))}</h4>
                    <p>${conn.isOnline ? '🟢 Online' : '⚪ Offline'}</p>
                </div>
                ${conn.unread_count > 0 ? `<span class="unread-badge">${conn.unread_count}</span>` : ''}
            </div>
        `).join('');
    }

    getDisplayName(user = {}) {
        return user.displayName || user.display_name || user.nickname || user.name || user.email || 'Utente';
    }

    getInitials(name = 'Utente') {
        return String(name)
            .trim()
            .split(/\s+/)
            .map(part => part[0])
            .join('')
            .toUpperCase()
            .slice(0, 2) || '?';
    }

    escapeJsString(value = '') {
        return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    avatarHTML(user = {}) {
        const displayName = this.getDisplayName(user);
        if (user.avatar_url) {
            return `<img src="${this.escapeHtml(user.avatar_url)}" alt="${this.escapeHtml(displayName)}" class="identity-avatar-img" onerror="this.replaceWith(document.createTextNode('${this.escapeJsString(this.getInitials(displayName))}'))">`;
        }
        return this.escapeHtml(this.getInitials(displayName));
    }

    // Open chat with specific user
    async openChat(userId, userName) {
        const connection = this.connections.find(conn => conn.user_id === userId || conn.other_user_id === userId);
        const displayName = this.getDisplayName(connection || { name: userName });
        this.currentChat = { userId, userName: displayName, avatar_url: connection?.avatar_url, messages: [] };
        
        // Update UI
        document.querySelectorAll('.connection-item').forEach(el => {
            el.classList.remove('active');
        });
        const activeEl = document.querySelector(`.connection-item[data-user-id="${userId}"]`);
        if (activeEl) activeEl.classList.add('active');
        
        // Show chat area
        const chatHeader = document.getElementById('chatHeader');
        const chatInputArea = document.getElementById('chatInputArea');
        
        if (chatHeader) {
            chatHeader.style.display = 'flex';
            document.getElementById('chatHeaderName').textContent = displayName;
            document.getElementById('chatHeaderAvatar').innerHTML = this.avatarHTML(connection || { name: displayName });
            this.updateChatHeaderStatus();
        }
        
        if (chatInputArea) chatInputArea.style.display = 'flex';
        
        // Load recipient's public key
        await this.loadPublicKey(userId);
        
        // Load messages
        await this.loadMessages(userId);
        
        // Mark messages as read
        this.socket?.emit('mark_read', { senderId: userId });
        
        // Focus input
        setTimeout(() => document.getElementById('chatInput')?.focus(), 100);
    }

    updateChatHeaderStatus() {
        const statusEl = document.getElementById('chatHeaderStatus');
        if (statusEl && this.currentChat) {
            const isOnline = this.onlineUsers.has(this.currentChat.userId);
            statusEl.innerHTML = isOnline ? 
                '<span class="online-indicator">🟢 Online</span>' : 
                '<span class="offline-indicator">⚪ Offline</span>';
        }
    }

    updateOnlineStatusUI() {
        // Update connection list
        this.renderConnections();
        
        // Update chat header if chatting
        if (this.currentChat) {
            this.updateChatHeaderStatus();
        }
    }

    async loadPublicKey(userId) {
        // Check cache
        if (this.publicKeys.has(userId)) {
            this.currentChat.publicKey = this.publicKeys.get(userId);
            return;
        }
        
        try {
            const response = await fetch(`${API_BASE_URL}/keys/public/${userId}`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.publicKeys.set(userId, data.publicKey);
                this.currentChat.publicKey = data.publicKey;
            }
        } catch (error) {
            console.error('Error loading public key:', error);
        }
    }

    async loadMessages(userId) {
        try {
            const response = await fetch(`${API_BASE_URL}/messages/${userId}?limit=50`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            
            const data = await response.json();
            
            if (data.success) {
                // Decrypt messages
                const decryptedMessages = await Promise.all(
                    data.messages.map(async (msg) => {
                        const encryptedPayload = msg.encrypted_content || msg.encryptedContent || msg.content;

                        return {
                            ...msg,
                            encrypted_content: encryptedPayload,
                            decryptedContent: msg.encrypted
                                ? await this.e2e.decryptMessage(encryptedPayload)
                                : (msg.content || '')
                        };
                    })
                );
                
                this.currentChat.messages = decryptedMessages;
                this.renderMessages();
            }
        } catch (error) {
            console.error('Error loading messages:', error);
        }
    }

    renderMessages() {
        const container = document.getElementById('chatMessages');
        if (!container || !this.currentChat) return;

        if (this.currentChat.messages.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>Nessun messaggio ancora. Inizia la conversazione!</p>
                </div>
            `;
            return;
        }

        const currentUserId = this.currentUser.id;
        
        container.innerHTML = this.currentChat.messages.map(msg => {
            const isSent = msg.sender_id === currentUserId;
            const time = new Date(msg.created_at).toLocaleTimeString('it-IT', { 
                hour: '2-digit', 
                minute: '2-digit' 
            });
            const senderIdentity = isSent ? this.currentUser : {
                ...this.currentChat,
                name: msg.sender_name || this.currentChat.name,
                nickname: msg.sender_nickname || this.currentChat.nickname,
                avatar_url: msg.sender_avatar || this.currentChat.avatar_url
            };
            
            return `
                <div class="message ${isSent ? 'sent' : 'received'}">
                    ${isSent ? '' : `<div class="message-avatar">${this.avatarHTML(senderIdentity)}</div>`}
                    <div class="message-content">
                        <p>${this.escapeHtml(msg.decryptedContent || msg.content || '[Messaggio non disponibile]')}</p>
                        <span class="message-time">${time}${msg.is_read && isSent ? ' ✓' : ''}</span>
                    </div>
                </div>
            `;
        }).join('');
        
        // Auto-scroll to bottom
        this.scrollToBottom();
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    scrollToBottom() {
        const container = document.getElementById('chatMessages');
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }

    // Send message
    async sendMessage() {
        const input = document.getElementById('chatInput');
        const content = input?.value?.trim();
        
        if (!content || !this.currentChat || !this.socket) return;
        
        if (!this.currentChat.publicKey) {
            alert('Chiave pubblica del destinatario non disponibile');
            return;
        }
        
        try {
            // Encrypt message
            const encryptedContent = await this.e2e.encryptMessage(
                content, 
                this.currentChat.publicKey
            );
            const senderEncryptedContent = await this.e2e.encryptMessage(
                content,
                await this.e2e.exportPublicKey()
            );
            
            // Clear input immediately for better UX
            input.value = '';
            
            // Send via socket
            this.socket.emit('send_message', {
                receiverId: this.currentChat.userId,
                encryptedContent: encryptedContent,
                senderEncryptedContent: senderEncryptedContent
            }, (response) => {
                if (response.success) {
                    // Add to local messages
                    const newMessage = {
                        id: response.messageId,
                        sender_id: this.currentUser.id,
                        receiver_id: this.currentChat.userId,
                        encrypted_content: encryptedContent,
                        decryptedContent: content,
                        created_at: new Date().toISOString(),
                        is_read: false
                    };
                    
                    this.currentChat.messages.push(newMessage);
                    this.renderMessages();
                } else {
                    console.error('Error sending message:', response.error);
                    alert('Errore nell\'invio del messaggio');
                }
            });
            
        } catch (error) {
            console.error('Error sending message:', error);
            alert('Errore nella crittografia del messaggio');
        }
    }

    // Handle incoming message
    async handleNewMessage(data) {
        const { senderId, encryptedContent, createdAt } = data;
        
        // If currently chatting with sender, decrypt and show
        if (this.currentChat?.userId === senderId) {
            const decryptedContent = await this.e2e.decryptMessage(encryptedContent);
            
            const newMessage = {
                id: data.id,
                sender_id: senderId,
                receiver_id: this.currentUser.id,
                encrypted_content: encryptedContent,
                decryptedContent: decryptedContent,
                created_at: createdAt,
                is_read: true,
                sender_name: data.sender_name,
                sender_nickname: data.sender_nickname,
                sender_avatar: data.sender_avatar
            };
            
            this.currentChat.messages.push(newMessage);
            this.renderMessages();
            
            // Mark as read
            this.socket.emit('mark_read', { senderId });
        } else {
            // Reload connections to show unread badge
            this.loadConnections();
        }
    }

    // Typing indicator
    handleTyping() {
        if (!this.currentChat || !this.socket) return;
        
        // Send typing event
        this.socket.emit('typing', {
            receiverId: this.currentChat.userId,
            isTyping: true
        });
        
        // Clear previous timeout
        if (this.typingTimeout) {
            clearTimeout(this.typingTimeout);
        }
        
        // Set timeout to stop typing indicator after 1 second of inactivity
        this.typingTimeout = setTimeout(() => {
            this.socket.emit('typing', {
                receiverId: this.currentChat.userId,
                isTyping: false
            });
        }, 1000);
    }

    updateTypingIndicator(userId, isTyping) {
        if (this.currentChat?.userId !== userId) return;
        
        const statusEl = document.getElementById('chatHeaderStatus');
        if (statusEl) {
            if (isTyping) {
                statusEl.innerHTML = '<span class="typing-indicator">sta scrivendo...</span>';
            } else {
                this.updateChatHeaderStatus();
            }
        }
    }

    updateReadStatus(by) {
        // Update read status for sent messages
        if (this.currentChat && this.currentChat.messages) {
            this.currentChat.messages.forEach(msg => {
                if (msg.sender_id === this.currentUser.id) {
                    msg.is_read = true;
                }
            });
            this.renderMessages();
        }
    }
}

// ============================================
// 📦 INITIALIZATION
// ============================================

// Global instance
let chatManager = null;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Check if we're on the main page with chat
    if (document.getElementById('chatSection')) {
        chatManager = new ChatManager();
        window.chatManager = chatManager;
        
        // Setup event listeners
        setupChatEventListeners();
    }
});

function setupChatEventListeners() {
    // Send button
    const sendBtn = document.getElementById('sendMessageBtn');
    if (sendBtn) {
        sendBtn.addEventListener('click', () => chatManager?.sendMessage());
    }
    
    // Enter key in input
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                chatManager?.sendMessage();
            }
        });
        
        // Typing indicator
        chatInput.addEventListener('input', () => {
            chatManager?.handleTyping();
        });
    }
    
    // Load connections button
    const refreshBtn = document.querySelector('[onclick="loadConnections()"]');
    if (refreshBtn) {
        refreshBtn.onclick = () => chatManager?.loadConnections();
    }
}

// Expose for onclick handlers
window.loadConnections = function() {
    window.chatManager?.loadConnections();
};

window.openChat = function(userId, userName) {
    window.chatManager?.openChat(userId, userName);
};
