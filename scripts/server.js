const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const validator = require('validator');
const { OAuth2Client } = require('google-auth-library');
const axios = require('axios');
const multer = require('multer');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();

// Create HTTP server for Socket.io
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: ['http://localhost:8081', 'http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:5500', 'http://localhost:5500'],
        credentials: true,
        methods: ['GET', 'POST']
    }
});

// Middleware
app.use(helmet());
app.use(cors({
    origin: ['http://localhost:3001', 'http://localhost:8081', 'http://127.0.0.1:5500', 'http://localhost:5500', 'file://', '*'], // Allow all development origins
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // limit each IP to 500 requests per windowMs (aumentato per polling)
    message: { error: 'Too many requests, please try again later' }
});
app.use('/api/', limiter);

// Database connection pool for better stability with Aiven MySQL
let db;

async function initDatabase() {
    try {
        // Use connection pool for cloud database stability
        db = await mysql.createPool({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            ssl: {
                rejectUnauthorized: false // Allow self-signed certificates for development
            },
            // Pool settings for cloud database stability
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            enableKeepAlive: true,
            keepAliveInitialDelay: 10000 // 10 seconds
        });
        
        console.log('Connected to Aiven MySQL database (Pool mode)');
        
        // Create tables if they don't exist
        await createUsersTable();
        await createNotificationsTable();
        await createConnectionsTable();
        await createMessagesTable();
        await addSenderContentColumnIfMissing();
        await createProjectsTable();
        await createProjectVotesTable();
        
        // Setup error handler for pool
        db.on('error', async (err) => {
            console.error('Database pool error:', err.message);
            if (err.code === 'PROTOCOL_CONNECTION_LOST') {
                console.log('Database connection lost. Pool will reconnect automatically.');
            }
        });
        
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        console.log('⚠️  Server continuerà senza database. Alcune funzionalità non saranno disponibili.');
        // Non fare process.exit(1) - il server continua anche senza DB
    }
}

async function createUsersTable() {
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash VARCHAR(255),
            google_id VARCHAR(255) UNIQUE,
            avatar_url VARCHAR(500),
            nickname VARCHAR(80),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            last_login TIMESTAMP NULL,
            is_active BOOLEAN DEFAULT TRUE,
            email_verified BOOLEAN DEFAULT FALSE,
            onboarding_completed BOOLEAN DEFAULT TRUE,
            skills JSON,
            public_key TEXT,
            INDEX idx_email (email),
            INDEX idx_google_id (google_id),
            INDEX idx_skills ((CAST(skills AS CHAR(255) ARRAY)))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    
    try {
        await db.execute(createTableQuery);
        console.log('Users table ready');
        
        // Ensure skills column exists (for existing tables)
        await addSkillsColumnIfMissing();
        await addPublicKeyColumnIfMissing();
        await addUserProfileColumnsIfMissing();
        
    } catch (error) {
        console.error('Error creating users table:', error);
        throw error;
    }
}

async function addSkillsColumnIfMissing() {
    try {
        // Check if skills column exists
        const [columns] = await db.execute(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'users' 
            AND COLUMN_NAME = 'skills'
            AND TABLE_SCHEMA = DATABASE()
        `);
        
        if (columns.length === 0) {
            // Add skills column
            await db.execute('ALTER TABLE users ADD COLUMN skills JSON');
            console.log('✅ Added skills column to users table');
        } else {
            console.log('✅ Skills column already exists');
        }
    } catch (error) {
        console.error('Error checking/adding skills column:', error);
        // Non-fatal: continue even if this fails
    }
}

async function addPublicKeyColumnIfMissing() {
    try {
        const [columns] = await db.execute(`
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'users'
            AND COLUMN_NAME = 'public_key'
            AND TABLE_SCHEMA = DATABASE()
        `);

        if (columns.length === 0) {
            await db.execute('ALTER TABLE users ADD COLUMN public_key TEXT');
            console.log('✅ Added public_key column to users table');
        } else {
            console.log('✅ Public key column already exists');
        }
    } catch (error) {
        console.error('Error checking/adding public_key column:', error);
    }
}

async function addUserProfileColumnsIfMissing() {
    const columnsToEnsure = [
        { name: 'nickname', definition: 'VARCHAR(80) DEFAULT NULL' },
        { name: 'onboarding_completed', definition: 'BOOLEAN DEFAULT TRUE' }
    ];

    for (const column of columnsToEnsure) {
        try {
            const [columns] = await db.execute(`
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = 'users'
                AND COLUMN_NAME = ?
                AND TABLE_SCHEMA = DATABASE()
            `, [column.name]);

            if (columns.length === 0) {
                await db.execute(`ALTER TABLE users ADD COLUMN ${column.name} ${column.definition}`);
                console.log(`Added ${column.name} column to users table`);
            } else {
                console.log(`${column.name} column already exists`);
            }
        } catch (error) {
            console.error(`Error checking/adding ${column.name} column:`, error.message);
        }
    }
}

// JWT token generation
function generateToken(user) {
    return jwt.sign(
        { 
            id: user.id, 
            email: user.email, 
            name: user.name 
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
    );
}

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}

// Validation functions
function validateEmail(email) {
    return validator.isEmail(email);
}

function validatePassword(password) {
    return password && password.length >= 8;
}

function sanitizeNickname(nickname) {
    if (typeof nickname !== 'string') {
        return '';
    }

    return nickname.trim().replace(/\s+/g, '-').toLowerCase();
}

function validateNickname(nickname) {
    return /^[a-z0-9._-]{3,30}$/.test(nickname);
}

function serializeUser(user) {
    const onboardingCompleted = user.onboarding_completed === true
        || user.onboarding_completed === 1
        || user.onboarding_completed === '1';

    return {
        id: user.id,
        name: user.name,
        email: user.email,
        nickname: user.nickname || null,
        avatar_url: user.avatar_url || null,
        skills: parseSkills(user.skills),
        onboarding_completed: onboardingCompleted
    };
}

function getPublicDisplayName(user = {}) {
    return user.nickname || user.name || user.email || 'Utente';
}

async function getPublicUserIdentity(userId) {
    const [rows] = await db.execute(
        'SELECT id, name, email, nickname, avatar_url FROM users WHERE id = ?',
        [userId]
    );
    const user = rows[0] || {};

    return {
        sender_name: user.name || null,
        sender_email: user.email || null,
        sender_nickname: user.nickname || null,
        sender_avatar: user.avatar_url || null,
        sender_display_name: getPublicDisplayName(user)
    };
}

// API Routes

// Register
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // Validation
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        if (!validateEmail(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        if (!validatePassword(password)) {
            return res.status(400).json({ error: 'Password must be at least 8 characters long' });
        }

        // Check if user already exists
        const [existingUsers] = await db.execute(
            'SELECT id FROM users WHERE email = ? OR google_id = ?',
            [email, email]
        );

        if (existingUsers.length > 0) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        // Hash password
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Insert new user
        const [result] = await db.execute(
            'INSERT INTO users (name, email, password_hash, onboarding_completed) VALUES (?, ?, ?, FALSE)',
            [name.trim(), email, passwordHash]
        );

        // Get created user
        const [users] = await db.execute(
            'SELECT id, name, email, nickname, avatar_url, skills, onboarding_completed, created_at FROM users WHERE id = ?',
            [result.insertId]
        );

        const user = users[0];
        const token = generateToken(user);

        res.status(201).json({
            message: 'User registered successfully',
            user: serializeUser(user),
            token
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validation
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        if (!validateEmail(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        // Find user (including skills for matching system)
        const [users] = await db.execute(
            'SELECT id, name, email, password_hash, nickname, avatar_url, skills, onboarding_completed FROM users WHERE email = ? AND is_active = TRUE',
            [email]
        );

        if (users.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = users[0];

        // Check password
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Update last login
        await db.execute(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );

        // Generate token
        const token = generateToken(user);

        res.json({
            message: 'Login successful',
            user: serializeUser(user),
            token
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Google OAuth
app.post('/api/google-login', async (req, res) => {
    try {
        const { googleId, email, name, avatarUrl } = req.body;

        if (!googleId || !email) {
            return res.status(400).json({ error: 'Google ID and email are required' });
        }

        // Find or create user
        const [users] = await db.execute(
            'SELECT id, name, email, nickname, avatar_url, skills, onboarding_completed FROM users WHERE google_id = ? OR email = ?',
            [googleId, email]
        );

        let user;
        
        if (users.length === 0) {
            // Create new Google user
            const [result] = await db.execute(
                'INSERT INTO users (name, email, google_id, avatar_url, email_verified, onboarding_completed) VALUES (?, ?, ?, ?, TRUE, FALSE)',
                [name || email.split('@')[0], email, googleId, avatarUrl]
            );

            const [newUsers] = await db.execute(
                'SELECT id, name, email, nickname, avatar_url, skills, onboarding_completed FROM users WHERE id = ?',
                [result.insertId]
            );
            user = newUsers[0];
        } else {
            // Update existing user with Google info if missing
            user = users[0];
            if (!user.google_id) {
                await db.execute(
                    'UPDATE users SET google_id = ?, avatar_url = COALESCE(?, avatar_url), email_verified = TRUE WHERE id = ?',
                    [googleId, avatarUrl, user.id]
                );
            }
        }

        // Update last login
        await db.execute(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );

        const token = generateToken(user);

        res.json({
            message: 'Google login successful',
            user: serializeUser(user),
            token
        });

    } catch (error) {
        console.error('Google login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get current user
app.get('/api/me', authenticateToken, async (req, res) => {
    try {
        const [users] = await db.execute(
            'SELECT id, name, email, nickname, avatar_url, skills, onboarding_completed, created_at, last_login FROM users WHERE id = ? AND is_active = TRUE',
            [req.user.id]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = users[0];

        res.json({
            user: {
                ...serializeUser(user),
                created_at: user.created_at,
                last_login: user.last_login
            }
        });

    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Logout (client-side handles token removal)
app.post('/api/logout', authenticateToken, (req, res) => {
    res.json({ message: 'Logout successful' });
});

// Health check endpoint - useful for debugging
app.get('/api/health', async (req, res) => {
    try {
        // Check database connection
        await db.execute('SELECT 1');
        
        res.json({ 
            status: 'OK',
            database: 'connected',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            endpoints: ['/api/matches/:userId', '/api/users/:userId/skills', '/api/projects', '/api/projects/:id/vote']
        });
    } catch (error) {
        res.status(503).json({ 
            status: 'ERROR',
            database: 'disconnected',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Test endpoint for Spotlight
app.get('/api/projects/test', (req, res) => {
    res.json({
        success: true,
        message: 'Spotlight API is working',
        endpoints: [
            'GET /api/projects - List all projects',
            'POST /api/projects - Create project (requires auth)',
            'GET /api/projects/my - List my projects',
            'POST /api/projects/:id/vote - Vote for project'
        ],
        imageProcessing: sharpAvailable ? 'sharp (compressed)' : 'fs (original)'
    });
});

// Simple test endpoint for matching system (no auth required for testing)
app.get('/api/test-matches', async (req, res) => {
    res.json({
        success: true,
        message: 'Matching system is online',
        endpoints: [
            'GET /api/matches/:userId - Get matches (requires auth)',
            'GET /api/matches/quick/:userId - Quick matches (requires auth)',
            'PUT /api/users/:userId/skills - Update skills (requires auth)'
        ]
    });
});

// Google OAuth endpoints
let oauth2Client;

// Initialize Google OAuth safely
function initGoogleOAuth() {
    try {
        if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
            oauth2Client = new OAuth2Client(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET,
                process.env.GOOGLE_REDIRECT_URI
            );
            console.log('Google OAuth initialized successfully');
            return true;
        } else {
            console.log('Google OAuth credentials not found');
            return false;
        }
    } catch (error) {
        console.error('Error initializing Google OAuth:', error.message);
        return false;
    }
}

// Get Google auth URL
app.get('/api/auth/google', (req, res) => {
    if (!oauth2Client) {
        return res.json({ 
            error: 'Google OAuth not initialized',
            message: 'Please check your credentials in .env file'
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

// Google OAuth callback
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
        const [users] = await db.execute(
            'SELECT id, name, email, nickname, avatar_url, skills, onboarding_completed FROM users WHERE google_id = ? OR email = ?',
            [userInfo.id, userInfo.email]
        );
        
        let user;
        
        if (users.length === 0) {
            // Create new Google user
            const [result] = await db.execute(
                'INSERT INTO users (name, email, google_id, avatar_url, email_verified, onboarding_completed) VALUES (?, ?, ?, ?, TRUE, FALSE)',
                [userInfo.name, userInfo.email, userInfo.id, userInfo.picture]
            );
            
            const [newUsers] = await db.execute(
                'SELECT id, name, email, nickname, avatar_url, skills, onboarding_completed FROM users WHERE id = ?',
                [result.insertId]
            );
            user = newUsers[0];
        } else {
            // Update existing user with Google info if missing
            user = users[0];
            if (!user.google_id) {
                await db.execute(
                    'UPDATE users SET google_id = ?, avatar_url = COALESCE(?, avatar_url), email_verified = TRUE WHERE id = ?',
                    [userInfo.id, userInfo.picture, user.id]
                );
                user.avatar_url = userInfo.picture || user.avatar_url;
            }
        }
        
        // Update last login
        await db.execute(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );
        
        // Generate JWT token
        const token = generateToken(user);
        const redirectUser = serializeUser(user);
        
        // Redirect to frontend with token and user data
        const redirectUrl = `http://localhost:8081/auth-success.html?token=${token}&user=${encodeURIComponent(JSON.stringify(redirectUser))}`;
        res.redirect(redirectUrl);
        
    } catch (error) {
        console.error('Google OAuth callback error:', error);
        res.redirect('http://localhost:8081/auth.html?error=google_auth_failed');
    }
});

// ============================================
// 🎯 SISTEMA DI MATCHING INTELLIGENTE
// ============================================

// Pesi dei tag per priorità (opzionale - se un tag non è presente vale 1)
const TAG_WEIGHTS = {
    'startup': 2,      // Startup vale di più
    'founder': 2,      // Founder vale di più
    'investor': 2,     // Investor vale di più
    'ai': 1.5,         // AI ha peso maggiore
    'machine-learning': 1.5,
    'coding': 1,       // Standard
    'design': 1,
    'marketing': 1
};

const DEFAULT_TAG_WEIGHT = 1;
const POINTS_PER_MATCH = 3;

/**
 * Calcola il match score tra due utenti
 * @param {Object} userA - Utente corrente { id, name, skills: [] }
 * @param {Object} userB - Utente da confrontare { id, name, skills: [] }
 * @returns {Object} - { score, percentage, commonTags, totalPossible }
 */
function matchScore(userA, userB) {
    // Parse skills in modo sicuro anche se il DB contiene valori vecchi o malformati
    const skillsA = parseSkills(userA.skills);
    const skillsB = parseSkills(userB.skills);
    
    // Normalizza a lowercase per confronto case-insensitive
    const normalizedA = skillsA.map(s => s.toLowerCase().trim());
    const normalizedB = skillsB.map(s => s.toLowerCase().trim());
    
    // Trova tag in comune con pesi
    const commonTags = [];
    let weightedScore = 0;
    
    normalizedA.forEach((tag, index) => {
        if (normalizedB.includes(tag)) {
            const originalTag = skillsA[index]; // Mantieni case originale
            commonTags.push(originalTag);
            
            // Applica peso se definito
            const weight = TAG_WEIGHTS[tag] || DEFAULT_TAG_WEIGHT;
            weightedScore += POINTS_PER_MATCH * weight;
        }
    });
    
    // Calcola punteggio massimo possibile (utente con più tag)
    const maxTags = Math.max(skillsA.length, skillsB.length);
    const maxPossibleScore = maxTags * POINTS_PER_MATCH * 2; // 2 = max peso possibile
    
    // Calcola percentuale (0-100)
    // Formula: (match con pesi / max possibile) * 100
    const percentage = maxPossibleScore > 0 
        ? Math.round((weightedScore / maxPossibleScore) * 100)
        : 0;
    
    // Limita a 100% max
    const finalPercentage = Math.min(percentage, 100);
    
    return {
        score: Math.round(weightedScore),
        percentage: finalPercentage,
        commonTags: commonTags,
        totalPossible: maxPossibleScore,
        userASkills: skillsA.length,
        userBSkills: skillsB.length
    };
}

/**
 * Parse skills in modo sicuro - supporta JSON array o CSV string
 * @param {string} skillsString - Skills dal database
 * @returns {Array} - Array di skills
 */
function parseSkills(skillsString) {
    if (!skillsString || skillsString === '[]' || skillsString === '') {
        return [];
    }
    
    // Se è già un array (non dovrebbe succedere ma per sicurezza)
    if (Array.isArray(skillsString)) {
        return sanitizeSkills(skillsString);
    }

    if (typeof skillsString !== 'string') {
        return [];
    }
    
    // Prova a fare parse come JSON
    try {
        const parsed = JSON.parse(skillsString);
        if (Array.isArray(parsed)) {
            return sanitizeSkills(parsed);
        }
        if (parsed == null) {
            return [];
        }
        return sanitizeSkills([parsed.toString()]);
    } catch (e) {
        // Non è JSON, tratta come CSV o stringa semplice
        if (skillsString.includes(',')) {
            return sanitizeSkills(skillsString.split(','));
        }
        return sanitizeSkills([skillsString]);
    }
}

function sanitizeSkills(skills) {
    if (!Array.isArray(skills)) {
        return null;
    }

    const uniqueSkills = new Set();

    skills.forEach(skill => {
        if (typeof skill !== 'string') return;

        const normalized = skill.trim().toLowerCase();
        if (normalized.length > 0 && normalized.length <= 30) {
            uniqueSkills.add(normalized);
        }
    });

    return Array.from(uniqueSkills).slice(0, 20);
}

function normalizePositiveInt(value, fallback, max = 100) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return fallback;
    }
    return Math.min(parsed, max);
}

