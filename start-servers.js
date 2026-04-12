#!/usr/bin/env node
/**
 * Script per avviare automaticamente entrambi i server
 * con gestione errori e riavvio automatico
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('\n========================================');
console.log('🚀 Clonix Server Manager');
console.log('========================================\n');

let backendProcess = null;
let frontendProcess = null;

// Avvia il backend
function startBackend() {
    console.log('📡 Avvio Backend Server (porta 3001)...');
    
    backendProcess = spawn('node', ['server.js'], {
        cwd: __dirname,
        stdio: 'inherit',
        shell: true
    });
    
    backendProcess.on('exit', (code) => {
        console.log(`❌ Backend server stopped with code ${code}`);
        console.log('🔄 Riavvio backend tra 3 secondi...');
        setTimeout(startBackend, 3000);
    });
    
    backendProcess.on('error', (err) => {
        console.error('❌ Backend error:', err.message);
    });
}

// Avvia il frontend
function startFrontend() {
    console.log('🎨 Avvio Frontend Server (porta 8081)...');
    
    frontendProcess = spawn('node', ['static-server.js'], {
        cwd: __dirname,
        stdio: 'inherit',
        shell: true
    });
    
    frontendProcess.on('exit', (code) => {
        console.log(`❌ Frontend server stopped with code ${code}`);
        console.log('🔄 Riavvio frontend tra 3 secondi...');
        setTimeout(startFrontend, 3000);
    });
    
    frontendProcess.on('error', (err) => {
        console.error('❌ Frontend error:', err.message);
    });
}

// Gestione chiusura pulita
process.on('SIGINT', () => {
    console.log('\n\n👋 Chiusura server in corso...');
    
    if (backendProcess) {
        backendProcess.kill('SIGINT');
    }
    if (frontendProcess) {
        frontendProcess.kill('SIGINT');
    }
    
    setTimeout(() => {
        console.log('✅ Server chiusi. Arrivederci!');
        process.exit(0);
    }, 1000);
});

// Avvia entrambi i server
startBackend();

// Avvia frontend dopo 2 secondi (per evitare conflitti)
setTimeout(startFrontend, 2000);

console.log('\n📋 URL disponibili:');
console.log('   Backend API: http://localhost:3001/api');
console.log('   Frontend:    http://localhost:8081/auth');
console.log('\n⏹️  Premi Ctrl+C per fermare i server\n');
