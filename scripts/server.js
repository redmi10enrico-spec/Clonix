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
require('dotenv').config({ path: '../.env' });

const app = express();

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
    max: 100, // limit each IP to 100 requests per windowMs
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
        
        // Setup error handler for pool
        db.on('error', async (err) => {
            console.error('Database pool error:', err.message);
            if (err.code === 'PROTOCOL_CONNECTION_LOST') {
                console.log('Database connection lost. Pool will reconnect automatically.');
            }
        });
        
    } catch (error) {
        console.error('Database connection failed:', error);
        process.exit(1);
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            last_login TIMESTAMP NULL,
            is_active BOOLEAN DEFAULT TRUE,
            email_verified BOOLEAN DEFAULT FALSE,
            skills JSON,
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
            'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
            [name, email, passwordHash]
        );

        // Get created user
        const [users] = await db.execute(
            'SELECT id, name, email, avatar_url, created_at FROM users WHERE id = ?',
            [result.insertId]
        );

        const user = users[0];
        const token = generateToken(user);

        res.status(201).json({
            message: 'User registered successfully',
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                avatar_url: user.avatar_url
            },
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
            'SELECT id, name, email, password_hash, avatar_url, skills FROM users WHERE email = ? AND is_active = TRUE',
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
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                avatar_url: user.avatar_url,
                skills: user.skills ? JSON.parse(user.skills) : []
            },
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
            'SELECT id, name, email, avatar_url FROM users WHERE google_id = ? OR email = ?',
            [googleId, email]
        );

        let user;
        
        if (users.length === 0) {
            // Create new Google user
            const [result] = await db.execute(
                'INSERT INTO users (name, email, google_id, avatar_url, email_verified) VALUES (?, ?, ?, ?, TRUE)',
                [name || email.split('@')[0], email, googleId, avatarUrl]
            );

            const [newUsers] = await db.execute(
                'SELECT id, name, email, avatar_url FROM users WHERE id = ?',
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
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                avatar_url: user.avatar_url
            },
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
            'SELECT id, name, email, avatar_url, created_at, last_login FROM users WHERE id = ? AND is_active = TRUE',
            [req.user.id]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            user: users[0]
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
            endpoints: ['/api/matches/:userId', '/api/users/:userId/skills']
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
            'SELECT id, name, email, avatar_url FROM users WHERE google_id = ? OR email = ?',
            [userInfo.id, userInfo.email]
        );
        
        let user;
        
        if (users.length === 0) {
            // Create new Google user
            const [result] = await db.execute(
                'INSERT INTO users (name, email, google_id, avatar_url, email_verified) VALUES (?, ?, ?, ?, TRUE)',
                [userInfo.name, userInfo.email, userInfo.id, userInfo.picture]
            );
            
            const [newUsers] = await db.execute(
                'SELECT id, name, email, avatar_url FROM users WHERE id = ?',
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
        
        // Redirect to frontend with token and user data
        const redirectUrl = `http://localhost:8081/auth-success.html?token=${token}&user=${encodeURIComponent(JSON.stringify(user))}`;
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
    // Parse skills se sono stringhe JSON
    const skillsA = Array.isArray(userA.skills) ? userA.skills : JSON.parse(userA.skills || '[]');
    const skillsB = Array.isArray(userB.skills) ? userB.skills : JSON.parse(userB.skills || '[]');
    
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
 * Trova i migliori match per un utente dal database
 * @param {number} currentUserId - ID dell'utente corrente
 * @param {number} limit - Numero massimo di risultati (default: 10)
 * @returns {Array} - Lista di match ordinati per compatibilità
 */
async function getMatches(currentUserId, limit = 10) {
    try {
        // 1. Recupera l'utente corrente
        const [currentUserRows] = await db.execute(
            'SELECT id, name, email, skills FROM users WHERE id = ?',
            [currentUserId]
        );
        
        if (currentUserRows.length === 0) {
            throw new Error('Utente non trovato');
        }
        
        const currentUser = currentUserRows[0];
        
        // Se l'utente non ha skills, ritorna array vuoto
        if (!currentUser.skills || currentUser.skills === '[]') {
            return {
                user: currentUser,
                matches: [],
                message: 'Aggiungi competenze al tuo profilo per trovare match'
            };
        }
        
        // 2. Recupera tutti gli altri utenti (con skills non vuote)
        const [otherUsersRows] = await db.execute(
            'SELECT id, name, email, skills, created_at FROM users WHERE id != ? AND skills IS NOT NULL AND JSON_LENGTH(skills) > 0',
            [currentUserId]
        );
        
        // 3. Calcola match score per ogni utente
        const matches = otherUsersRows.map(otherUser => {
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
                skills: Array.isArray(currentUser.skills) 
                    ? currentUser.skills 
                    : JSON.parse(currentUser.skills || '[]')
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
        const limit = parseInt(req.query.limit) || 10;
        
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
        
        // Sanitizza e limita
        const sanitizedSkills = skills
            .map(s => s.trim().toLowerCase())
            .filter(s => s.length > 0 && s.length <= 30)
            .slice(0, 20); // Max 20 skills
        
        // Salva nel database
        await db.execute(
            'UPDATE users SET skills = ? WHERE id = ?',
            [JSON.stringify(sanitizedSkills), userId]
        );
        
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
        
        const skills = rows[0].skills ? JSON.parse(rows[0].skills) : [];
        
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
            type ENUM('match_request', 'match_accepted', 'match_rejected', 'message') DEFAULT 'match_request',
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
// API NOTIFICHE
// ============================================

// 🔵 POST /api/match/request - Invia richiesta match
app.post('/api/match/request', authenticateToken, async (req, res) => {
    try {
        const senderId = req.user.id;
        const { receiverId } = req.body;
        
        console.log(`🔔 POST /api/match/request - senderId: ${senderId}, receiverId: ${receiverId}`);
        
        if (!receiverId || receiverId === senderId) {
            console.log('❌ ID destinatario non valido');
            return res.status(400).json({
                success: false,
                error: 'ID destinatario non valido'
            });
        }
        
        // Verifica che non esista già una richiesta pendente
        const [existing] = await db.execute(
            `SELECT id FROM notifications 
             WHERE sender_id = ? AND receiver_id = ? AND type = 'match_request' AND status = 'pending'`,
            [senderId, receiverId]
        );
        
        if (existing.length > 0) {
            console.log('❌ Richiesta già esistente');
            return res.status(409).json({
                success: false,
                error: 'Richiesta già inviata, in attesa di risposta'
            });
        }
        
        // Verifica che non esista già una connessione
        const [connection] = await db.execute(
            `SELECT id FROM connections 
             WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)`,
            [senderId, receiverId, receiverId, senderId]
        );
        
        if (connection.length > 0) {
            console.log('❌ Match già esistente');
            return res.status(409).json({
                success: false,
                error: 'Match già esistente'
            });
        }
        
        // Crea notifica
        const [result] = await db.execute(
            `INSERT INTO notifications (sender_id, receiver_id, type, status) VALUES (?, ?, 'match_request', 'pending')`,
            [senderId, receiverId]
        );
        
        console.log(`✅ Match request CREATA: ID=${result.insertId}, ${senderId} → ${receiverId}`);
        
        res.json({
            success: true,
            message: 'Richiesta inviata',
            notificationId: result.insertId
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
        const status = req.query.status || 'pending';
        const limit = parseInt(req.query.limit) || 20;
        
        console.log(`🔔 GET /api/notifications - userId: ${userId}, status: ${status}, limit: ${limit}`);
        
        const [notifications] = await db.execute(
            `SELECT n.*, 
                    u.name as sender_name, u.email as sender_email
             FROM notifications n
             JOIN users u ON n.sender_id = u.id
             WHERE n.receiver_id = ? AND n.status = ?
             ORDER BY n.created_at DESC
             LIMIT ?`,
            [userId, status, limit]
        );
        
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
        const limit = parseInt(req.query.limit) || 20;
        
        console.log(`🔔 GET /api/notifications/sent - userId: ${userId}, limit: ${limit}`);
        
        const [notifications] = await db.execute(
            `SELECT n.*, 
                    u.name as receiver_name, u.email as receiver_email
             FROM notifications n
             JOIN users u ON n.receiver_id = u.id
             WHERE n.sender_id = ?
             ORDER BY n.created_at DESC
             LIMIT ?`,
            [userId, limit]
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
        const userId = req.user.id;
        const { notificationId, response } = req.body; // response: 'accepted' | 'rejected'
        
        if (!['accepted', 'rejected'].includes(response)) {
            return res.status(400).json({
                success: false,
                error: 'Risposta non valida (accepted o rejected)'
            });
        }
        
        // Verifica che la notifica esista e sia destinata all'utente
        const [notification] = await db.execute(
            `SELECT * FROM notifications WHERE id = ? AND receiver_id = ? AND type = 'match_request'`,
            [notificationId, userId]
        );
        
        if (notification.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Notifica non trovata'
            });
        }
        
        const senderId = notification[0].sender_id;
        
        // Aggiorna status notifica
        await db.execute(
            `UPDATE notifications SET status = ? WHERE id = ?`,
            [response, notificationId]
        );
        
        // Se accettata, crea connessione
        if (response === 'accepted') {
            await db.execute(
                `INSERT INTO connections (user1_id, user2_id, status) VALUES (?, ?, 'active')`,
                [Math.min(senderId, userId), Math.max(senderId, userId)]
            );
            
            // Crea notifica per il sender
            await db.execute(
                `INSERT INTO notifications (sender_id, receiver_id, type, status, message) 
                 VALUES (?, ?, 'match_accepted', 'read', 'Il tuo match è stato accettato!')`,
                [userId, senderId]
            );
            
            console.log(`✅ Match creato: ${senderId} ↔ ${userId}`);
        }
        
        res.json({
            success: true,
            message: response === 'accepted' ? 'Match accettato!' : 'Richiesta rifiutata'
        });
        
    } catch (error) {
        console.error('❌ Error responding to match:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 🔵 GET /api/connections - Ottieni i miei match/connessioni
app.get('/api/connections', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        
        const [connections] = await db.execute(
            `SELECT c.*, 
                    u.id as other_user_id, u.name, u.email, u.skills
             FROM connections c
             JOIN users u ON (u.id = c.user1_id OR u.id = c.user2_id) AND u.id != ?
             WHERE (c.user1_id = ? OR c.user2_id = ?) AND c.status = 'active'`,
            [userId, userId, userId]
        );
        
        // Parse skills per ogni connessione
        const parsedConnections = connections.map(conn => ({
            ...conn,
            skills: conn.skills ? JSON.parse(conn.skills) : []
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

// ============================================
// API CHAT
// ============================================

// 🔵 GET /api/messages/:userId - Ottieni messaggi con un utente
app.get('/api/messages/:userId', authenticateToken, async (req, res) => {
    try {
        const currentUserId = req.user.id;
        const otherUserId = parseInt(req.params.userId);
        const { limit = 50, offset = 0 } = req.query;
        
        // Verifica che esista una connessione
        const [connection] = await db.execute(
            `SELECT id FROM connections 
             WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)`,
            [currentUserId, otherUserId, otherUserId, currentUserId]
        );
        
        if (connection.length === 0) {
            return res.status(403).json({
                success: false,
                error: 'Non sei connesso con questo utente'
            });
        }
        
        // Recupera messaggi
        const [messages] = await db.execute(
            `SELECT m.*, u.name as sender_name
             FROM messages m
             JOIN users u ON m.sender_id = u.id
             WHERE (m.sender_id = ? AND m.receiver_id = ?) 
                OR (m.sender_id = ? AND m.receiver_id = ?)
             ORDER BY m.created_at ASC
             LIMIT ? OFFSET ?`,
            [currentUserId, otherUserId, otherUserId, currentUserId, parseInt(limit), parseInt(offset)]
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

// 🔵 POST /api/messages - Invia messaggio
app.post('/api/messages', authenticateToken, async (req, res) => {
    try {
        const senderId = req.user.id;
        const { receiverId, content } = req.body;
        
        if (!receiverId || !content || content.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Dati messaggio non validi'
            });
        }
        
        // Verifica connessione
        const [connection] = await db.execute(
            `SELECT id FROM connections 
             WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)`,
            [senderId, receiverId, receiverId, senderId]
        );
        
        if (connection.length === 0) {
            return res.status(403).json({
                success: false,
                error: 'Non sei connesso con questo utente'
            });
        }
        
        // TODO: Implementare cifratura lato client per E2E
        // Per ora salviamo in chiaro con flag per futura migrazione
        const encrypted = false;
        const encryptionType = null;
        
        const [result] = await db.execute(
            `INSERT INTO messages (sender_id, receiver_id, content, encrypted, encryption_type) 
             VALUES (?, ?, ?, ?, ?)`,
            [senderId, receiverId, content.trim(), encrypted, encryptionType]
        );
        
        console.log(`💬 Message: ${senderId} → ${receiverId}`);
        
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
    
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`API endpoints available at http://localhost:${PORT}/api/`);
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
