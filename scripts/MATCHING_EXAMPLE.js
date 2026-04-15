/**
 * 🎯 ESEMPIO FRONTEND - SISTEMA DI MATCHING
 * 
 * Questo file mostra come usare il sistema di matching dal frontend.
 * Puoi integrare queste funzioni nella tua app.
 */

const API_BASE_URL = 'http://localhost:3001/api';

/**
 * 📊 1. RECUPERA I MATCH DELL'UTENTE CORRENTE
 * 
 * GET /api/matches/:userId
 * 
 * Esempio di risposta:
 * {
 *   success: true,
 *   data: {
 *     user: { id: 1, name: "Mario", skills: ["coding", "startup"] },
 *     totalMatches: 50,
 *     filteredMatches: 15,
 *     matches: [
 *       {
 *         user: { id: 2, name: "Luca", email: "luca@test.com", totalSkills: 5 },
 *         compatibility: {
 *           percentage: 85,      // 🔥 85% di compatibilità!
 *           score: 12,
 *           commonTags: ["coding", "startup"], // Tag in comune
 *           commonTagsCount: 2
 *         }
 *       },
 *       {
 *         user: { id: 3, name: "Anna", email: "anna@test.com", totalSkills: 3 },
 *         compatibility: {
 *           percentage: 60,
 *           score: 6,
 *           commonTags: ["coding"],
 *           commonTagsCount: 1
 *         }
 *       }
 *     ]
 *   }
 * }
 */
async function fetchUserMatches(userId, limit = 10) {
    try {
        const token = localStorage.getItem('authToken');
        
        if (!token) {
            throw new Error('Utente non autenticato');
        }
        
        const response = await fetch(`${API_BASE_URL}/matches/${userId}?limit=${limit}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Errore nel recupero dei match');
        }
        
        console.log('✅ Match trovati:', data.data.matches.length);
        return data.data;
        
    } catch (error) {
        console.error('❌ Errore:', error.message);
        return null;
    }
}

/**
 * ⚡ 2. VERSIONE RAPIDA - SOLO TOP 5
 * 
 * GET /api/matches/quick/:userId
 * 
 * Risposta light:
 * {
 *   success: true,
 *   matches: [
 *     { id: 2, name: "Luca", percentage: 85, commonTags: ["coding", "startup"] }
 *   ]
 * }
 */
async function fetchQuickMatches(userId) {
    try {
        const token = localStorage.getItem('authToken');
        
        const response = await fetch(`${API_BASE_URL}/matches/quick/${userId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        return data.matches || [];
        
    } catch (error) {
        console.error('Errore:', error);
        return [];
    }
}

/**
 * 💾 3. SALVA LE SKILL NEL DATABASE
 * 
 * PUT /api/users/:userId/skills
 * 
 * Body: { skills: ["coding", "startup", "ai"] }
 */
async function saveSkillsToDatabase(userId, skills) {
    try {
        const token = localStorage.getItem('authToken');
        
        const response = await fetch(`${API_BASE_URL}/users/${userId}/skills`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ skills })
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log('✅ Skills salvate nel database:', data.skills);
            return data.skills;
        } else {
            throw new Error(data.error);
        }
        
    } catch (error) {
        console.error('❌ Errore salvataggio:', error.message);
        return null;
    }
}

/**
 * 📥 4. RECUPERA LE SKILL DAL DATABASE
 * 
 * GET /api/users/:userId/skills
 */
