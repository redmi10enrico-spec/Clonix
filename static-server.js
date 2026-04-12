const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = 8081;

// CORS configuration
app.use(cors({
    origin: ['http://localhost:3001', 'http://localhost:8081', 'http://127.0.0.1:5500'],
    credentials: true
}));

// Serve static files
app.use(express.static(__dirname));

// Route for auth.html
app.get('/auth', (req, res) => {
    res.sendFile(path.join(__dirname, 'auth.html'));
});

// Route for main dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Default route - serve auth.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'auth.html'));
});

// Start static server
app.listen(PORT, () => {
    console.log(`\n=== Clonix Static Server ===`);
    console.log(`Frontend server running on: http://localhost:${PORT}`);
    console.log(`Login page: http://localhost:${PORT}/auth`);
    console.log(`Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`Backend API: http://localhost:3001/api`);
    console.log(`===============================\n`);
});
