/**
 * 🗄️ SERVER LOCALE CON SQLITE
 * Per testare l'app senza dipendere da Aiven MySQL
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { OAuth2Client } = require('google-auth-library');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Create HTTP server and Socket.io
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: ['http://localhost:8081', 'http://localhost:3000', 'http://127.0.0.1:5500'],
        credentials: true,
        methods: ['GET', 'POST']
    }
});

// Google OAuth Client
let oauth2Client;

// Initialize Google OAuth safely
function initGoogleOAuth() {
    try {
        if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
            oauth2Client = new OAuth2Client(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET,
                process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/api/auth/google/callback`
            );
            console.log('✅ Google OAuth initialized successfully');
            return true;
        } else {
            console.log('⚠️  Google OAuth credentials not found in .env');
            return false;
        }
    } catch (error) {
        console.error('❌ Error initializing Google OAuth:', error.message);
        return false;
    }
}

// Security middleware
app.use(helmet());
app.use(cors({
    origin: ['http://localhost:8081', 'http://localhost:3000', 'http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:3002'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
});
app.use('/api/', limiter);

app.use(express.json({ limit: '10mb' }));

// ============================================
// 🗄️ DATABASE SQLITE
// ============================================
const db = new sqlite3.Database('./clonix_local.db');

// Initialize database
function initDatabase() {
    return new Promise((resolve, reject) => {
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT,
                google_id TEXT UNIQUE,
                avatar_url TEXT,
                skills TEXT DEFAULT '[]',
                public_key TEXT DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_login DATETIME,
                is_active INTEGER DEFAULT 1,
                email_verified INTEGER DEFAULT 0
            )
        `, (err) => {
            if (err) {
                console.error('Error creating users table:', err);
                reject(err);
            } else {
                console.log('✅ Users table ready');
                initConnectionsTable().then(() => resolve()).catch(reject);
            }
        });
    });
}

function initConnectionsTable() {
    return new Promise((resolve, reject) => {
        db.run(`
            CREATE TABLE IF NOT EXISTS connections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user1_id INTEGER NOT NULL,
                user2_id INTEGER NOT NULL,
                status TEXT DEFAULT 'active',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user1_id, user2_id),
                FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `, (err) => {
            if (err) {
                console.error('Error creating connections table:', err);
                reject(err);
            } else {
                console.log('✅ Connections table ready');
                initMessagesTable().then(() => resolve()).catch(reject);
            }
        });
    });
}

function initMessagesTable() {
    return new Promise((resolve, reject) => {
        db.run(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_id INTEGER NOT NULL,
                receiver_id INTEGER NOT NULL,
                encrypted_content TEXT NOT NULL,
                encrypted BOOLEAN DEFAULT 1,
                is_read BOOLEAN DEFAULT 0,
                read_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `, (err) => {
            if (err) {
                console.error('Error creating messages table:', err);
                reject(err);
            } else {
                console.log('✅ Messages table ready (E2E encrypted)');
                resolve();
            }
        });
    });
}

// ============================================
// 🔐 AUTHENTICATION
// ============================================
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, error: 'Token mancante' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, error: 'Token non valido' });
        }
        req.user = user;
        next();
    });
}

function generateToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, name: user.name },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
}

// ============================================
// 🎯 MATCHING SYSTEM
// ============================================
const TAG_WEIGHTS = {
    'startup': 2,
    'founder': 2,
    'investor': 2,
    'ai': 1.5,
    'machine-learning': 1.5
};

const DEFAULT_TAG_WEIGHT = 1;
const POINTS_PER_MATCH = 3;

function matchScore(userA, userB) {
    const skillsA = typeof userA.skills === 'string' ? JSON.parse(userA.skills || '[]') : (userA.skills || []);
    const skillsB = typeof userB.skills === 'string' ? JSON.parse(userB.skills || '[]') : (userB.skills || []);
    
    const normalizedA = skillsA.map(s => s.toLowerCase().trim());
    const normalizedB = skillsB.map(s => s.toLowerCase().trim());
    
    const commonTags = [];
    let weightedScore = 0;
    
    normalizedA.forEach((tag, index) => {
        if (normalizedB.includes(tag)) {
            const originalTag = skillsA[index];
            commonTags.push(originalTag);
            const weight = TAG_WEIGHTS[tag] || DEFAULT_TAG_WEIGHT;
            weightedScore += POINTS_PER_MATCH * weight;
        }
    });
    
    const maxTags = Math.max(skillsA.length, skillsB.length);
    const maxPossibleScore = maxTags * POINTS_PER_MATCH * 2;
    const percentage = maxPossibleScore > 0 
        ? Math.round((weightedScore / maxPossibleScore) * 100)
        : 0;
    
    return {
        score: Math.round(weightedScore),
        percentage: Math.min(percentage, 100),
        commonTags: commonTags,
        totalPossible: maxPossibleScore,
        userASkills: skillsA.length,
        userBSkills: skillsB.length
    };
}

async function getMatches(currentUserId, limit = 10) {
    return new Promise((resolve, reject) => {
        // 1. Get current user
        db.get('SELECT * FROM users WHERE id = ?', [currentUserId], (err, currentUser) => {
            if (err) return reject(err);
            if (!currentUser) return reject(new Error('Utente non trovato'));
            
            const currentSkills = typeof currentUser.skills === 'string' 
                ? JSON.parse(currentUser.skills || '[]') 
                : (currentUser.skills || []);
            
            if (currentSkills.length === 0) {
                return resolve({
                    user: currentUser,
                    matches: [],
                    message: 'Aggiungi competenze al tuo profilo per trovare match'
                });
            }
            
            // 2. Get all other users
            db.all('SELECT * FROM users WHERE id != ? AND skills IS NOT NULL', [currentUserId], (err, otherUsers) => {
                if (err) return reject(err);
                
                // Filter users with skills
                const usersWithSkills = otherUsers.filter(u => {
                    const skills = typeof u.skills === 'string' ? JSON.parse(u.skills || '[]') : (u.skills || []);
                    return skills.length > 0;
                });
                
                // 3. Calculate matches
                const matches = usersWithSkills.map(otherUser => {
                    const matchResult = matchScore(currentUser, otherUser);
                    
                    return {
                        user: {
                            id: otherUser.id,
                            name: otherUser.name,
                            email: otherUser.email,
                            totalSkills: matchResult.userBSkills,
                            memberSince: otherUser.created_at
                        },
                        compatibility: {
                            percentage: matchResult.percentage,
                            score: matchResult.score,
                            commonTags: matchResult.commonTags,
                            commonTagsCount: matchResult.commonTags.length
                        }
                    };
                });
                
                // Filter matches with at least 1 common tag
                const filteredMatches = matches.filter(m => m.compatibility.commonTagsCount > 0);
                
                // Sort by percentage
                filteredMatches.sort((a, b) => b.compatibility.percentage - a.compatibility.percentage);
                
                // Limit results
                const topMatches = filteredMatches.slice(0, limit);
                
                resolve({
                    user: {
                        id: currentUser.id,
                        name: currentUser.name,
                        skills: currentSkills
                    },
                    totalMatches: otherUsers.length,
                    filteredMatches: filteredMatches.length,
                    matches: topMatches
                });
            });
        });
    });
}

// ============================================
// 🚀 API ENDPOINTS
// ============================================

// Register
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Tutti i campi sono richiesti' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run(
            'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
            [name, email, hashedPassword],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(409).json({ error: 'Email già registrata' });
                    }
                    throw err;
                }
                
                const user = { id: this.lastID, name, email };
                const token = generateToken(user);
                
                res.status(201).json({
                    message: 'Registrazione completata',
                    token,
                    user
                });
            }
        );
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Errore durante la registrazione' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        db.get('SELECT * FROM users WHERE email = ? AND is_active = 1', [email], async (err, user) => {
            if (err) {
                console.error('Login error:', err);
                return res.status(500).json({ error: 'Errore server' });
            }
            
            if (!user) {
                return res.status(401).json({ error: 'Credenziali non valide' });
            }
            
            const isValidPassword = await bcrypt.compare(password, user.password_hash);
            if (!isValidPassword) {
                return res.status(401).json({ error: 'Credenziali non valide' });
            }
            
            // Update last login
            db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
            
            const token = generateToken(user);
            
            res.json({
                message: 'Login effettuato',
                token,
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    skills: typeof user.skills === 'string' ? JSON.parse(user.skills || '[]') : (user.skills || [])
                }
            });
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Errore durante il login' });
    }
});

// Google OAuth - Get Auth URL
app.get('/api/auth/google', (req, res) => {
    if (!oauth2Client) {
        return res.json({ 
            error: 'Google OAuth not initialized',
            setup: true,
            instructions: [
                'Go to https://console.cloud.google.com/apis/credentials',
                'Create OAuth 2.0 credentials',
                `Add authorized redirect URI: http://localhost:${PORT}/api/auth/google/callback`,
                'Copy Client ID and Secret to .env file'
            ]
        });
    }
    
    try {
        const scopes = [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile'
        ];
        
        const url = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
            prompt: 'select_account', // Force account selection screen
            state: Math.random().toString(36).substring(7) // CSRF protection
        });
        
        res.json({ authUrl: url });
    } catch (error) {
        console.error('Error generating Google auth URL:', error);
        res.json({ 
            error: 'Failed to generate Google auth URL',
            message: error.message
        });
    }
});

// Google OAuth Callback
app.get('/api/auth/google/callback', async (req, res) => {
    const { code, state } = req.query;
    
    try {
        if (!oauth2Client) {
            throw new Error('Google OAuth not initialized');
        }
        
        // Exchange code for tokens
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        
        // Get user info from Google using the access token
        const userInfoResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`
            }
        });
        const userInfo = userInfoResponse.data;
        
        console.log('Google user info:', userInfo);
        
        // Find or create user in database
        db.get('SELECT * FROM users WHERE google_id = ? OR email = ?', [userInfo.id, userInfo.email], (err, user) => {
            if (err) {
                console.error('Database error:', err);
                return res.redirect('http://localhost:8081/auth.html?error=database_error');
            }
            
            if (!user) {
                // Create new Google user
                db.run(
                    'INSERT INTO users (name, email, google_id, avatar_url, email_verified) VALUES (?, ?, ?, ?, 1)',
                    [userInfo.name, userInfo.email, userInfo.id, userInfo.picture],
                    function(err) {
                        if (err) {
                            console.error('Error creating Google user:', err);
                            return res.redirect('http://localhost:8081/auth.html?error=user_creation_failed');
                        }
                        
                        const newUser = {
                            id: this.lastID,
                            name: userInfo.name,
                            email: userInfo.email,
                            avatar_url: userInfo.picture
                        };
                        
                        const token = generateToken(newUser);
                        const redirectUrl = `http://localhost:8081/auth-success.html?token=${token}&user=${encodeURIComponent(JSON.stringify(newUser))}`;
                        res.redirect(redirectUrl);
                    }
                );
            } else {
                // Update existing user with Google info if missing
                if (!user.google_id) {
                    db.run(
                        'UPDATE users SET google_id = ?, avatar_url = COALESCE(?, avatar_url), email_verified = 1 WHERE id = ?',
                        [userInfo.id, userInfo.picture, user.id]
                    );
                    user.avatar_url = userInfo.picture || user.avatar_url;
                }
                
                // Update last login
                db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
                
                const token = generateToken(user);
                const redirectUrl = `http://localhost:8081/auth-success.html?token=${token}&user=${encodeURIComponent(JSON.stringify({
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    avatar_url: user.avatar_url
                }))}`;
                res.redirect(redirectUrl);
            }
        });
        
    } catch (error) {
        console.error('Google OAuth callback error:', error);
        res.redirect('http://localhost:8081/auth.html?error=google_auth_failed');
    }
});

// Google OAuth Login
app.post('/api/google-login', async (req, res) => {
    try {
        const { googleId, email, name, avatarUrl } = req.body;

        if (!googleId || !email) {
            return res.status(400).json({ error: 'Google ID and email are required' });
        }

        // Find or create user
        db.get('SELECT * FROM users WHERE google_id = ? OR email = ?', [googleId, email], async (err, user) => {
            if (err) {
                console.error('Google login error:', err);
                return res.status(500).json({ error: 'Errore server' });
            }

            let userData;
            
            if (!user) {
                // Create new Google user
                const userName = name || email.split('@')[0];
                db.run(
                    'INSERT INTO users (name, email, google_id, avatar_url, email_verified) VALUES (?, ?, ?, ?, 1)',
                    [userName, email, googleId, avatarUrl],
                    function(err) {
                        if (err) {
                            console.error('Error creating Google user:', err);
                            return res.status(500).json({ error: 'Errore creazione utente' });
                        }
                        
                        const newUser = {
                            id: this.lastID,
                            name: userName,
                            email: email,
                            avatar_url: avatarUrl
                        };
                        
                        const token = generateToken(newUser);
                        
                        res.json({
                            message: 'Google login successful',
                            user: newUser,
                            token
                        });
                    }
                );
            } else {
                // Update existing user with Google info if missing
                if (!user.google_id) {
                    db.run(
                        'UPDATE users SET google_id = ?, avatar_url = COALESCE(?, avatar_url), email_verified = 1 WHERE id = ?',
                        [googleId, avatarUrl, user.id]
                    );
                }
                
                // Update last login
                db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
                
                const token = generateToken(user);
                
                res.json({
                    message: 'Google login successful',
                    user: {
                        id: user.id,
                        name: user.name,
                        email: user.email,
                        avatar_url: user.avatar_url || avatarUrl
                    },
                    token
                });
            }
        });

    } catch (error) {
        console.error('Google login error:', error);
        res.status(500).json({ error: 'Errore durante il login Google' });
    }
});

// Get current user
app.get('/api/me', authenticateToken, (req, res) => {
    db.get('SELECT id, name, email, skills, created_at FROM users WHERE id = ?', [req.user.id], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'Utente non trovato' });
        }
        
        res.json({
            user: {
                ...user,
                skills: typeof user.skills === 'string' ? JSON.parse(user.skills || '[]') : (user.skills || [])
            }
        });
    });
});

// Update skills
app.put('/api/users/:userId/skills', authenticateToken, (req, res) => {
    const userId = parseInt(req.params.userId);
    const { skills } = req.body;
    
    if (req.user.id !== userId) {
        return res.status(403).json({ error: 'Accesso negato' });
    }
    
    if (!Array.isArray(skills)) {
        return res.status(400).json({ error: 'Skills deve essere un array' });
    }
    
    const sanitizedSkills = skills
        .map(s => s.trim().toLowerCase())
        .filter(s => s.length > 0 && s.length <= 30)
        .slice(0, 20);
    
    db.run(
        'UPDATE users SET skills = ? WHERE id = ?',
        [JSON.stringify(sanitizedSkills), userId],
        function(err) {
            if (err) {
                console.error('Error updating skills:', err);
                return res.status(500).json({ error: 'Errore aggiornamento skills' });
            }
            
            res.json({
                success: true,
                message: 'Competenze aggiornate',
                skills: sanitizedSkills
            });
        }
    );
});

// Get matches
app.get('/api/matches/:userId', authenticateToken, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const limit = parseInt(req.query.limit) || 10;
        
        if (req.user.id !== userId) {
            return res.status(403).json({ error: 'Accesso negato' });
        }
        
        console.log(`🔍 Finding matches for user ${userId}...`);
        const result = await getMatches(userId, limit);
        
        console.log(`✅ Found ${result.matches.length} matches`);
        res.json({ success: true, data: result });
        
    } catch (error) {
        console.error('Error fetching matches:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// 🔗 API CONNECTIONS (MATCH SYSTEM)
// ============================================

// Get user's connections
app.get('/api/connections', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    
    db.all(`
        SELECT 
            c.id as connection_id,
            u.id as user_id,
            u.name,
            u.email,
            u.avatar_url,
            u.public_key,
            c.created_at,
            (SELECT COUNT(*) FROM messages WHERE sender_id = u.id AND receiver_id = ? AND is_read = 0) as unread_count
        FROM connections c
        JOIN users u ON (u.id = c.user1_id OR u.id = c.user2_id) AND u.id != ?
        WHERE (c.user1_id = ? OR c.user2_id = ?) AND c.status = 'active'
        ORDER BY c.created_at DESC
    `, [userId, userId, userId, userId], (err, rows) => {
        if (err) {
            console.error('Error fetching connections:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
        
        // Parse skills and add online status
        const connections = rows.map(conn => ({
            ...conn,
            isOnline: connectedUsers.has(conn.user_id),
            skills: conn.skills ? JSON.parse(conn.skills) : []
        }));
        
        res.json({ success: true, connections });
    });
});

// ============================================
// 💬 API MESSAGES
// ============================================

// Get messages with a specific user
app.get('/api/messages/:userId', authenticateToken, async (req, res) => {
    const currentUserId = req.user.id;
    const otherUserId = parseInt(req.params.userId);
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    
    // Check connection exists
    const minId = Math.min(currentUserId, otherUserId);
    const maxId = Math.max(currentUserId, otherUserId);
    
    db.get(
        'SELECT * FROM connections WHERE user1_id = ? AND user2_id = ? AND status = ?',
        [minId, maxId, 'active'],
        (err, connection) => {
            if (err) {
                return res.status(500).json({ success: false, error: err.message });
            }
            
            if (!connection) {
                return res.status(403).json({ success: false, error: 'Non sei connesso con questo utente' });
            }
            
            // Get messages
            db.all(
                `SELECT m.*, u.name as sender_name 
                 FROM messages m
                 JOIN users u ON m.sender_id = u.id
                 WHERE (m.sender_id = ? AND m.receiver_id = ?) 
                    OR (m.sender_id = ? AND m.receiver_id = ?)
                 ORDER BY m.created_at ASC
                 LIMIT ? OFFSET ?`,
                [currentUserId, otherUserId, otherUserId, currentUserId, limit, offset],
                (err, messages) => {
                    if (err) {
                        return res.status(500).json({ success: false, error: err.message });
                    }
                    
                    res.json({ success: true, messages });
                    
                    // Mark messages as read asynchronously
                    db.run(
                        'UPDATE messages SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE sender_id = ? AND receiver_id = ? AND is_read = 0',
                        [otherUserId, currentUserId]
                    );
                }
            );
        }
    );
});

// Send message (HTTP fallback for Socket.io)
app.post('/api/messages', authenticateToken, async (req, res) => {
    const senderId = req.user.id;
    const { receiverId, encryptedContent } = req.body;
    
    if (!receiverId || !encryptedContent) {
        return res.status(400).json({ success: false, error: 'Dati messaggio non validi' });
    }
    
    // Check connection
    const minId = Math.min(senderId, receiverId);
    const maxId = Math.max(senderId, receiverId);
    
    db.get(
        'SELECT * FROM connections WHERE user1_id = ? AND user2_id = ? AND status = ?',
        [minId, maxId, 'active'],
        (err, connection) => {
            if (err) {
                return res.status(500).json({ success: false, error: err.message });
            }
            
            if (!connection) {
                return res.status(403).json({ success: false, error: 'Non sei connesso con questo utente' });
            }
            
            // Save message
            db.run(
                'INSERT INTO messages (sender_id, receiver_id, encrypted_content, encrypted) VALUES (?, ?, ?, ?)',
                [senderId, receiverId, encryptedContent, true],
                function(err) {
                    if (err) {
                        return res.status(500).json({ success: false, error: err.message });
                    }
                    
                    const messageData = {
                        id: this.lastID,
                        senderId: senderId,
                        receiverId: receiverId,
                        encryptedContent: encryptedContent,
                        createdAt: new Date().toISOString()
                    };
                    
                    // Emit via Socket.io if receiver is online
                    io.to(`user_${receiverId}`).emit('new_message', messageData);
                    
                    res.json({ success: true, messageId: this.lastID });
                }
            );
        }
    );
});

// ============================================
// 🔐 API PUBLIC KEYS (E2E ENCRYPTION)
// ============================================

// Save public key
app.post('/api/keys/public', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { publicKey } = req.body;
    
    if (!publicKey) {
        return res.status(400).json({ success: false, error: 'Public key required' });
    }
    
    db.run(
        'UPDATE users SET public_key = ? WHERE id = ?',
        [publicKey, userId],
        (err) => {
            if (err) {
                return res.status(500).json({ success: false, error: err.message });
            }
            res.json({ success: true, message: 'Public key saved' });
        }
    );
});

// Get public key for a user
app.get('/api/keys/public/:userId', authenticateToken, (req, res) => {
    const targetUserId = req.params.userId;
    const currentUserId = req.user.id;
    
    // Check if they are connected
    const minId = Math.min(currentUserId, targetUserId);
    const maxId = Math.max(currentUserId, targetUserId);
    
    db.get(
        'SELECT * FROM connections WHERE user1_id = ? AND user2_id = ? AND status = ?',
        [minId, maxId, 'active'],
        (err, connection) => {
            if (err) {
                return res.status(500).json({ success: false, error: err.message });
            }
            
            if (!connection) {
                return res.status(403).json({ success: false, error: 'Non sei connesso con questo utente' });
            }
            
            db.get(
                'SELECT public_key FROM users WHERE id = ?',
                [targetUserId],
                (err, row) => {
                    if (err) {
                        return res.status(500).json({ success: false, error: err.message });
                    }
                    
                    if (!row || !row.public_key) {
                        return res.status(404).json({ success: false, error: 'Public key not found' });
                    }
                    
                    res.json({ success: true, publicKey: row.public_key });
                }
            );
        }
    );
});

// ============================================
// 🔔 MATCH/CONNECTION REQUEST API
// ============================================

// Send match request (creates notification)
app.post('/api/match/request', authenticateToken, (req, res) => {
    const senderId = req.user.id;
    const { receiverId } = req.body;
    
    if (!receiverId || receiverId == senderId) {
        return res.status(400).json({ success: false, error: 'ID destinatario non valido' });
    }
    
    // Check if already connected
    const minId = Math.min(senderId, receiverId);
    const maxId = Math.max(senderId, receiverId);
    
    db.get(
        'SELECT * FROM connections WHERE user1_id = ? AND user2_id = ?',
        [minId, maxId],
        (err, existing) => {
            if (err) {
                return res.status(500).json({ success: false, error: err.message });
            }
            
            if (existing) {
                return res.status(409).json({ success: false, error: 'Match già esistente' });
            }
            
            // For SQLite, create connection immediately (simplified flow)
            db.run(
                'INSERT INTO connections (user1_id, user2_id, status) VALUES (?, ?, ?)',
                [minId, maxId, 'active'],
                function(err) {
                    if (err) {
                        return res.status(500).json({ success: false, error: err.message });
                    }
                    
                    // Notify receiver if online
                    io.to(`user_${receiverId}`).emit('new_connection', { userId: senderId });
                    
                    res.json({ success: true, message: 'Match creato!', connectionId: this.lastID });
                }
            );
        }
    );
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        database: 'SQLite (local)',
        websocket: 'Active',
        timestamp: new Date().toISOString()
    });
});

// Connected users tracking for online status
const connectedUsers = new Map(); // userId -> socketId
const userSockets = new Map(); // socketId -> userId
const typingUsers = new Map(); // userId -> {receiverId, timeout}

// Socket.io authentication middleware
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error('Authentication required'));
    }
    
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return next(new Error('Invalid token'));
        }
        socket.userId = user.id;
        socket.user = user;
        next();
    });
});

// Socket.io connection handling
io.on('connection', (socket) => {
    const userId = socket.userId;
    console.log(`🔌 User connected: ${userId} (socket: ${socket.id})`);
    
    // Track connected user
    connectedUsers.set(userId, socket.id);
    userSockets.set(socket.id, userId);
    
    // Notify others that user is online
    socket.broadcast.emit('user_online', { userId });
    
    // Send current online users to the connected user
    const onlineUserIds = Array.from(connectedUsers.keys()).filter(id => id !== userId);
    socket.emit('online_users', { users: onlineUserIds });
    
    // Join user's room for direct messages
    socket.join(`user_${userId}`);
    
    // Handle typing indicator
    socket.on('typing', ({ receiverId, isTyping }) => {
        if (isTyping) {
            // Clear existing timeout if any
            if (typingUsers.has(userId)) {
                clearTimeout(typingUsers.get(userId).timeout);
            }
            
            // Set new timeout to clear typing status after 3 seconds
            const timeout = setTimeout(() => {
                typingUsers.delete(userId);
                io.to(`user_${receiverId}`).emit('typing', { userId, isTyping: false });
            }, 3000);
            
            typingUsers.set(userId, { receiverId, timeout });
            io.to(`user_${receiverId}`).emit('typing', { userId, isTyping: true });
        } else {
            if (typingUsers.has(userId)) {
                clearTimeout(typingUsers.get(userId).timeout);
                typingUsers.delete(userId);
            }
            io.to(`user_${receiverId}`).emit('typing', { userId, isTyping: false });
        }
    });
    
    // Handle new message via socket
    socket.on('send_message', async (data, callback) => {
        try {
            const { receiverId, encryptedContent } = data;
            
            // Verify connection exists
            const connection = await getConnection(userId, receiverId);
            if (!connection) {
                return callback({ success: false, error: 'Non sei connesso con questo utente' });
            }
            
            // Save message to database
            const messageId = await saveMessage(userId, receiverId, encryptedContent);
            
            const messageData = {
                id: messageId,
                senderId: userId,
                receiverId: receiverId,
                encryptedContent: encryptedContent,
                createdAt: new Date().toISOString()
            };
            
            // Send to receiver if online
            io.to(`user_${receiverId}`).emit('new_message', messageData);
            
            // Confirm to sender
            callback({ success: true, messageId });
            
            console.log(`💬 Message sent: ${userId} → ${receiverId}`);
        } catch (error) {
            console.error('Error sending message via socket:', error);
            callback({ success: false, error: error.message });
        }
    });
    
    // Handle message read status
    socket.on('mark_read', async ({ senderId }) => {
        try {
            await markMessagesAsRead(senderId, userId);
            io.to(`user_${senderId}`).emit('messages_read', { by: userId });
        } catch (error) {
            console.error('Error marking messages as read:', error);
        }
    });
    
    // Handle disconnect
    socket.on('disconnect', () => {
        console.log(`🔌 User disconnected: ${userId} (socket: ${socket.id})`);
        connectedUsers.delete(userId);
        userSockets.delete(socket.id);
        
        // Clear typing status
        if (typingUsers.has(userId)) {
            clearTimeout(typingUsers.get(userId).timeout);
            typingUsers.delete(userId);
        }
        
        // Notify others that user is offline
        socket.broadcast.emit('user_offline', { userId });
    });
});

// Helper function to check connection
function getConnection(user1Id, user2Id) {
    return new Promise((resolve, reject) => {
        const minId = Math.min(user1Id, user2Id);
        const maxId = Math.max(user1Id, user2Id);
        
        db.get(
            'SELECT * FROM connections WHERE user1_id = ? AND user2_id = ? AND status = ?',
            [minId, maxId, 'active'],
            (err, row) => {
                if (err) reject(err);
                else resolve(row);
            }
        );
    });
}

// Helper function to save message
function saveMessage(senderId, receiverId, encryptedContent) {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO messages (sender_id, receiver_id, encrypted_content, encrypted) VALUES (?, ?, ?, ?)',
            [senderId, receiverId, encryptedContent, true],
            function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            }
        );
    });
}

// Helper function to mark messages as read
function markMessagesAsRead(senderId, receiverId) {
    return new Promise((resolve, reject) => {
        db.run(
            'UPDATE messages SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE sender_id = ? AND receiver_id = ? AND is_read = 0',
            [senderId, receiverId],
            function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            }
        );
    });
}

// Start server
async function startServer() {
    try {
        await initDatabase();
        
        // Initialize Google OAuth
        const googleAuthReady = initGoogleOAuth();
        
        server.listen(PORT, () => {
            console.log(`
🚀 Server SQLite avviato!
📡 Porta: ${PORT}
🔗 URL: http://localhost:${PORT}/api
📊 Database: SQLite locale (clonix_local.db)
💬 WebSocket: Active
🔐 E2E Encryption: Ready
🔑 Google OAuth: ${googleAuthReady ? 'Ready' : 'Not Configured'}

✅ Endpoints disponibili:
   POST /api/register
   POST /api/login
   GET  /api/me
   GET  /api/matches/:userId
   PUT  /api/users/:userId/skills
   GET  /api/health
   GET  /api/connections
   GET  /api/messages/:userId
   POST /api/messages
   POST /api/keys/public
   GET  /api/keys/public/:userId
   GET  /api/auth/google
   GET  /api/auth/google/callback
            `);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
