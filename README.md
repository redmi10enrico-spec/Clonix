# Clonix - Authentication System

Sistema completo di autenticazione per Clonix con database Aiven MySQL.

## Struttura del Progetto

```
CloniX/
|-- auth.html              # Pagina di login/register
|-- index.html             # Dashboard principale (protetta)
|-- server.js              # Backend API Node.js
|-- package.json           # Dipendenze del progetto
|-- .env                   # Configurazione ambiente
|-- css/
|   |-- auth.css           # Stili autenticazione
|   |-- base.css           # Stili base
|   |-- components.css     # Componenti UI
|   |-- ...                # Altri file CSS
|-- scripts/
|   |-- init-database.js   # Script inizializzazione DB
|-- assets/                # Immagini e risorse
```

## Funzionalità Implementate

### Autenticazione
- **Login con Email/Password** - Connessione sicura al database
- **Registrazione Utenti** - Validazione e hash password
- **Login Google OAuth** - Integrazione con Google (demo)
- **Sessioni JWT** - Token sicuri con scadenza
- **Remember Me** - Persistenza login
- **Logout Sicuro** - Pulizia completa sessione

### Sicurezza
- **Hashing Password** - bcrypt con 12 rounds
- **JWT Tokens** - Autenticazione stateless
- **Rate Limiting** - Protezione contro attacchi
- **CORS Protection** - Controllo accessi
- **Input Validation** - Sanitizzazione dati
- **HTTPS Ready** - SSL per database Aiven

### Database
- **MySQL Aiven** - Connessione sicura SSL
- **Auto-migrazioni** - Creazione automatica tabelle
- **Indici Ottimizzati** - Performance query
- **Timestamp Tracking** - Audit trail

## Setup Rapido

### 1. Installare le dipendenze
```bash
npm install
```

### 2. Configurare il Database
Il file `.env` contiene già le credenziali Aiven:
- Host: `mysql-139f120b-clonixxx1-4c46.h.aivencloud.com`
- Port: `13759`
- Database: `defaultdb`

### 3. Inizializzare il Database
```bash
npm run init-db
```

Questo script:
- Testa la connessione al database
- Crea la tabella `users` se non esiste
- Inserisce un utente di test: `test@example.com` / `password123`

### 4. Avviare il Server
```bash
# Development
npm run dev

# Production
npm start
```

Il server API sarà disponibile su: `http://localhost:3000`

### 5. Aprire l'Applicazione
- **Login/Register**: `http://localhost:3000/auth.html` (o apri `auth.html` direttamente)
- **Dashboard**: `http://localhost:3000/index.html` (protetta da autenticazione)

## API Endpoints

### Autenticazione
```
POST /api/register     - Registra nuovo utente
POST /api/login        - Login con email/password
POST /api/google-login - Login con Google OAuth
POST /api/logout       - Logout utente
GET  /api/me           - Ottieni dati utente corrente
```

### Utility
```
GET /api/health        - Health check server
```

## Test del Sistema

### Utente di Test
- **Email**: `test@example.com`
- **Password**: `password123`

### Flow di Test
1. Apri `auth.html`
2. Prova registrazione con nuova email
3. Prova login con utente di test
4. Verifica redirect alla dashboard
5. Testa logout e ritorno a login

## Struttura Database

### Tabella Users
```sql
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
    email_verified BOOLEAN DEFAULT FALSE
);
```

## Sicurezza

### Password Hashing
- bcrypt con 12 salt rounds
- Password minima 8 caratteri
- Validazione lato client e server

### JWT Tokens
- Scadenza: 7 giorni
- Segreto configurabile in `.env`
- Verifica automatica su ogni richiesta

### Rate Limiting
- 100 richieste per 15 minuti per IP
- Protezione contro brute force

## Troubleshooting

### Database Connection
```bash
# Test connessione
npm run init-db
```

### Server Logs
Il server mostra log dettagliati per:
- Connessioni database
- Richieste API
- Errori di autenticazione

### Common Issues
1. **CORS Error**: Assicurati che il frontend sia sulla porta 3000
2. **DB Connection**: Verifica credenziali nel file `.env`
3. **Token Invalid**: Clear localStorage e sessionStorage

## Production Deployment

### Environment Variables
```bash
NODE_ENV=production
JWT_SECRET=your_super_secret_key
FRONTEND_URL=https://yourdomain.com
```

### Security Headers
Il server include:
- Helmet per security headers
- CORS configurato per production
- Rate limiting attivo

## Next Steps

### Features da Implementare
1. **Google OAuth completo** - Configurazione client Google
2. **Email Verification** - Invio email di conferma
3. **Password Reset** - Recupero password via email
4. **2FA Authentication** - Autenticazione a due fattori
5. **User Profiles** - Gestione profili utente
6. **Role-based Access** - Permessi e ruoli

### Performance
1. **Database Pooling** - Connessioni ottimizzate
2. **Caching Redis** - Sessioni veloci
3. **CDN Integration** - Asset statici
4. **API Monitoring** - Metrics e logging

## Support

Per problemi o domande:
1. Controlla i log del server
2. Verifica la connessione al database
3. Testa gli endpoint API con Postman
4. Controlla la configurazione CORS

---

**Sviluppato per Clonix Community** © 2024
