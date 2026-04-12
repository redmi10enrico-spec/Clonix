const mysql = require('mysql2/promise');
require('dotenv').config();

async function testConnection() {
    console.log('Testing database connection...');
    
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            ssl: {
                rejectUnauthorized: false // Allow self-signed certificates for development
            }
        });
        
        console.log('Database connection successful!');
        
        // Test basic query
        const [rows] = await connection.execute('SELECT 1 as test');
        console.log('Test query result:', rows);
        
        // Check if users table exists
        const [tables] = await connection.execute(
            "SHOW TABLES LIKE 'users'"
        );
        
        if (tables.length === 0) {
            console.log('Creating users table...');
            
            const createTableQuery = `
                CREATE TABLE users (
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
            
            await connection.execute(createTableQuery);
            console.log('Users table created successfully!');
        } else {
            console.log('Users table already exists');
            
            // Show table structure
            const [structure] = await connection.execute('DESCRIBE users');
            console.log('Table structure:', structure);
        }
        
        // Insert test user if table is empty
        const [count] = await connection.execute('SELECT COUNT(*) as count FROM users');
        
        if (count[0].count === 0) {
            console.log('Inserting test user...');
            const bcrypt = require('bcryptjs');
            const hashedPassword = await bcrypt.hash('password123', 12);
            
            await connection.execute(
                'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
                ['Test User', 'test@example.com', hashedPassword]
            );
            
            console.log('Test user created: test@example.com / password123');
        } else {
            console.log(`Found ${count[0].count} users in database`);
            
            // Show existing users
            const [users] = await connection.execute(
                'SELECT id, name, email, created_at, last_login FROM users LIMIT 5'
            );
            console.log('Existing users:', users);
        }
        
        await connection.end();
        console.log('Database initialization completed successfully!');
        
    } catch (error) {
        console.error('Database connection failed:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    testConnection();
}

module.exports = { testConnection };
