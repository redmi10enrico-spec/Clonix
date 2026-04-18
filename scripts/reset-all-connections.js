/**
 * 🔴 SCRIPT ADMIN - RESETTA TUTTE LE CONNESSIONI
 * 
 * Questo script elimina:
 * - Tutte le connessioni (match accettati)
 * - Tutte le richieste di match (notifiche)
 * - Tutti i messaggi
 * - Tutte le chiavi pubbliche E2E
 * 
 * Uso:
 *   node scripts/reset-all-connections.js
 * 
 * ⚠️ ATTENZIONE: Questo non può essere annullato!
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function resetAllConnections() {
    console.log('🚨 AVVIO RESET TOTALE DELLE CONNESSIONI...\n');
    
    const db = await mysql.createPool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 13759,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl: {
            rejectUnauthorized: false
        },
        waitForConnections: true,
        connectionLimit: 2
    });
    
    try {
        // 1. Conta elementi
        console.log('📊 Conteggio elementi esistenti...');
        const [connectionsCount] = await db.execute('SELECT COUNT(*) as count FROM connections');
        const [notificationsCount] = await db.execute(
            "SELECT COUNT(*) as count FROM notifications WHERE type IN ('match_request', 'match_accepted', 'match_rejected')"
        );
        const [messagesCount] = await db.execute('SELECT COUNT(*) as count FROM messages');
        
        console.log(`   Connessioni attive: ${connectionsCount[0].count}`);
        console.log(`   Notifiche di match: ${notificationsCount[0].count}`);
        console.log(`   Messaggi: ${messagesCount[0].count}\n`);
        
        if (connectionsCount[0].count === 0 && notificationsCount[0].count === 0 && messagesCount[0].count === 0) {
            console.log('✅ Database già pulito. Nessun elemento da eliminare.');
            await db.end();
            process.exit(0);
        }
        
        // 2. Esegui reset
        console.log('🗑️  Eliminazione in corso...\n');
        
        await db.execute('DELETE FROM messages');
        console.log('   ✅ Messaggi eliminati');
        
        await db.execute('DELETE FROM connections');
        console.log('   ✅ Connessioni eliminate');
        
        await db.execute(
            "DELETE FROM notifications WHERE type IN ('match_request', 'match_accepted', 'match_rejected')"
        );
        console.log('   ✅ Notifiche di match eliminate');
        
        await db.execute('DELETE FROM messages');
        console.log('   ✅ Messaggi eliminati');
        
        // Prova a resettare public_key (può fallire se colonna non esiste)
        try {
            await db.execute('UPDATE users SET public_key = NULL');
            console.log('   ✅ Chiavi E2E resettate');
        } catch (e) {
            console.log('   ⚠️  Colonna public_key non esiste (ignorato)');
        }
        console.log('');
        
        // 3. Riepilogo
        console.log('═'.repeat(50));
        console.log('✅ RESET COMPLETATO CON SUCCESSO!');
        console.log('═'.repeat(50));
        console.log(`\nTutti gli utenti dovranno:`);
        console.log('  1. Rigenerare le chiavi E2E (se usavano chat)');
        console.log('  2. Riconnettersi con i match desiderati');
        console.log('  3. Reinviare richieste di connessione\n');
        
    } catch (error) {
        console.error('❌ ERRORE durante il reset:', error.message);
        process.exit(1);
    } finally {
        await db.end();
    }
}

// Conferma sicurezza
console.log('\n' + '🔴'.repeat(25));
console.log('  ATTENZIONE: QUESTO ELIMINA TUTTE LE CONNESSIONI!');
console.log('🔴'.repeat(25) + '\n');

const readline = require('readline');
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('⚠️  Scrivi "RESET" per confermare: ', (answer) => {
    rl.close();
    
    if (answer.trim().toUpperCase() === 'RESET') {
        resetAllConnections();
    } else {
        console.log('\n❌ Operazione annullata. Nessun dato eliminato.');
        process.exit(0);
    }
});
