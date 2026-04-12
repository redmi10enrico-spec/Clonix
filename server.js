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
require('dotenv').config();

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

// Database connection
let db;

async function initDatabase() {
    try {
        db = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            ssl: {
                rejectUnauthorized: false // Allow self-signed certificates for development
            }
        });
        
        console.log('Connected to Aiven MySQL database');
        
        // Create users table if it doesn't exist
        await createUsersTable();
        
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
            INDEX idx_email (email),
            INDEX idx_google_id (google_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    
    try {
        await db.execute(createTableQuery);
        console.log('Users table ready');
    } catch (error) {
        console.error('Error creating users table:', error);
        throw error;
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

        // Find user
        const [users] = await db.execute(
            'SELECT id, name, email, password_hash, avatar_url FROM users WHERE email = ? AND is_active = TRUE',
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
                avatar_url: user.avatar_url
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

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        database: db ? 'Connected' : 'Disconnected'
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

// Start server
const PORT = process.env.PORT || 3000;

async function startServer() {
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
