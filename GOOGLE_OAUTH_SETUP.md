# Google OAuth Setup Guide - Clonix

## Overview
Questa guida ti permetterà di configurare il vero Google OAuth con selezione account per l'applicazione Clonix.

## Step 1: Google Cloud Console Setup

### 1.1 Accedi a Google Cloud Console
1. Vai su: https://console.cloud.google.com/
2. Accedi con il tuo account Google
3. Crea un nuovo progetto o seleziona uno esistente

### 1.2 Abilita le API necessarie
1. Vai su "APIs & Services" > "Library"
2. Cerca e abilita queste API:
   - **Google+ API** (o alternativamente "People API")
   - **Google Identity Toolkit API**

### 1.3 Configura OAuth Consent Screen
1. Vai su "APIs & Services" > "OAuth consent screen"
2. Scegli "External" e clicca "Create"
3. Compila i campi obbligatori:
   - **App name**: Clonix
   - **User support email**: la tua email
   - **Developer contact information**: la tua email
4. Clicca "Save and Continue"
5. Nella sezione "Scopes", clicca "Save and Continue" (non aggiungere scopes per ora)
6. Nella sezione "Test users", aggiungi il tuo account Google per i test
7. Clicca "Save and Continue" poi "Back to Dashboard"

### 1.4 Crea Credenziali OAuth 2.0
1. Vai su "APIs & Services" > "Credentials"
2. Clicca "Create Credentials" > "OAuth 2.0 Client ID"
3. Seleziona "Web application"
4. Compila i campi:
   - **Name**: Clonix Web Client
   - **Authorized JavaScript origins**: 
     - `http://localhost:8080`
     - `http://127.0.0.1:8080`
   - **Authorized redirect URIs**:
     - `http://localhost:3000/api/auth/google/callback`
     - `http://127.0.0.1:3000/api/auth/google/callback`
5. Clicca "Create"

### 1.5 Ottieni le Credenziali
1. Dopo la creazione, vedrai un popup con le tue credenziali
2. Copia il **Client ID** e il **Client Secret**
3. Salvali in un posto sicuro

## Step 2: Configura il File .env

Apri il file `.env` nella root del progetto e aggiungi:

```env
# Google OAuth Configuration
GOOGLE_CLIENT_ID=tu_client_id_qui
GOOGLE_CLIENT_SECRET=tu_client_secret_qui
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
```

**Importante**: Sostituisci `tu_client_id_qui` e `tu_client_secret_qui` con le tue vere credenziali.

## Step 3: Riavvia il Server

1. Ferma il server backend (CTRL+C nel terminale)
2. Riavvialo con: `npm start`
3. Assicurati che il server statico sia attivo su porta 8080

## Step 4: Test del Google OAuth

### 4.1 Test Base
1. Apri: `http://localhost:8080/auth`
2. Clicca sul pulsante "Continua con Google"
3. Dovresti vedere la schermata di selezione account Google

### 4.2 Flusso Completo
1. Seleziona il tuo account Google
2. Autorizza l'applicazione (solo la prima volta)
3. Verrai reindirizzato alla dashboard con i dati del tuo profilo Google

## Funzionalità Implementate

### Features Disponibili:
- **Selezione Account Google**: Schermata completa per scegliere l'account
- **Importo Dati Profilo**: Nome, email, avatar da Google
- **Verifica Email**: Email automaticamente verificata da Google
- **Database Integration**: Utenti salvati nel database MySQL/Aiven
- **JWT Tokens**: Sessioni sicure e persistenti
- **Logout Completo**: Pulizia di tutte le sessioni

### Sicurezza:
- **OAuth 2.0**: Standard di sicurezza per autenticazione
- **CSRF Protection**: State token per prevenire attacchi
- **Token Scoping**: Accesso limitato solo alle informazioni necessarie
- **HTTPS Ready**: Configurazione per produzione

## Troubleshooting

### Errori Comuni:

#### "redirect_uri_mismatch"
- Verifica che il redirect URI nel backend corrisponda esattamente a quello configurato in Google Cloud Console
- Controlla http vs https e localhost vs 127.0.0.1

#### "invalid_client"
- Verifica che il Client ID sia corretto nel file .env
- Assicurati di non aver spazi extra o caratteri speciali

#### "access_denied"
- L'utente ha negato l'autenticazione
- Prova di nuovo e assicurati di autorizzare l'applicazione

### Debug:
1. Apri la console del browser per vedere errori dettagliati
2. Controlla i log del server backend per messaggi di errore
3. Verifica le impostazioni CORS nel backend

## Configurazione Produzione

Per deploy in produzione:

1. **Aggiorna Redirect URIs**:
   - `https://tuodominio.com/api/auth/google/callback`

2. **Configura HTTPS**:
   - Assicurati che il backend serva su HTTPS
   - Aggiorna gli URL nel frontend

3. **Domain Verification**:
   - Verifica il dominio in Google Cloud Console
   - Aggiorna il dominio nell'OAuth consent screen

## Supporto

Se hai problemi:
1. Controlla i log del server: `npm start`
2. Verifica le credenziali nel file .env
3. Controlla la configurazione in Google Cloud Console
4. Apri la console browser per errori JavaScript

---

**Una volta configurato, il Google OAuth mostrerà la schermata di selezione account e importerà automaticamente tutti i dati del profilo Google nel database!**
