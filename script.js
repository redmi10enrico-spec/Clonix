document.addEventListener('DOMContentLoaded', () => {
    // Elementi per la navigazione
    const menuItems = document.querySelectorAll('.menu-item');
    const sections = {
        dashboard: document.querySelector('.main-content:not([style*="display: none"])'),
        match: document.getElementById('matchSection'),
        chat: document.getElementById('chatSection'),
        groups: document.getElementById('groupsSection'),
        profile: document.getElementById('profileSection'),
        settings: document.getElementById('settingsSection')
    };

    // Elementi tema scuro
    const themeToggle = document.getElementById('themeToggle');
    const themeIcon = themeToggle.querySelector('i');
    const themeText = themeToggle.querySelector('span');
    const body = document.body;

    // Carica preferenza tema salvata
    const savedTheme = localStorage.getItem('vibemach-theme');
    if (savedTheme === 'dark') {
        body.classList.add('dark-theme');
        themeIcon.className = 'ph ph-sun';
        themeText.textContent = 'Tema Chiaro';
    }

    // Elementi chat principale
    const chatInputMain = document.getElementById('chatInputMain');
    const sendBtnMain = document.getElementById('sendBtnMain');
    const chatMessagesMain = document.getElementById('chatMessagesMain');

    // Funzione per mostrare/nascondere sezioni
    function showSection(sectionName) {
        // Nascondi tutte le sezioni
        Object.values(sections).forEach(section => {
            if (section) section.style.display = 'none';
        });

        // Mostra la sezione richiesta
        if (sections[sectionName]) {
            sections[sectionName].style.display = 'block';
        }
    }

    // Gestione Menu Active e navigazione
    menuItems.forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            
            // Rimuovi active da tutti
            menuItems.forEach(i => i.classList.remove('active'));
            // Aggiungi active al corrente
            this.classList.add('active');

            // Determina quale sezione mostrare
            const text = this.textContent.trim().toLowerCase();
            if (text.includes('dashboard')) {
                showSection('dashboard');
            } else if (text.includes('match')) {
                showSection('match');
            } else if (text.includes('chat')) {
                showSection('chat');
            } else if (text.includes('gruppi')) {
                showSection('groups');
            } else if (text.includes('profilo')) {
                showSection('profile');
            } else if (text.includes('impostazioni')) {
                showSection('settings');
            }
        });
    });

    // Funzione per inviare messaggio nella chat principale
    function sendMessageMain() {
        const text = chatInputMain.value.trim();
        
        if (text !== "") {
            // Crea elemento messaggio
            const msgDiv = document.createElement('div');
            msgDiv.classList.add('msg', 'sent');
            msgDiv.innerHTML = `<p>${text}</p>`;
            
            // Aggiungi alla chat
            chatMessagesMain.appendChild(msgDiv);
            
            // Pulisci input
            chatInputMain.value = "";
            
            // Scroll automatico verso il basso
            chatMessagesMain.scrollTop = chatMessagesMain.scrollHeight;
        }
    }

    // Event Listeners chat principale
    if (sendBtnMain) {
        sendBtnMain.addEventListener('click', sendMessageMain);
    }

    if (chatInputMain) {
        chatInputMain.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendMessageMain();
            }
        });
    }

    // Funzionalità aggiuntive per i chat items
    const chatItems = document.querySelectorAll('.chat-item');
    chatItems.forEach(item => {
        item.addEventListener('click', function() {
            // Rimuovi active da tutti
            chatItems.forEach(i => i.classList.remove('active'));
            // Aggiungi active al corrente
            this.classList.add('active');
            
            // Qui potresti caricare i messaggi della conversazione selezionata
            const userName = this.querySelector('h4').textContent;
            console.log(`Caricando conversazione con: ${userName}`);
        });
    });

    // Funzionalità per i pulsanti di connessione
    const connectButtons = document.querySelectorAll('.match-actions .btn-primary');
    connectButtons.forEach(button => {
        button.addEventListener('click', function() {
            const userName = this.closest('.match-card-detailed').querySelector('h3').textContent;
            alert(`Richiesta di connessione inviata a ${userName}!`);
        });
    });

    // Funzionalità per i pulsanti messaggio
    const messageButtons = document.querySelectorAll('.match-actions .btn-secondary');
    messageButtons.forEach(button => {
        button.addEventListener('click', function() {
            const userName = this.closest('.match-card-detailed').querySelector('h3').textContent;
            // Naviga alla sezione chat
            showSection('chat');
            // Aggiorna menu active
            menuItems.forEach(i => i.classList.remove('active'));
            document.querySelector('.menu-item:nth-child(3)').classList.add('active');
        });
    });

    // Funzionalità per i gruppi
    const groupButtons = document.querySelectorAll('.group-actions .btn-primary');
    groupButtons.forEach(button => {
        button.addEventListener('click', function() {
            const groupName = this.closest('.group-card').querySelector('h3').textContent;
            if (this.textContent.includes('Entra in Chat')) {
                showSection('chat');
                menuItems.forEach(i => i.classList.remove('active'));
                document.querySelector('.menu-item:nth-child(3)').classList.add('active');
            } else if (this.textContent.includes('Crea Gruppo')) {
                alert(`Creazione del gruppo ${groupName} in sviluppo...`);
            }
        });
    });

    // Funzionalità profilo - salvataggio modifiche
    const saveProfileBtn = document.querySelector('.profile-actions .btn-primary');
    if (saveProfileBtn) {
        saveProfileBtn.addEventListener('click', function() {
            alert('Profilo salvato con successo!');
        });
    }

    // Funzionalità aggiunta competenze
    const addSkillBtn = document.querySelector('.add-skill .btn-primary');
    const skillInput = document.querySelector('.skill-input');
    
    if (addSkillBtn && skillInput) {
        addSkillBtn.addEventListener('click', function() {
            const skillText = skillInput.value.trim();
            if (skillText) {
                const skillsContainer = document.querySelector('.skills-container');
                const newSkill = document.createElement('div');
                newSkill.className = 'skill-item';
                newSkill.innerHTML = `
                    <span>${skillText}</span>
                    <button class="skill-remove"><i class="ph ph-x"></i></button>
                `;
                
                // Inserisci prima del div add-skill
                skillsContainer.insertBefore(newSkill, skillsContainer.querySelector('.add-skill'));
                
                // Pulisci input
                skillInput.value = '';
                
                // Aggiungi event listener per rimozione
                newSkill.querySelector('.skill-remove').addEventListener('click', function() {
                    newSkill.remove();
                });
            }
        });
    }

    // Funzionalità rimozione competenze esistenti
    document.querySelectorAll('.skill-remove').forEach(button => {
        button.addEventListener('click', function() {
            this.closest('.skill-item').remove();
        });
    });

    // Funzionalità tema scuro
    function toggleTheme() {
        const isDark = body.classList.contains('dark-theme');
        
        if (isDark) {
            // Passa a tema chiaro
            body.classList.remove('dark-theme');
            themeIcon.className = 'ph ph-moon';
            themeText.textContent = 'Tema Scuro';
            localStorage.setItem('vibemach-theme', 'light');
        } else {
            // Passa a tema scuro
            body.classList.add('dark-theme');
            themeIcon.className = 'ph ph-sun';
            themeText.textContent = 'Tema Chiaro';
            localStorage.setItem('vibemach-theme', 'dark');
        }
    }

    // Event listener per il toggle tema
    themeToggle.addEventListener('click', toggleTheme);

    // Aggiungi animazione al toggle
    themeToggle.addEventListener('mouseenter', function() {
        this.style.transform = 'translateY(-3px) scale(1.05)';
    });

    themeToggle.addEventListener('mouseleave', function() {
        this.style.transform = 'translateY(-2px) scale(1)';
    });

    // FUNZIONALITÀ IMPOSTAZIONI
    const themeRadios = document.querySelectorAll('input[name="theme"]');
    const notificationCheckboxes = document.querySelectorAll('.notification-settings input[type="checkbox"]');
    const privacyCheckboxes = document.querySelectorAll('.privacy-settings input[type="checkbox"]');
    const settingSelects = document.querySelectorAll('.setting-select');
    const accountButtons = document.querySelectorAll('.account-settings .btn-secondary');

    // Gestione tema personalizzato
    themeRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            const theme = this.value;
            
            if (theme === 'light') {
                body.classList.remove('dark-theme');
                themeIcon.className = 'ph ph-moon';
                themeText.textContent = 'Tema Scuro';
                localStorage.setItem('vibemach-theme', 'light');
            } else if (theme === 'dark') {
                body.classList.add('dark-theme');
                themeIcon.className = 'ph ph-sun';
                themeText.textContent = 'Tema Chiaro';
                localStorage.setItem('vibemach-theme', 'dark');
            } else if (theme === 'auto') {
                // Implementazione tema automatico basato su preferenze di sistema
                const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                if (prefersDark) {
                    body.classList.add('dark-theme');
                    themeIcon.className = 'ph ph-sun';
                    themeText.textContent = 'Tema Chiaro';
                } else {
                    body.classList.remove('dark-theme');
                    themeIcon.className = 'ph ph-moon';
                    themeText.textContent = 'Tema Scuro';
                }
                localStorage.setItem('vibemach-theme', 'auto');
            }
            
            // Salva preferenza tema
            localStorage.setItem('vibemach-theme', theme);
        });
    });

    // Carica tema salvato nelle impostazioni
    const savedThemeSettings = localStorage.getItem('vibemach-theme');
    if (savedThemeSettings) {
        const savedRadio = document.querySelector(`input[name="theme"][value="${savedThemeSettings}"]`);
        if (savedRadio) {
            savedRadio.checked = true;
        }
    }

    // Gestione notifiche
    notificationCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            const settingName = this.nextElementSibling.textContent.trim();
            const isEnabled = this.checked;
            
            // Salva preferenza notifiche
            localStorage.setItem(`notification-${settingName.toLowerCase().replace(/\s+/g, '-')}`, isEnabled);
            
            // Mostra feedback
            console.log(`Notifica "${settingName}" ${isEnabled ? 'attivata' : 'disattivata'}`);
            
            // Implementazione reale delle notifiche
            if (settingName === 'Notifiche push' && isEnabled) {
                // Richiedi permessi per notifiche push
                if ('Notification' in window && Notification.permission === 'default') {
                    Notification.requestPermission();
                }
            }
        });
    });

    // Carica preferenze notifiche salvate
    notificationCheckboxes.forEach(checkbox => {
        const settingName = checkbox.nextElementSibling.textContent.trim();
        const savedValue = localStorage.getItem(`notification-${settingName.toLowerCase().replace(/\s+/g, '-')}`);
        if (savedValue !== null) {
            checkbox.checked = savedValue === 'true';
        }
    });

    // Gestione privacy
    privacyCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            const settingName = this.nextElementSibling.textContent.trim();
            const isEnabled = this.checked;
            
            // Salva preferenza privacy
            localStorage.setItem(`privacy-${settingName.toLowerCase().replace(/\s+/g, '-')}`, isEnabled);
            
            // Mostra feedback
            console.log(`Impostazione privacy "${settingName}" ${isEnabled ? 'attivata' : 'disattivata'}`);
            
            // Applica immediate changes
            if (settingName === 'Mostra stato online') {
                // Implementazione visibilità stato online
                document.body.classList.toggle('hide-online-status', !isEnabled);
            }
        });
    });

    // Carica preferenze privacy salvate
    privacyCheckboxes.forEach(checkbox => {
        const settingName = checkbox.nextElementSibling.textContent.trim();
        const savedValue = localStorage.getItem(`privacy-${settingName.toLowerCase().replace(/\s+/g, '-')}`);
        if (savedValue !== null) {
            checkbox.checked = savedValue === 'true';
        }
    });

    // Gestione select (lingua, fuso orario)
    settingSelects.forEach(select => {
        select.addEventListener('change', function() {
            const settingName = this.previousElementSibling.textContent.trim();
            const value = this.value;
            
            // Salva preferenza
            localStorage.setItem(`setting-${settingName.toLowerCase().replace(/\s+/g, '-')}`, value);
            
            // Mostra feedback
            console.log(`${settingName} impostato a: ${value}`);
            
            // Applica immediate changes
            if (settingName === 'Lingua') {
                // Implementazione cambio lingua (richiederebbe ricaricamento pagina)
                alert(`Lingua cambiata a: ${value}. Ricarica la pagina per applicare le modifiche.`);
            }
        });
    });

    // Carica preferenze select salvate
    settingSelects.forEach(select => {
        const settingName = select.previousElementSibling.textContent.trim();
        const savedValue = localStorage.getItem(`setting-${settingName.toLowerCase().replace(/\s+/g, '-')}`);
        if (savedValue) {
            select.value = savedValue;
        }
    });

    // Gestione bottoni account
    accountButtons.forEach(button => {
        button.addEventListener('click', function() {
            const buttonText = this.textContent.trim();
            
            if (buttonText.includes('Cambia Password')) {
                // Apri modale per cambio password
                const newPassword = prompt('Inserisci la nuova password:');
                if (newPassword && newPassword.length >= 8) {
                    alert('Password cambiata con successo!');
                    console.log('Password aggiornata');
                } else if (newPassword) {
                    alert('La password deve avere almeno 8 caratteri.');
                }
            } else if (buttonText.includes('Esporta Dati')) {
                // Esporta dati utente
                const userData = {
                    profile: {
                        name: 'Andrea',
                        surname: 'Rossi',
                        email: 'andrea.rossi@email.com'
                    },
                    settings: {
                        theme: localStorage.getItem('vibemach-theme'),
                        notifications: {},
                        privacy: {}
                    },
                    exportDate: new Date().toISOString()
                };
                
                const dataStr = JSON.stringify(userData, null, 2);
                const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
                
                const exportFileDefaultName = `vibemach-data-${new Date().toISOString().split('T')[0]}.json`;
                
                const linkElement = document.createElement('a');
                linkElement.setAttribute('href', dataUri);
                linkElement.setAttribute('download', exportFileDefaultName);
                linkElement.click();
                
                alert('Dati esportati con successo!');
            }
        });
    });
});