function normalizeOffset(value, fallback = 0, max = 1000) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return fallback;
    }
    return Math.min(parsed, max);
}

function sanitizeProjectTags(tags) {
    if (!Array.isArray(tags)) {
        return [];
    }

    const uniqueTags = new Set();

    tags.forEach(tag => {
        if (typeof tag !== 'string') return;

        const normalized = tag.trim().toLowerCase();
        if (normalized.length > 0 && normalized.length <= 24) {
            uniqueTags.add(normalized);
        }
    });

    return Array.from(uniqueTags).slice(0, 8);
}

function parseProjectTags(tags) {
    if (!tags) {
        return [];
    }

    if (Array.isArray(tags)) {
        return sanitizeProjectTags(tags);
    }

    if (typeof tags !== 'string') {
        return [];
    }

    try {
        const parsed = JSON.parse(tags);
        return sanitizeProjectTags(Array.isArray(parsed) ? parsed : []);
    } catch (error) {
        return sanitizeProjectTags(tags.split(','));
    }
}

/**
 * Trova i migliori match per un utente dal database
 * @param {number} currentUserId - ID dell'utente corrente
 * @param {number} limit - Numero massimo di risultati (default: 10)
 * @returns {Array} - Lista di match ordinati per compatibilità
 */
async function getMatches(currentUserId, limit = 10) {
    try {
        // Assicuriamoci che l'ID sia un numero
        currentUserId = parseInt(currentUserId);
        
        // 1. Recupera l'utente corrente
        const [currentUserRows] = await db.execute(
            'SELECT id, name, email, nickname, avatar_url, skills FROM users WHERE id = ?',
            [currentUserId]
        );
        
        if (currentUserRows.length === 0) {
            throw new Error('Utente non trovato');
        }
        
        const currentUser = currentUserRows[0];
        // Parse skills dell'utente corrente
        currentUser.skills = parseSkills(currentUser.skills);
        
        // Se l'utente non ha skills, ritorna array vuoto
        if (!currentUser.skills || currentUser.skills.length === 0) {
            return {
                user: currentUser,
                matches: [],
                message: 'Aggiungi competenze al tuo profilo per trovare match'
            };
        }
        
        // 2. Recupera tutti gli altri utenti (con skills non vuote) - ESCLUDI l'utente corrente
        const [otherUsersRows] = await db.execute(
            'SELECT id, name, email, nickname, avatar_url, skills, created_at FROM users WHERE id != ? AND skills IS NOT NULL AND JSON_LENGTH(skills) > 0',
            [currentUserId]
        );
        console.log(`🔍 getMatches: Trovati ${otherUsersRows.length} altri utenti (escluso id=${currentUserId})`);
        
        // 3. Parse skills degli altri utenti e calcola match score
        const matches = otherUsersRows.map(otherUser => {
            otherUser.skills = parseSkills(otherUser.skills);
            const matchResult = matchScore(currentUser, otherUser);
            
            return {
                user: {
                    id: otherUser.id,
                    name: otherUser.name,
                    nickname: otherUser.nickname,
                    displayName: otherUser.nickname || otherUser.name,
                    email: otherUser.email,
                    avatar_url: otherUser.avatar_url,
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
        
        // 4. Filtra solo match con almeno 1 tag in comune (opzionale: rimuovi per vedere tutti)
        const filteredMatches = matches.filter(m => m.compatibility.commonTagsCount > 0);
        
        // 5. Ordina per percentuale decrescente
        filteredMatches.sort((a, b) => b.compatibility.percentage - a.compatibility.percentage);
        
        // 6. Limita ai top N risultati
        const topMatches = filteredMatches.slice(0, limit);
        
        return {
            user: {
                id: currentUser.id,
                name: currentUser.name,
                nickname: currentUser.nickname,
                displayName: currentUser.nickname || currentUser.name,
                avatar_url: currentUser.avatar_url,
                skills: currentUser.skills || []
            },
            totalMatches: otherUsersRows.length,
            filteredMatches: filteredMatches.length,
            matches: topMatches
        };
        
    } catch (error) {
        console.error('Error in getMatches:', error);
        throw error;
    }
}

// ============================================
// 🚀 API ENDPOINT - MATCHING SYSTEM
// ============================================

/**
 * GET /api/matches/:userId
 * Restituisce i migliori match per un utente
 * 
 * Risposta JSON:
 * {
 *   success: true,
 *   data: {
 *     user: { id, name, skills },
 *     totalMatches: 50,
 *     filteredMatches: 15,
 *     matches: [
 *       {
 *         user: { id, name, email, totalSkills, memberSince },
 *         compatibility: {
 *           percentage: 85,
 *           score: 12,
 *           commonTags: ["coding", "startup"],
 *           commonTagsCount: 2
 *         }
 *       }
 *     ]
 *   }
 * }
 */
app.get('/api/matches/:userId', authenticateToken, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const limit = normalizePositiveInt(req.query.limit, 10, 50);
        
        // Verifica che l'utente richieda i propri match o sia admin
        if (req.user.id !== userId && req.user.email !== 'admin@clonix.com') {
            return res.status(403).json({
                success: false,
                error: 'Accesso negato: puoi vedere solo i tuoi match'
            });
        }
        
        console.log(`🔍 Finding matches for user ${userId}...`);
        const result = await getMatches(userId, limit);
        
        console.log(`✅ Found ${result.matches.length} matches for user ${userId}`);
        
        res.json({
            success: true,
            data: result
        });
        
    } catch (error) {
        console.error('Error fetching matches:', error);
        res.status(500).json({
            success: false,
            error: 'Errore nel calcolo dei match',
            message: error.message
        });
    }
});

/**
 * GET /api/matches/quick/:userId
 * Versione light - solo top 5 match con dati essenziali
 */
app.get('/api/matches/quick/:userId', authenticateToken, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        
        if (req.user.id !== userId) {
            return res.status(403).json({ success: false, error: 'Accesso negato' });
        }
        
        const result = await getMatches(userId, 5);
        
        // Semplifica la risposta
        const quickMatches = result.matches.map(m => ({
            id: m.user.id,
            name: m.user.name,
            nickname: m.user.nickname,
            displayName: m.user.displayName,
            avatar_url: m.user.avatar_url,
            percentage: m.compatibility.percentage,
            commonTags: m.compatibility.commonTags
        }));
        
        res.json({
            success: true,
            matches: quickMatches
        });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// 📝 ENDPOINT - AGGIORNA SKILLS UTENTE
// ============================================

/**
 * PUT /api/users/:userId/skills
 * Aggiorna le competenze dell'utente nel database
 * Body: { skills: ["coding", "startup", "ai"] }
 */
app.put('/api/users/:userId/skills', authenticateToken, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const { skills } = req.body;
        
        // Verifica permessi
        if (req.user.id !== userId && req.user.email !== 'admin@clonix.com') {
            return res.status(403).json({
                success: false,
                error: 'Accesso negato: puoi modificare solo le tue competenze'
            });
        }
        
        // Valida input
        if (!Array.isArray(skills)) {
            return res.status(400).json({
                success: false,
                error: 'Skills deve essere un array'
            });
        }
        
        // Sanitizza, deduplica e limita
        const sanitizedSkills = sanitizeSkills(skills);
        if (!sanitizedSkills) {
            return res.status(400).json({
                success: false,
                error: 'Skills deve essere un array'
            });
        }
        
        // Salva nel database
        const [result] = await db.execute(
            'UPDATE users SET skills = ? WHERE id = ?',
            [JSON.stringify(sanitizedSkills), userId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Utente non trovato'
            });
        }
        
        console.log(`✅ Skills aggiornate per utente ${userId}:`, sanitizedSkills);
        
        res.json({
            success: true,
            message: 'Competenze aggiornate con successo',
            skills: sanitizedSkills
        });
        
    } catch (error) {
        console.error('Error updating skills:', error);
        res.status(500).json({
            success: false,
            error: 'Errore durante l\'aggiornamento delle competenze'
        });
    }
});

