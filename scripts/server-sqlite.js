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
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());
app.use(cors({
    origin: ['http://localhost:8081', 'http://localhost:3000'],
    credentials: true
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
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_login DATETIME,
                is_active INTEGER DEFAULT 1,
                email_verified INTEGER DEFAULT 0
            )
        `, (err) => {
            if (err) {
                console.error('Error creating table:', err);
                reject(err);
            } else {
                console.log('✅ SQLite database ready');
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

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        database: 'SQLite (local)',
        timestamp: new Date().toISOString()
    });
});

// Start server
async function startServer() {
    try {
        await initDatabase();
        
        app.listen(PORT, () => {
            console.log(`
🚀 Server SQLite avviato!
📡 Porta: ${PORT}
🔗 URL: http://localhost:${PORT}/api
📊 Database: SQLite locale (clonix_local.db)

✅ Endpoints disponibili:
   POST /api/register
   POST /api/login
   GET  /api/me
   GET  /api/matches/:userId
   PUT  /api/users/:userId/skills
   GET  /api/health
            `);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