async function fetchSkillsFromDatabase(userId) {
    try {
        const token = localStorage.getItem('authToken');
        
        const response = await fetch(`${API_BASE_URL}/users/${userId}/skills`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        return data.skills || [];
        
    } catch (error) {
        console.error('Errore:', error);
        return [];
    }
}

/**
 * 🎨 5. ESEMPIO DI VISUALIZZAZIONE MATCH
 * 
 * Crea cards HTML per ogni match
 */
function renderMatches(matches) {
    const container = document.getElementById('matchesContainer');
    if (!container) return;
    
    if (matches.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>😕 Nessun match trovato</p>
                <p>Aggiungi più competenze al tuo profilo!</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = matches.map(match => `
        <div class="match-card" data-percentage="${match.compatibility.percentage}">
            <div class="match-header">
                <div class="match-avatar">${match.user.name.charAt(0)}</div>
                <div class="match-info">
                    <h3>${match.user.name}</h3>
                    <p>${match.user.totalSkills} competenze</p>
                </div>
                <div class="match-percentage ${getPercentageClass(match.compatibility.percentage)}">
                    ${match.compatibility.percentage}%
                </div>
            </div>
            
            <div class="match-tags">
                <p>🎯 Tag in comune (${match.compatibility.commonTagsCount}):</p>
                <div class="common-tags">
                    ${match.compatibility.commonTags.map(tag => 
                        `<span class="tag tag-match">${tag}</span>`
                    ).join('')}
                </div>
            </div>
            
            <div class="match-actions">
                <button onclick="connectUser(${match.user.id})" class="btn-primary">
                    💬 Messaggio
                </button>
                <button onclick="viewProfile(${match.user.id})" class="btn-secondary">
                    👤 Profilo
                </button>
            </div>
        </div>
    `).join('');
}

/**
 * 🌈 Colora la percentuale in base al valore
 */
function getPercentageClass(percentage) {
    if (percentage >= 80) return 'percentage-high';    // 🟢 Verde
    if (percentage >= 50) return 'percentage-medium';  // 🟡 Giallo
    return 'percentage-low';                            // 🔴 Rosso
}

/**
 * 🔧 ESEMPIO DI UTILIZZO COMPLETO
 */
async function exampleUsage() {
    // 1. Ottieni l'utente corrente
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    if (!currentUser) {
        console.error('Utente non loggato');
        return;
    }
    
    // 2. Salva le skill nel database (se non già fatto)
    if (currentUser.skills && currentUser.skills.length > 0) {
        await saveSkillsToDatabase(currentUser.id, currentUser.skills);
    }
    
    // 3. Recupera i match
    const matchData = await fetchUserMatches(currentUser.id, 10);
    if (!matchData) return;
    
    console.log('📊 Statistiche match:');
    console.log(`   Totale utenti: ${matchData.totalMatches}`);
    console.log(`   Match filtrati: ${matchData.filteredMatches}`);
    console.log(`   Top match: ${matchData.matches.length}`);
    
    // 4. Visualizza
    renderMatches(matchData.matches);
    
    // 5. Mostra il miglior match
    if (matchData.matches.length > 0) {
        const bestMatch = matchData.matches[0];
        console.log('🏆 Miglior match:', bestMatch.user.name);
        console.log('   Compatibilità:', bestMatch.compatibility.percentage + '%');
        console.log('   Tag in comune:', bestMatch.compatibility.commonTags.join(', '));
    }
}

/**
 * 📊 ALGORITMO DI MATCHING (spiegazione)
 * 
 * Per ogni coppia di utenti:
 * 
 * 1. Parse skills (JSON → Array)
 * 2. Normalizza a lowercase
 * 3. Trova intersezione (tag in comune)
 * 4. Calcola score pesato:
 *    - Tag standard: 3 punti
 *    - Tag con peso (es: startup): 3 × peso
 * 
 * 5. Formula percentuale:
 *    percentage = (score / maxPossibile) × 100
 * 
 * 6. Ordina per percentage DESC
 * 7. Limita a top N risultati
 * 
 * Esempio calcolo:
 * User A: ["coding", "startup", "ai"]
 * User B: ["coding", "startup", "design"]
 * 
 * In comune: coding (3pt), startup (3×2=6pt)
 * Score: 3 + 6 = 9
 * Max possibile: 3 tag × 3pt × 2 max peso = 18
 * Percentuale: (9/18) × 100 = 50%
 */

// 🚀 Avvia esempio quando il documento è pronto
// document.addEventListener('DOMContentLoaded', exampleUsage);

module.exports = {
    fetchUserMatches,
    fetchQuickMatches,
    saveSkillsToDatabase,
    fetchSkillsFromDatabase,
    renderMatches
};