/**
 * GET /api/users/:userId/skills
 * Recupera le competenze dell'utente
 */
app.get('/api/users/:userId/skills', authenticateToken, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        
        const [rows] = await db.execute(
            'SELECT skills FROM users WHERE id = ?',
            [userId]
        );
        
        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Utente non trovato'
            });
        }
        
        const skills = parseSkills(rows[0].skills);
        
        res.json({
            success: true,
            skills: skills
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/users/:userId
 * Recupera il profilo completo dell'utente
 */
app.get('/api/users/:userId', authenticateToken, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        
        // Verifica permessi
        if (req.user.id !== userId && req.user.email !== 'admin@clonix.com') {
            return res.status(403).json({
                success: false,
                error: 'Accesso negato'
            });
        }
        
        const [rows] = await db.execute(
            'SELECT id, name, email, nickname, avatar_url, skills, onboarding_completed, created_at FROM users WHERE id = ?',
            [userId]
        );
        
        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Utente non trovato'
            });
        }
        
        const user = rows[0];
        
        res.json({
            success: true,
            user: {
                ...serializeUser(user),
                created_at: user.created_at
            }
        });
        
    } catch (error) {
        console.error('❌ Error fetching user profile:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * PUT /api/users/:userId/profile
 * Aggiorna il profilo utente (nome, email)
 */
app.put('/api/users/:userId/profile', authenticateToken, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const { name, email } = req.body;
        
        // Verifica permessi
        if (req.user.id !== userId && req.user.email !== 'admin@clonix.com') {
            return res.status(403).json({
                success: false,
                error: 'Accesso negato: puoi modificare solo il tuo profilo'
            });
        }
        
        // Aggiorna solo i campi forniti
        const updates = [];
        const params = [];
        
        if (name && name.trim()) {
            if (name.trim().length > 255) {
                return res.status(400).json({
                    success: false,
                    error: 'Il nome deve essere massimo 255 caratteri'
                });
            }

            updates.push('name = ?');
            params.push(name.trim());
        }
        
        if (email && email.trim()) {
            if (!validateEmail(email.trim())) {
                return res.status(400).json({
                    success: false,
                    error: 'Email non valida'
                });
            }

            updates.push('email = ?');
            params.push(email.trim());
        }
        
        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Nessun dato da aggiornare'
            });
        }
        
        params.push(userId);
        
        await db.execute(
            `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
            params
        );
        
        console.log(`✅ Profilo aggiornato per utente ${userId}`);
        
        res.json({
            success: true,
            message: 'Profilo aggiornato con successo'
        });
        
    } catch (error) {
        console.error('❌ Error updating profile:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// 🔔 SISTEMA NOTIFICHE E CHAT
// ============================================

// Crea tabella notifiche
async function createNotificationsTable() {
    const query = `
        CREATE TABLE IF NOT EXISTS notifications (
            id INT AUTO_INCREMENT PRIMARY KEY,
            sender_id INT NOT NULL,
            receiver_id INT NOT NULL,
            type ENUM('match_request', 'match_accepted', 'match_rejected', 'message', 'spotlight_vote') DEFAULT 'match_request',
            status ENUM('pending', 'accepted', 'rejected', 'read') DEFAULT 'pending',
            message TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_receiver (receiver_id),
            INDEX idx_sender (sender_id),
            INDEX idx_status (status),
            FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    try {
        await db.execute(query);
        console.log('✅ Notifications table ready');
    } catch (error) {
        console.error('❌ Error creating notifications table:', error.message);
    }
}

// Crea tabella connessioni (match accettati)
async function createConnectionsTable() {
    const query = `
        CREATE TABLE IF NOT EXISTS connections (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user1_id INT NOT NULL,
            user2_id INT NOT NULL,
            status ENUM('active', 'blocked') DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_user1 (user1_id),
            INDEX idx_user2 (user2_id),
            INDEX idx_connection (user1_id, user2_id),
            FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    try {
        await db.execute(query);
        console.log('✅ Connections table ready');
    } catch (error) {
        console.error('❌ Error creating connections table:', error.message);
    }
}

// Crea tabella messaggi (con struttura per E2E)
async function createMessagesTable() {
    const query = `
        CREATE TABLE IF NOT EXISTS messages (
            id INT AUTO_INCREMENT PRIMARY KEY,
            sender_id INT NOT NULL,
            receiver_id INT NOT NULL,
            content TEXT NOT NULL,
            sender_content TEXT DEFAULT NULL,
            encrypted BOOLEAN DEFAULT FALSE,
            encryption_type VARCHAR(50) DEFAULT NULL,
            is_read BOOLEAN DEFAULT FALSE,
            read_at TIMESTAMP NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_sender (sender_id),
            INDEX idx_receiver (receiver_id),
            INDEX idx_conversation (sender_id, receiver_id, created_at),
            FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    try {
        await db.execute(query);
        console.log('✅ Messages table ready (E2E-ready structure)');
    } catch (error) {
        console.error('❌ Error creating messages table:', error.message);
    }
}

// ============================================
// 🎯 TABELLE SPOTLIGHT (PROJECTS SHOWCASE)
// ============================================

async function addSenderContentColumnIfMissing() {
    try {
        await db.execute(`
            ALTER TABLE messages
            ADD COLUMN sender_content TEXT DEFAULT NULL AFTER content
        `);
        console.log('Messages sender_content column added');
    } catch (error) {
        if (error.code === 'ER_DUP_FIELDNAME') {
            console.log('Messages sender_content column already exists');
        } else {
            console.error('Error adding sender_content column:', error.message);
        }
    }
}

// Crea tabella projects
async function createProjectsTable() {
    const query = `
        CREATE TABLE IF NOT EXISTS projects (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            title VARCHAR(100) NOT NULL,
            description VARCHAR(120) NOT NULL,
            image_url VARCHAR(500) NOT NULL,
            link VARCHAR(500) DEFAULT NULL,
            tags JSON DEFAULT NULL,
            interested_count INT DEFAULT 0,
            collaborate_count INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_user_id (user_id),
            INDEX idx_created_at (created_at),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    try {
        await db.execute(query);
        console.log('✅ Projects table ready (Spotlight)');
    } catch (error) {
        console.error('❌ Error creating projects table:', error.message);
    }
}

// Crea tabella project_votes
async function createProjectVotesTable() {
    const query = `
        CREATE TABLE IF NOT EXISTS project_votes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            project_id INT NOT NULL,
            user_id INT NOT NULL,
            type ENUM('interested', 'collaborate') NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_vote (project_id, user_id),
            INDEX idx_project_id (project_id),
            INDEX idx_user_id (user_id),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    try {
        await db.execute(query);
        console.log('✅ Project votes table ready (Spotlight)');
    } catch (error) {
        console.error('❌ Error creating project_votes table:', error.message);
    }
}

// ============================================
// API NOTIFICHE
// ============================================

// 🔵 POST /api/match/request - Invia richiesta match
app.post('/api/match/request', authenticateToken, async (req, res) => {
    try {
        const senderId = parseInt(req.user.id);
        const { receiverId } = req.body;
        
        console.log(`🔔 POST /api/match/request - senderId: ${senderId}, receiverId: ${receiverId}`);
        
        if (!receiverId || parseInt(receiverId) === senderId) {
            console.log('❌ ID destinatario non valido');
            return res.status(400).json({
                success: false,
                error: 'ID destinatario non valido'
            });
        }
        
        const targetId = parseInt(receiverId);
        
        // 1. Verifica che esista l'utente destinazione
        const [targetUser] = await db.execute(
            'SELECT id FROM users WHERE id = ? AND is_active = TRUE',
            [targetId]
        );
        
        if (targetUser.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Utente non trovato'
            });
        }
        
        // 2. Verifica che non esista già una connessione attiva
        const minId = Math.min(senderId, targetId);
        const maxId = Math.max(senderId, targetId);
        
        const [existingConnection] = await db.execute(
            'SELECT id FROM connections WHERE user1_id = ? AND user2_id = ? AND status = ?',
            [minId, maxId, 'active']
        );
        
        if (existingConnection.length > 0) {
            console.log('❌ Connessione già esistente');
            return res.status(409).json({
                success: false,
                error: 'Sei già connesso con questo utente',
                code: 'ALREADY_CONNECTED'
            });
        }
        
        // 3. Verifica richiesta già inviata da sender a receiver (pendente)
        const [existingSent] = await db.execute(
            `SELECT id, status FROM notifications 
             WHERE sender_id = ? AND receiver_id = ? AND type = 'match_request' AND status = 'pending'`,
            [senderId, targetId]
        );
        
        if (existingSent.length > 0) {
            console.log('❌ Richiesta già inviata da te, in attesa di risposta');
            return res.status(409).json({
                success: false,
                error: 'Hai già inviato una richiesta a questo utente',
                code: 'REQUEST_ALREADY_SENT'
            });
        }
        
        // 4. Verifica se c'è una richiesta pendente DAL receiver A TE (bidirezionale)
        const [existingReceived] = await db.execute(
            `SELECT id FROM notifications 
             WHERE sender_id = ? AND receiver_id = ? AND type = 'match_request' AND status = 'pending'`,
            [targetId, senderId]
        );
        
        if (existingReceived.length > 0) {
            console.log('✅ Richiesta reciproca trovata - creo connessione automatica');
            // Auto-accetta: crea connessione e aggiorna entrambe le notifiche
            
            await db.execute(
                'INSERT INTO connections (user1_id, user2_id, status) VALUES (?, ?, ?)',
                [minId, maxId, 'active']
            );
            
            // Marca la richiesta dell'altro come accettata
            await db.execute(
                `UPDATE notifications SET status = 'accepted' WHERE id = ?`,
                [existingReceived[0].id]
            );
            
            // Crea notifica per il sender originale
            await db.execute(
                `INSERT INTO notifications (sender_id, receiver_id, type, status, message) 
                 VALUES (?, ?, 'match_accepted', 'accepted', ?)`,
                [senderId, targetId, 'Hanno accettato la tua richiesta!']
            );
            
            return res.json({
                success: true,
                message: 'Match reciproco! Connessione creata automaticamente',
                autoConnected: true
            });
        }
        
        // 5. Crea nuova richiesta
        const [result] = await db.execute(
            `INSERT INTO notifications (sender_id, receiver_id, type, status, message) 
             VALUES (?, ?, 'match_request', 'pending', ?)`,
            [senderId, targetId, 'Vuole connettersi con te!']
        );
        
        console.log(`✅ Match request CREATA: ID=${result.insertId}, ${senderId} → ${targetId}`);
        
        res.json({
            success: true,
            message: 'Richiesta inviata',
            notificationId: result.insertId,
            code: 'REQUEST_SENT'
        });
        
    } catch (error) {
        console.error('❌ Error sending match request:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 🔵 GET /api/notifications - Ottieni notifiche utente
app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const userId = parseInt(req.user.id);
        const status = req.query.status;
        const limitNum = normalizePositiveInt(req.query.limit, 20, 100);
        
        console.log(`🔔 GET /api/notifications - userId: ${userId}, status: ${status || 'ALL'}, limit: ${limitNum}`);
        
        // Se status è specificato, filtra per stato, altrimenti carica tutte
        let query;
        let params;
        
        if (status) {
            query = `
                SELECT n.*,
                        u.name as sender_name, u.nickname as sender_nickname, u.email as sender_email, u.avatar_url as sender_avatar
                 FROM notifications n
                 JOIN users u ON n.sender_id = u.id
                 WHERE n.receiver_id = ? AND n.status = ?
                 ORDER BY n.created_at DESC
                 LIMIT ${limitNum}
            `;
            params = [userId, status];
        } else {
            query = `
                SELECT n.*,
                        u.name as sender_name, u.nickname as sender_nickname, u.email as sender_email, u.avatar_url as sender_avatar
                 FROM notifications n
                 JOIN users u ON n.sender_id = u.id
                 WHERE n.receiver_id = ?
                 ORDER BY n.created_at DESC
                 LIMIT ${limitNum}
            `;
            params = [userId];
        }
        
        const [notifications] = await db.execute(query, params);
        
        console.log(`🔔 Trovate ${notifications.length} notifiche per userId=${userId}`);
        
        // Conta notifiche non lette
        const [count] = await db.execute(
            `SELECT COUNT(*) as unread FROM notifications WHERE receiver_id = ? AND status = 'pending'`,
            [userId]
        );
        
        res.json({
            success: true,
            notifications: notifications,
            unreadCount: count[0].unread
        });
        
    } catch (error) {
        console.error('❌ Error fetching notifications:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 🔵 GET /api/notifications/sent - Ottieni notifiche inviate dall'utente
app.get('/api/notifications/sent', authenticateToken, async (req, res) => {
    try {
        const userId = parseInt(req.user.id);
        const limit = normalizePositiveInt(req.query.limit, 20, 100);
        
        console.log(`🔔 GET /api/notifications/sent - userId: ${userId}, limit: ${limit}`);
        
        const [notifications] = await db.execute(
            `SELECT n.*,
                    u.name as receiver_name, u.nickname as receiver_nickname, u.email as receiver_email, u.avatar_url as receiver_avatar
             FROM notifications n
             JOIN users u ON n.receiver_id = u.id
             WHERE n.sender_id = ?
             ORDER BY n.created_at DESC
             LIMIT ${limit}`,
            [userId]
        );
        
        res.json({
            success: true,
            notifications: notifications,
            totalSent: notifications.length
        });
        
    } catch (error) {
        console.error('❌ Error fetching sent notifications:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 🔵 POST /api/match/respond - Rispondi a richiesta match
app.post('/api/match/respond', authenticateToken, async (req, res) => {
    try {
        const userId = parseInt(req.user.id);
        const { notificationId, response } = req.body;
        
        console.log(`🔔 POST /api/match/respond - userId: ${userId}, notificationId: ${notificationId}, response: ${response}`);
        
        if (!['accepted', 'rejected'].includes(response)) {
            return res.status(400).json({
                success: false,
                error: 'Risposta non valida (accepted o rejected)'
            });
        }
        
        if (!notificationId) {
            return res.status(400).json({
                success: false,
                error: 'notificationId richiesto'
            });
        }
        
        // Verifica che la notifica esista, sia destinata all'utente e sia pendente
        const [notification] = await db.execute(
            `SELECT * FROM notifications WHERE id = ? AND receiver_id = ? AND type = 'match_request'`,
            [notificationId, userId]
        );
        
        if (notification.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Richiesta non trovata o non autorizzato'
            });
        }
        
        const requestData = notification[0];
        
        // Verifica che non sia già stata gestita
        if (requestData.status !== 'pending') {
            return res.status(409).json({
                success: false,
                error: `Richiesta già ${requestData.status === 'accepted' ? 'accettata' : 'rifiutata'}`,
                code: 'ALREADY_RESPONDED',
                currentStatus: requestData.status
            });
        }
        
        const senderId = requestData.sender_id;
        const minId = Math.min(senderId, userId);
        const maxId = Math.max(senderId, userId);
        
        // Aggiorna status notifica
        await db.execute(
            `UPDATE notifications SET status = ?, updated_at = NOW() WHERE id = ?`,
            [response, notificationId]
        );
        
        if (response === 'accepted') {
            // Verifica che non esista già una connessione (race condition)
            const [existingConn] = await db.execute(
                'SELECT id FROM connections WHERE user1_id = ? AND user2_id = ?',
                [minId, maxId]
            );
            
            if (existingConn.length === 0) {
                // Crea connessione
                await db.execute(
                    'INSERT INTO connections (user1_id, user2_id, status) VALUES (?, ?, ?)',
                    [minId, maxId, 'active']
                );
                console.log(`✅ Connessione creata: ${minId} ↔ ${maxId}`);
            }
            
            // Notifica il sender
            await db.execute(
                `INSERT INTO notifications (sender_id, receiver_id, type, status, message, created_at) 
                 VALUES (?, ?, 'match_accepted', 'read', ?, NOW())`,
                [userId, senderId, 'Ha accettato la tua richiesta di connessione!']
            );
            
            res.json({
                success: true,
                message: 'Match accettato! Ora siete connessi',
                connected: true,
                connectionId: existingConn[0]?.id || null
            });
        } else {
            res.json({
                success: true,
                message: 'Richiesta rifiutata',
                connected: false
            });
        }
        
    } catch (error) {
        console.error('❌ Error responding to match request:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 🔵 GET /api/connections - Ottieni i miei match/connessioni
app.get('/api/connections', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        
        const [connections] = await db.execute(
            `SELECT c.*, 
                    u.id as other_user_id, u.name, u.nickname, u.email, u.avatar_url, u.skills,
                    (SELECT COUNT(*) FROM messages WHERE sender_id = u.id AND receiver_id = ? AND is_read = 0) as unread_count
             FROM connections c
             JOIN users u ON (u.id = c.user1_id OR u.id = c.user2_id) AND u.id != ?
             WHERE (c.user1_id = ? OR c.user2_id = ?) AND c.status = 'active'`,
            [userId, userId, userId, userId]
        );
        
        // Parse skills e aggiungi isOnline per ogni connessione
        const parsedConnections = connections.map(conn => ({
            ...conn,
            user_id: conn.other_user_id,
            displayName: conn.nickname || conn.name,
            isOnline: connectedUsers.has(conn.other_user_id),
            skills: parseSkills(conn.skills)
        }));
        
        res.json({
            success: true,
            connections: parsedConnections
        });
        
    } catch (error) {
        console.error('❌ Error fetching connections:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 🔵 GET /api/connections/count - Ottieni solo il numero totale di match
app.get('/api/connections/count', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        
        const [result] = await db.execute(
            `SELECT COUNT(*) as total FROM connections 
             WHERE (user1_id = ? OR user2_id = ?) AND status = 'active'`,
            [userId, userId]
        );
        
        res.json({
            success: true,
            total: result[0].total
        });
        
    } catch (error) {
        console.error('❌ Error counting connections:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// API CHAT
// ============================================

// 🔵 GET /api/messages/:userId - Ottieni messaggi con un utente
app.get('/api/messages/:userId', authenticateToken, async (req, res) => {
    try {
        const currentUserId = req.user.id;
        const otherUserId = parseInt(req.params.userId);
        const { limit = 50, offset = 0 } = req.query;

        if (!Number.isInteger(otherUserId) || otherUserId < 1) {
            return res.status(400).json({
                success: false,
                error: 'ID utente non valido'
            });
        }
        
        // Verifica che esista una connessione (normalizza ID come nel DB: user1_id < user2_id)
        const minUserId = Math.min(currentUserId, otherUserId);
        const maxUserId = Math.max(currentUserId, otherUserId);
        const [connection] = await db.execute(
            `SELECT id, status FROM connections 
             WHERE user1_id = ? AND user2_id = ? AND status = 'active'`,
            [minUserId, maxUserId]
        );
        
        if (connection.length === 0) {
            return res.status(403).json({
                success: false,
                error: 'Non sei connesso con questo utente'
            });
        }
        
        // Recupera messaggi (LIMIT e OFFSET come numeri, non parametri)
        const limitNum = normalizePositiveInt(limit, 50, 100);
        const offsetNum = normalizeOffset(offset);
        const [messages] = await db.execute(
            `SELECT m.*,
                    CASE
                        WHEN m.encrypted = TRUE AND m.sender_id = ? AND m.sender_content IS NOT NULL THEN m.sender_content
                        ELSE m.content
                    END as encrypted_content,
                    u.name as sender_name, u.nickname as sender_nickname, u.avatar_url as sender_avatar
             FROM messages m
             JOIN users u ON m.sender_id = u.id
             WHERE (m.sender_id = ? AND m.receiver_id = ?) 
                OR (m.sender_id = ? AND m.receiver_id = ?)
             ORDER BY m.created_at ASC
             LIMIT ${limitNum} OFFSET ${offsetNum}`,
            [currentUserId, currentUserId, otherUserId, otherUserId, currentUserId]
        );
        
        // Mark messages as read
        await db.execute(
            `UPDATE messages SET is_read = TRUE, read_at = NOW() 
             WHERE sender_id = ? AND receiver_id = ? AND is_read = FALSE`,
            [otherUserId, currentUserId]
        );
        
        res.json({
            success: true,
            messages: messages
        });
        
    } catch (error) {
        console.error('❌ Error fetching messages:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 🔵 POST /api/messages - Invia messaggio (HTTP fallback per E2E)
app.post('/api/messages', authenticateToken, async (req, res) => {
    try {
        const senderId = req.user.id;
        const { content, encryptedContent } = req.body;
        const senderEncryptedContent = typeof req.body.senderEncryptedContent === 'string'
            ? req.body.senderEncryptedContent.trim()
            : null;
        const receiverId = parseInt(req.body.receiverId);
        const messageContentInput = encryptedContent || content;

        if (!Number.isInteger(receiverId) || receiverId < 1 || typeof messageContentInput !== 'string' || !messageContentInput.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Dati messaggio non validi'
            });
        }

        if (messageContentInput.length > 5000) {
            return res.status(400).json({
                success: false,
                error: 'Messaggio troppo lungo'
            });
        }
        
        // Verifica connessione
        const minId = Math.min(senderId, receiverId);
        const maxId = Math.max(senderId, receiverId);
        
        const [connection] = await db.execute(
            'SELECT id FROM connections WHERE user1_id = ? AND user2_id = ? AND status = ?',
            [minId, maxId, 'active']
        );
        
        if (connection.length === 0) {
            return res.status(403).json({
                success: false,
                error: 'Non sei connesso con questo utente'
            });
        }
        
        // Supporto E2E: se encryptedContent è presente, lo usiamo
        const messageContent = messageContentInput.trim();
        const isEncrypted = !!encryptedContent;
        
        const [result] = await db.execute(
            `INSERT INTO messages (sender_id, receiver_id, content, sender_content, encrypted, encryption_type)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [senderId, receiverId, messageContent, senderEncryptedContent, isEncrypted, isEncrypted ? 'E2E' : null]
        );
        
        const senderIdentity = await getPublicUserIdentity(senderId);

        // Emetti evento WebSocket al receiver E al sender
        const messageData = {
            id: result.insertId,
            senderId: senderId,
            receiverId: receiverId,
            encryptedContent: encryptedContent,
            content: isEncrypted ? null : content,
            createdAt: new Date().toISOString(),
            ...senderIdentity
        };
        io.to(`user_${receiverId}`).emit('new_message', messageData);
        io.to(`user_${senderId}`).emit('new_message', messageData); // Mittente vede il proprio messaggio
        
        console.log(`💬 Message: ${senderId} → ${receiverId} (E2E: ${isEncrypted})`);
        
        res.json({
            success: true,
            messageId: result.insertId,
            message: 'Messaggio inviato'
        });
        
    } catch (error) {
        console.error('❌ Error sending message:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 🔐 API PUBLIC KEYS (E2E ENCRYPTION)
// ============================================

// Save public key
app.post('/api/keys/public', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { publicKey } = req.body;
        
        if (!publicKey) {
            return res.status(400).json({ success: false, error: 'Public key required' });
        }
        
        await db.execute(
            'UPDATE users SET public_key = ? WHERE id = ?',
            [publicKey, userId]
        );
        
        res.json({ success: true, message: 'Public key saved' });
    } catch (error) {
        console.error('Error saving public key:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get public key for a user
app.get('/api/keys/public/:userId', authenticateToken, async (req, res) => {
    try {
        const targetUserId = req.params.userId;
        const currentUserId = req.user.id;
        
        // Check if they are connected
        const minId = Math.min(currentUserId, targetUserId);
        const maxId = Math.max(currentUserId, targetUserId);
        
        const [connection] = await db.execute(
            'SELECT * FROM connections WHERE user1_id = ? AND user2_id = ? AND status = ?',
            [minId, maxId, 'active']
        );
        
        if (connection.length === 0) {
            return res.status(403).json({ success: false, error: 'Non sei connesso con questo utente' });
        }
        
        const [rows] = await db.execute(
            'SELECT public_key FROM users WHERE id = ?',
            [targetUserId]
        );
        
        if (rows.length === 0 || !rows[0].public_key) {
            return res.status(404).json({ success: false, error: 'Public key not found' });
        }
        
        res.json({ success: true, publicKey: rows[0].public_key });
    } catch (error) {
        console.error('Error fetching public key:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// 🎯 API SPOTLIGHT (PROJECTS SHOWCASE)
// ============================================

// Configurazione upload immagini
const uploadsDir = path.join(__dirname, '..', 'uploads', 'projects');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const avatarUploadsDir = path.join(__dirname, '..', 'uploads', 'avatars');
if (!fs.existsSync(avatarUploadsDir)) {
    fs.mkdirSync(avatarUploadsDir, { recursive: true });
}

// Verifica che sharp sia disponibile (può fallire su Windows se non installato correttamente)
let sharpAvailable = false;
try {
    require('sharp');
    sharpAvailable = true;
    console.log('✅ Sharp image processing available');
} catch (err) {
    console.warn('⚠️  Sharp not available, image compression disabled:', err.message);
}

// Multer configuration per upload temporaneo
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Tipo file non supportato. Usa JPEG, PNG, WEBP o GIF'), false);
        }
    }
});

async function saveProfilePhoto(file) {
    if (!file) {
        return null;
    }

    const filename = `${uuidv4()}.webp`;
    const filepath = path.join(avatarUploadsDir, filename);

    if (sharpAvailable) {
        const sharp = require('sharp');
        await sharp(file.buffer)
            .resize(480, 480, { fit: 'cover' })
            .webp({ quality: 86, effort: 4 })
            .toFile(filepath);
    } else {
        const ext = file.mimetype.split('/')[1] || 'jpg';
        const fallbackFilename = `${uuidv4()}.${ext}`;
        const fallbackPath = path.join(avatarUploadsDir, fallbackFilename);
        fs.writeFileSync(fallbackPath, file.buffer);
        return `/uploads/avatars/${fallbackFilename}`;
    }

    return `/uploads/avatars/${filename}`;
}

// POST /api/onboarding - Completa la configurazione iniziale del profilo
app.post('/api/onboarding', authenticateToken, upload.single('profilePhoto'), async (req, res) => {
    try {
        const userId = req.user.id;
        const cleanName = typeof req.body.name === 'string' ? req.body.name.trim() : '';
        const nickname = sanitizeNickname(req.body.nickname);
        const skills = parseSkills(req.body.skills);

        if (!cleanName || cleanName.length > 255) {
            return res.status(400).json({
                success: false,
                error: 'Nome obbligatorio e massimo 255 caratteri'
            });
        }

        if (!validateNickname(nickname)) {
            return res.status(400).json({
                success: false,
                error: 'Nickname non valido: usa 3-30 caratteri, lettere, numeri, punto, trattino o underscore'
            });
        }

        if (!skills.length) {
            return res.status(400).json({
                success: false,
                error: 'Aggiungi almeno una competenza'
            });
        }

        const avatarUrl = await saveProfilePhoto(req.file);
        const updates = [
            'name = ?',
            'nickname = ?',
            'skills = ?',
            'onboarding_completed = TRUE'
        ];
        const params = [cleanName, nickname, JSON.stringify(skills)];

        if (avatarUrl) {
            updates.push('avatar_url = ?');
            params.push(avatarUrl);
        }

        params.push(userId);

        await db.execute(
            `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        const [users] = await db.execute(
            'SELECT id, name, email, nickname, avatar_url, skills, onboarding_completed FROM users WHERE id = ?',
            [userId]
        );

        res.json({
            success: true,
            message: 'Configurazione completata',
            user: serializeUser(users[0])
        });
    } catch (error) {
        console.error('Error completing onboarding:', error);
        res.status(500).json({
            success: false,
            error: 'Errore durante il salvataggio della configurazione'
        });
    }
});

// POST /api/projects - Crea nuovo progetto
app.post('/api/projects', authenticateToken, upload.single('image'), async (req, res) => {
    try {
        const userId = req.user.id;
        const { title, description, link, tags } = req.body;
        const cleanTitle = typeof title === 'string' ? title.trim() : '';
        const cleanDescription = typeof description === 'string' ? description.trim() : '';
        const cleanLink = typeof link === 'string' ? link.trim() : '';
        
        // Validazione
        if (!cleanTitle || !cleanDescription) {
            return res.status(400).json({
                success: false,
                error: 'Titolo e descrizione sono obbligatori'
            });
        }
        
        if (cleanTitle.length > 100) {
            return res.status(400).json({
                success: false,
                error: 'Il titolo deve essere massimo 100 caratteri'
            });
        }
        
        if (cleanDescription.length > 120) {
            return res.status(400).json({
                success: false,
                error: 'La descrizione deve essere massimo 120 caratteri'
            });
        }

        if (cleanLink) {
            try {
                const parsedLink = new URL(cleanLink);
                if (!['http:', 'https:'].includes(parsedLink.protocol)) {
                    throw new Error('Protocollo non valido');
                }
            } catch (error) {
                return res.status(400).json({
                    success: false,
                    error: 'Link progetto non valido'
                });
            }
        }
        
        // Verifica limite 3 progetti per utente
        const [existingProjects] = await db.execute(
            'SELECT COUNT(*) as count FROM projects WHERE user_id = ?',
            [userId]
        );
        
        if (existingProjects[0].count >= 3) {
            return res.status(403).json({
                success: false,
                error: 'Hai raggiunto il limite massimo di 3 progetti. Elimina un progetto esistente per crearne uno nuovo.'
            });
        }
        
        let imageUrl = null;
        
        // Processa e comprimi immagine se presente
        if (req.file) {
            try {
                let filename, filepath;
                
                if (sharpAvailable) {
                    // Usa sharp per comprimere
                    const sharp = require('sharp');
                    filename = `${uuidv4()}.webp`;
                    filepath = path.join(uploadsDir, filename);
                    
                    await sharp(req.file.buffer)
                        .resize(800, 600, { fit: 'inside', withoutEnlargement: true })
                        .webp({ quality: 85, effort: 4 })
                        .toFile(filepath);
                    
                    imageUrl = `/uploads/projects/${filename}`;
                    console.log(`✅ Immagine compressa e salvata: ${filename}`);
                } else {
                    // Fallback: salva l'immagine originale senza compressione
                    const ext = req.file.mimetype.split('/')[1] || 'jpg';
                    filename = `${uuidv4()}.${ext}`;
                    filepath = path.join(uploadsDir, filename);
                    
                    fs.writeFileSync(filepath, req.file.buffer);
                    
                    imageUrl = `/uploads/projects/${filename}`;
                    console.log(`✅ Immagine salvata (no compression): ${filename}`);
                }
            } catch (imgError) {
                console.error('❌ Errore salvataggio immagine:', imgError);
                return res.status(500).json({
                    success: false,
                    error: 'Errore durante l\'elaborazione dell\'immagine'
                });
            }
        } else {
            // Immagine placeholder di default
            imageUrl = '/assets/project-placeholder.svg';
        }
        
        const parsedTags = parseProjectTags(tags);
        
        // Inserisci progetto
        const [result] = await db.execute(
            `INSERT INTO projects (user_id, title, description, image_url, link, tags) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, cleanTitle, cleanDescription, imageUrl, cleanLink || null, JSON.stringify(parsedTags)]
        );
        
        console.log(`✅ Progetto creato: ID=${result.insertId}, User=${userId}`);
        
        res.status(201).json({
            success: true,
            message: 'Progetto creato con successo',
            project: {
                id: result.insertId,
                user_id: userId,
                title: cleanTitle,
                description: cleanDescription,
                image_url: imageUrl,
                link: cleanLink || null,
                tags: parsedTags,
                interested_count: 0,
                collaborate_count: 0,
                created_at: new Date()
            }
        });
        
    } catch (error) {
        console.error('❌ Error creating project:', error);
        res.status(500).json({
            success: false,
            error: 'Errore durante la creazione del progetto'
        });
    }
});

// GET /api/projects - Lista progetti
app.get('/api/projects', authenticateToken, async (req, res) => {
    try {
        const { sort = 'recent', limit = 20, offset = 0 } = req.query;
        const userId = parseInt(req.user.id);
        const limitNum = normalizePositiveInt(limit, 20, 100);
        const offsetNum = normalizeOffset(offset);
        
        console.log(`📊 GET /api/projects - userId: ${userId}, sort: ${sort}, limit: ${limitNum}, offset: ${offsetNum}`);
        
        let query, params;
        
        if (sort === 'popular') {
            // Ordina per popolarità
            query = `SELECT p.*, 
                    u.name as author_name, u.nickname as author_nickname, COALESCE(u.nickname, u.name) as author_display_name, u.avatar_url as author_avatar,
                    pv.type as user_vote
             FROM projects p
             JOIN users u ON p.user_id = u.id
             LEFT JOIN project_votes pv ON p.id = pv.project_id AND pv.user_id = ?
             ORDER BY (p.interested_count + p.collaborate_count) DESC, p.created_at DESC
             LIMIT ${limitNum} OFFSET ${offsetNum}`;
            params = [userId];
        } else {
            // Ordina per data (default)
            query = `SELECT p.*, 
                    u.name as author_name, u.nickname as author_nickname, COALESCE(u.nickname, u.name) as author_display_name, u.avatar_url as author_avatar,
                    pv.type as user_vote
             FROM projects p
             JOIN users u ON p.user_id = u.id
             LEFT JOIN project_votes pv ON p.id = pv.project_id AND pv.user_id = ?
             ORDER BY p.created_at DESC
             LIMIT ${limitNum} OFFSET ${offsetNum}`;
            params = [userId];
        }
        
        console.log('📊 Query:', query.substring(0, 100) + '...');
        console.log('📊 Params:', params);
        
        const [projects] = await db.execute(query, params);
        
        console.log(`📊 Trovati ${projects.length} progetti`);
        
        // Parse tags per ogni progetto
        const parsedProjects = projects.map(p => {
            let parsedTags = [];
            if (p.tags) {
                try {
                    parsedTags = JSON.parse(p.tags);
                    if (!Array.isArray(parsedTags)) parsedTags = [];
                } catch (e) {
                    console.warn(`⚠️  Tag malformati per progetto ${p.id}:`, p.tags);
                    parsedTags = [];
                }
            }
            return {
                ...p,
                tags: parseProjectTags(p.tags)
            };
        });
        
        res.json({
            success: true,
            projects: parsedProjects,
            total: parsedProjects.length
        });
        
    } catch (error) {
        console.error('❌ Error fetching projects:', error);
        res.status(500).json({
            success: false,
            error: 'Errore durante il recupero dei progetti: ' + error.message
        });
    }
});

// GET /api/projects/my - Progetti dell'utente corrente
app.get('/api/projects/my', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        
        const [projects] = await db.execute(
            `SELECT p.*, 
                    u.name as author_name, u.nickname as author_nickname, COALESCE(u.nickname, u.name) as author_display_name, u.avatar_url as author_avatar
             FROM projects p
             JOIN users u ON p.user_id = u.id
             WHERE p.user_id = ?
             ORDER BY p.created_at DESC`,
            [userId]
        );
        
        const parsedProjects = projects.map(p => ({
            ...p,
            tags: parseProjectTags(p.tags)
        }));
        
        res.json({
            success: true,
            projects: parsedProjects
        });
        
    } catch (error) {
        console.error('❌ Error fetching user projects:', error);
        res.status(500).json({
            success: false,
            error: 'Errore durante il recupero dei tuoi progetti'
        });
    }
});

// POST /api/projects/:id/vote - Vota un progetto
app.post('/api/projects/:id/vote', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const projectId = parseInt(req.params.id);
        const { type } = req.body; // 'interested' o 'collaborate'

        if (!Number.isInteger(projectId) || projectId < 1) {
            return res.status(400).json({
                success: false,
                error: 'ID progetto non valido'
            });
        }
        
        if (!['interested', 'collaborate'].includes(type)) {
            return res.status(400).json({
                success: false,
                error: 'Tipo voto non valido (interested o collaborate)'
            });
        }
        
        // Verifica che il progetto esista
        const [project] = await db.execute(
            'SELECT * FROM projects WHERE id = ?',
            [projectId]
        );
        
        if (project.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Progetto non trovato'
            });
        }
        
        // Non permettere voti sul proprio progetto
        if (project[0].user_id === userId) {
            return res.status(403).json({
                success: false,
                error: 'Non puoi votare il tuo stesso progetto'
            });
        }
        
        // Verifica se esiste già un voto
        const [existingVote] = await db.execute(
            'SELECT * FROM project_votes WHERE project_id = ? AND user_id = ?',
            [projectId, userId]
        );
        
        if (existingVote.length > 0) {
            // Se il voto è dello stesso tipo, rimuovilo (toggle)
            if (existingVote[0].type === type) {
                await db.execute(
                    'DELETE FROM project_votes WHERE id = ?',
                    [existingVote[0].id]
                );
                
                // Decrementa contatore
                await db.execute(
                    `UPDATE projects SET ${type}_count = GREATEST(${type}_count - 1, 0) WHERE id = ?`,
                    [projectId]
                );
                
                return res.json({
                    success: true,
                    message: 'Voto rimosso',
                    action: 'removed'
                });
            } else {
                // Cambia tipo di voto
                await db.execute(
                    'UPDATE project_votes SET type = ? WHERE id = ?',
                    [type, existingVote[0].id]
                );
                
                // Aggiorna contatori
                const oldType = existingVote[0].type;
                await db.execute(
                    `UPDATE projects SET ${oldType}_count = GREATEST(${oldType}_count - 1, 0), ${type}_count = ${type}_count + 1 WHERE id = ?`,
                    [projectId]
                );
                
                return res.json({
                    success: true,
                    message: 'Voto aggiornato',
                    action: 'changed'
                });
            }
        }
        
        // Inserisci nuovo voto
        await db.execute(
            'INSERT INTO project_votes (project_id, user_id, type) VALUES (?, ?, ?)',
            [projectId, userId, type]
        );
        
        // Incrementa contatore
        await db.execute(
            `UPDATE projects SET ${type}_count = ${type}_count + 1 WHERE id = ?`,
            [projectId]
        );
        
        // 🔔 Invia notifica al proprietario del progetto
        const voterName = req.user.name || 'Qualcuno';
        const projectTitle = project[0].title;
        const ownerId = project[0].user_id;
        
        if (ownerId !== userId) {
            await db.execute(
                `INSERT INTO notifications (sender_id, receiver_id, type, message, status, created_at) 
                 VALUES (?, ?, 'spotlight_vote', ?, 'pending', NOW())`,
                [userId, ownerId, `${voterName} ha votato "${projectTitle}" (${type === 'interested' ? '👍 Interessato' : '🤝 Vuole collaborare'})`]
            );
            console.log(`🔔 Notifica inviata a ${ownerId}: voto su progetto ${projectId}`);
        }
        
        res.json({
            success: true,
            message: 'Voto registrato',
            action: 'added'
        });
        
    } catch (error) {
        console.error('❌ Error voting project:', error);
        res.status(500).json({
            success: false,
            error: 'Errore durante la votazione'
        });
    }
});

// DELETE /api/projects/:id - Elimina progetto (solo proprietario)
app.delete('/api/projects/:id', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const projectId = parseInt(req.params.id);
        
        // Verifica proprietà progetto
        const [project] = await db.execute(
            'SELECT * FROM projects WHERE id = ? AND user_id = ?',
            [projectId, userId]
        );
        
        if (project.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Progetto non trovato o non sei il proprietario'
            });
        }
        
        // Elimina immagine se esiste
        if (project[0].image_url && !project[0].image_url.includes('placeholder')) {
            const projectRoot = path.resolve(__dirname, '..');
            const safeRelativePath = project[0].image_url.replace(/^[/\\]+/, '');
            const imagePath = path.resolve(projectRoot, safeRelativePath);

            if (imagePath.startsWith(projectRoot) && fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
        }
        
        // Elimina progetto (cascade eliminerà anche i voti)
        await db.execute('DELETE FROM projects WHERE id = ?', [projectId]);
        
        res.json({
            success: true,
            message: 'Progetto eliminato con successo'
        });
        
    } catch (error) {
        console.error('❌ Error deleting project:', error);
        res.status(500).json({
            success: false,
            error: 'Errore durante l\'eliminazione del progetto'
        });
    }
});

// 🔴 ADMIN ENDPOINT - Resetta tutte le connessioni e i match
// ⚠️ Pericoloso: elimina TUTTI i collegamenti tra utenti
app.post('/api/admin/reset-connections', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Verifica admin (puoi modificare questa logica)
        // Per semplicità, consentiamo a chiunque sia autenticato (in produzione usa admin check)
        console.log(`🚨 ADMIN REQUEST: User ${userId} sta resettando tutte le connessioni`);
        
        // 1. Conta quante connessioni esistono
        const [connectionsCount] = await db.execute('SELECT COUNT(*) as count FROM connections');
        const [notificationsCount] = await db.execute(
            "SELECT COUNT(*) as count FROM notifications WHERE type IN ('match_request', 'match_accepted', 'match_rejected')"
        );
        const [messagesCount] = await db.execute('SELECT COUNT(*) as count FROM messages');
        
        // 2. Elimina tutte le connessioni
        await db.execute('DELETE FROM connections');
        
        // 3. Elimina tutte le notifiche di match
        await db.execute(
            "DELETE FROM notifications WHERE type IN ('match_request', 'match_accepted', 'match_rejected')"
        );
        
        // 4. Elimina tutti i messaggi (opzionale - commenta se vuoi mantenere)
        await db.execute('DELETE FROM messages');
        
        // 5. Resetta le chiavi pubbliche E2E (opzionale)
        await db.execute('UPDATE users SET public_key = NULL');
        
        console.log(`✅ RESET COMPLETATO da user ${userId}:`);
        console.log(`   - Connessioni eliminate: ${connectionsCount[0].count}`);
        console.log(`   - Notifiche eliminate: ${notificationsCount[0].count}`);
        console.log(`   - Messaggi eliminati: ${messagesCount[0].count}`);
        
        res.json({
            success: true,
            message: 'Tutte le connessioni e i match sono stati resettati',
            deleted: {
                connections: connectionsCount[0].count,
                notifications: notificationsCount[0].count,
                messages: messagesCount[0].count
            },
            note: 'Tutti gli utenti dovranno creare nuove connessioni'
        });
        
    } catch (error) {
        console.error('❌ Error resetting connections:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Servi file statici dalla cartella uploads
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ============================================
// 💬 WEBSOCKET CHAT SYSTEM
// ============================================

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
            const receiverId = parseInt(data.receiverId);
            const encryptedContent = typeof data.encryptedContent === 'string' ? data.encryptedContent.trim() : '';
            const senderEncryptedContent = typeof data.senderEncryptedContent === 'string'
                ? data.senderEncryptedContent.trim()
                : null;

            if (!Number.isInteger(receiverId) || receiverId < 1 || !encryptedContent || encryptedContent.length > 5000) {
                return callback({ success: false, error: 'Dati messaggio non validi' });
            }
            
            // Verify connection exists
            const minId = Math.min(userId, receiverId);
            const maxId = Math.max(userId, receiverId);
            
            const [connection] = await db.execute(
                'SELECT id FROM connections WHERE user1_id = ? AND user2_id = ? AND status = ?',
                [minId, maxId, 'active']
            );
            
            if (connection.length === 0) {
                return callback({ success: false, error: 'Non sei connesso con questo utente' });
            }
            
            // Save message to database (E2E encrypted)
            const [result] = await db.execute(
                'INSERT INTO messages (sender_id, receiver_id, content, sender_content, encrypted, encryption_type) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, receiverId, encryptedContent, senderEncryptedContent, true, 'E2E']
            );

            const senderIdentity = await getPublicUserIdentity(userId);
            
            const messageData = {
                id: result.insertId,
                senderId: userId,
                receiverId: receiverId,
                encryptedContent: encryptedContent,
                createdAt: new Date().toISOString(),
                ...senderIdentity
            };
            
            // Send to receiver AND sender
            io.to(`user_${receiverId}`).emit('new_message', messageData);
            io.to(`user_${userId}`).emit('new_message', messageData); // Mittente vede il proprio messaggio
            
            // Confirm to sender
            callback({ success: true, messageId: result.insertId });
            
            console.log(`💬 Message sent: ${userId} → ${receiverId}`);
        } catch (error) {
            console.error('Error sending message via socket:', error);
            callback({ success: false, error: error.message });
        }
    });
    
    // Handle message read status
    socket.on('mark_read', async ({ senderId }) => {
        try {
            await db.execute(
                'UPDATE messages SET is_read = TRUE, read_at = NOW() WHERE sender_id = ? AND receiver_id = ? AND is_read = FALSE',
                [senderId, userId]
            );
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

// ============================================
// Validate required environment variables
function validateEnv() {
    const required = ['JWT_SECRET', 'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        console.error('❌ ERROR: Missing required environment variables:');
        missing.forEach(key => console.error(`   - ${key}`));
        console.error('\nPlease check your .env file and ensure all required variables are set.');
        process.exit(1);
    }
    
    // Validate JWT_SECRET length (minimum 32 characters for security)
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
        console.warn('⚠️  WARNING: JWT_SECRET should be at least 32 characters long for security');
    }
    
    console.log('✅ Environment variables validated');
}

// Start server
const PORT = process.env.PORT || 3000;

async function startServer() {
    // Validate env first
    validateEnv();
    
    await initDatabase();
    
    // Initialize Google OAuth
    initGoogleOAuth();
    
    server.listen(PORT, () => {
        console.log(`✅ Server running on port ${PORT}`);
        console.log(`📍 API endpoints available at http://localhost:${PORT}/api/`);
        console.log(`🔍 Health check: http://localhost:${PORT}/api/health`);
        console.log(`💡 Spotlight test: http://localhost:${PORT}/api/projects/test`);
        console.log(`💬 WebSocket Chat: Active`);
        console.log(`🔐 E2E Encryption: Ready`);
        console.log('');
        console.log('📋 Registered endpoints:');
        console.log('  - POST /api/projects (create project)');
        console.log('  - GET  /api/projects (list projects)');
        console.log('  - GET  /api/projects/my (my projects)');
        console.log('  - POST /api/projects/:id/vote (vote project)');
        console.log('  - DELETE /api/projects/:id (delete project)');
        console.log('  - GET  /api/connections (my connections)');
        console.log('  - GET  /api/messages/:userId (chat history)');
        console.log('  - POST /api/messages (send message)');
    });
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    if (db) {
        await db.end();
        console.log('Database connection closed');
    }
    process.exit(0);
});

startServer().catch(console.error);
