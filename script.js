document.addEventListener('DOMContentLoaded', () => {
    // Elementi per la navigazione
    const menuItems = document.querySelectorAll('.menu-item');
    const sections = {
        dashboard: document.getElementById('dashboardSection'),
        match: document.getElementById('matchSection'),
        chat: document.getElementById('chatSection'),
        groups: document.getElementById('groupsSection'),
        profile: document.getElementById('profileSection'),
        settings: document.getElementById('settingsSection')
    };

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

    // FUNZIONALITÀ BACKGROUND PERSONALIZZATO
    const backgroundRadios = document.querySelectorAll('input[name="background"]');
    const backgroundContainer = document.getElementById('backgroundContainer');
    
    // Funzione per creare background dinamico
    function createBackground(type) {
        let backgroundHTML = '';
        
        switch(type) {
            case 'cosmic':
                backgroundHTML = `
                    <div class="bg-cosmic"></div>
                    <div class="particle-container">
                        <div class="bg-particle"></div>
                        <div class="bg-particle"></div>
                        <div class="bg-particle"></div>
                        <div class="bg-particle"></div>
                        <div class="bg-particle"></div>
                    </div>
                    <div class="stars-bg">
                        <div class="star"></div>
                        <div class="star"></div>
                        <div class="star"></div>
                        <div class="star"></div>
                        <div class="star"></div>
                        <div class="star"></div>
                        <div class="star"></div>
                        <div class="star"></div>
                    </div>
                    <div class="geometric-bg">
                        <div class="geo-shape"></div>
                        <div class="geo-shape"></div>
                        <div class="geo-shape"></div>
                        <div class="geo-shape"></div>
                        <div class="geo-shape"></div>
                    </div>
                `;
                break;
                
            case 'ocean':
                backgroundHTML = `
                    <div class="bg-ocean"></div>
                    <div class="particle-container">
                        <div class="bg-particle"></div>
                        <div class="bg-particle"></div>
                        <div class="bg-particle"></div>
                    </div>
                    <div class="wave-gradient"></div>
                `;
                break;
                
            case 'forest':
                backgroundHTML = `
                    <div class="bg-forest"></div>
                    <div class="particle-container">
                        <div class="bg-particle"></div>
                        <div class="bg-particle"></div>
                        <div class="bg-particle"></div>
                        <div class="bg-particle"></div>
                    </div>
                    <div class="grid-pattern"></div>
                `;
                break;
                
            case 'aurora':
                backgroundHTML = `
                    <div class="bg-aurora"></div>
                    <div class="light-rays">
                        <div class="light-ray"></div>
                        <div class="light-ray"></div>
                        <div class="light-ray"></div>
                        <div class="light-ray"></div>
                    </div>
                    <div class="particle-container">
                        <div class="bg-particle"></div>
                        <div class="bg-particle"></div>
                    </div>
                `;
                break;
                
            case 'mountain':
                backgroundHTML = `
                    <div class="bg-mountain"></div>
                    <div class="particle-container">
                        <div class="bg-particle"></div>
                        <div class="bg-particle"></div>
                    </div>
                `;
                break;
                
            case 'desert':
                backgroundHTML = `
                    <div class="bg-desert"></div>
                    <div class="particle-container">
                        <div class="bg-particle"></div>
                        <div class="bg-particle"></div>
                    </div>
                `;
                break;
                
            case 'city':
                backgroundHTML = `
                    <div class="bg-city"></div>
                    <div class="particle-container">
                        <div class="bg-particle"></div>
                        <div class="bg-particle"></div>
                    </div>
                `;
                break;
                
                            
            default:
                backgroundHTML = `<div class="bg-cosmic"></div>`;
        }
        
        backgroundContainer.innerHTML = backgroundHTML;
    }
    
    // Gestione background personalizzato
    backgroundRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            const backgroundType = this.value;
            
            // Crea il nuovo background
            createBackground(backgroundType);
            
            // Salva preferenza background
            localStorage.setItem('clonix-background', backgroundType);
            
            // Mostra feedback
            console.log(`Background cambiato a: ${backgroundType}`);
        });
    });
    
    // Carica background salvato
    const savedBackground = localStorage.getItem('clonix-background');
    if (savedBackground) {
        const savedRadio = document.querySelector(`input[name="background"][value="${savedBackground}"]`);
        if (savedRadio) {
            savedRadio.checked = true;
        }
        createBackground(savedBackground);
    } else {
        // Background di default
        createBackground('cosmic');
    }

    // FUNZIONALITÀ PERSONALIZZAZIONE AVANZATA
    const sidebarLayoutSelect = document.getElementById('sidebarLayout');
    const cardStyleSelect = document.getElementById('cardStyle');
    const animationIntensitySelect = document.getElementById('animationIntensity');
    const hoverEffectsSelect = document.getElementById('hoverEffects');
    const enableParticlesCheckbox = document.getElementById('enableParticles');
    const enableSoundsCheckbox = document.getElementById('enableSounds');
    const enableParallaxCheckbox = document.getElementById('enableParallax');
    const enableGlowCheckbox = document.getElementById('enableGlow');
    
    // Impostazioni Interfaccia
    const interfaceDensitySelect = document.getElementById('interfaceDensity');
    const textSizeSelect = document.getElementById('textSize');
    const showShadowsCheckbox = document.getElementById('showShadows');
    const showGradientsCheckbox = document.getElementById('showGradients');
    const showBordersCheckbox = document.getElementById('showBorders');
    
    // Gestione Layout Sidebar
    if (sidebarLayoutSelect) {
        sidebarLayoutSelect.addEventListener('change', function() {
            const layout = this.value;
            document.body.className = document.body.className.replace(/sidebar-layout-\w+/g, '');
            document.body.classList.add(`sidebar-layout-${layout}`);
            localStorage.setItem('clonix-sidebar-layout', layout);
        });
        
        const savedSidebarLayout = localStorage.getItem('clonix-sidebar-layout');
        if (savedSidebarLayout) {
            sidebarLayoutSelect.value = savedSidebarLayout;
            document.body.classList.add(`sidebar-layout-${savedSidebarLayout}`);
        }
    }
    
    // Gestione Stile Card
    if (cardStyleSelect) {
        cardStyleSelect.addEventListener('change', function() {
            const style = this.value;
            document.body.className = document.body.className.replace(/card-style-\w+/g, '');
            document.body.classList.add(`card-style-${style}`);
            localStorage.setItem('clonix-card-style', style);
        });
        
        const savedCardStyle = localStorage.getItem('clonix-card-style');
        if (savedCardStyle) {
            cardStyleSelect.value = savedCardStyle;
            document.body.classList.add(`card-style-${savedCardStyle}`);
        }
    }
    
    // Gestione Intensità Animazioni
    if (animationIntensitySelect) {
        animationIntensitySelect.addEventListener('change', function() {
            const intensity = this.value;
            document.body.className = document.body.className.replace(/animation-\w+/g, '');
            document.body.classList.add(`animation-${intensity}`);
            localStorage.setItem('clonix-animation-intensity', intensity);
        });
        
        const savedAnimationIntensity = localStorage.getItem('clonix-animation-intensity');
        if (savedAnimationIntensity) {
            animationIntensitySelect.value = savedAnimationIntensity;
            document.body.classList.add(`animation-${savedAnimationIntensity}`);
        }
    }
    
    // Gestione Effetti Hover
    if (hoverEffectsSelect) {
        hoverEffectsSelect.addEventListener('change', function() {
            const effect = this.value;
            document.body.className = document.body.className.replace(/hover-\w+/g, '');
            document.body.classList.add(`hover-${effect}`);
            localStorage.setItem('clonix-hover-effects', effect);
        });
        
        const savedHoverEffects = localStorage.getItem('clonix-hover-effects');
        if (savedHoverEffects) {
            hoverEffectsSelect.value = savedHoverEffects;
            document.body.classList.add(`hover-${savedHoverEffects}`);
        }
    }
    
    // Gestione Particelle Interattive
    if (enableParticlesCheckbox) {
        enableParticlesCheckbox.addEventListener('change', function() {
            const enabled = this.checked;
            if (enabled) {
                document.body.classList.add('particles-enabled');
                initParticles();
            } else {
                document.body.classList.remove('particles-enabled');
                removeParticles();
            }
            localStorage.setItem('clonix-enable-particles', enabled);
        });
        
        const savedParticles = localStorage.getItem('clonix-enable-particles');
        if (savedParticles === 'true') {
            enableParticlesCheckbox.checked = true;
            document.body.classList.add('particles-enabled');
            initParticles();
        }
    }
    
    // Gestione Effetti Sonori
    if (enableSoundsCheckbox) {
        enableSoundsCheckbox.addEventListener('change', function() {
            const enabled = this.checked;
            if (enabled) {
                document.body.classList.add('sound-enabled');
            } else {
                document.body.classList.remove('sound-enabled');
            }
            localStorage.setItem('clonix-enable-sounds', enabled);
        });
        
        const savedSounds = localStorage.getItem('clonix-enable-sounds');
        if (savedSounds === 'true') {
            enableSoundsCheckbox.checked = true;
            document.body.classList.add('sound-enabled');
        }
    }
    
    // Gestione Effetto Parallax
    if (enableParallaxCheckbox) {
        enableParallaxCheckbox.addEventListener('change', function() {
            const enabled = this.checked;
            if (enabled) {
                document.body.classList.add('parallax-enabled');
                initParallax();
            } else {
                document.body.classList.remove('parallax-enabled');
                removeParallax();
            }
            localStorage.setItem('clonix-enable-parallax', enabled);
        });
        
        const savedParallax = localStorage.getItem('clonix-enable-parallax');
        if (savedParallax === 'true') {
            enableParallaxCheckbox.checked = true;
            document.body.classList.add('parallax-enabled');
            initParallax();
        }
    }
    
    // Gestione Effetto Luminoso Neon
    if (enableGlowCheckbox) {
        enableGlowCheckbox.addEventListener('change', function() {
            const enabled = this.checked;
            if (enabled) {
                document.body.classList.add('glow-enabled');
            } else {
                document.body.classList.remove('glow-enabled');
            }
            localStorage.setItem('clonix-enable-glow', enabled);
        });
        
        const savedGlow = localStorage.getItem('clonix-enable-glow');
        if (savedGlow === 'true') {
            enableGlowCheckbox.checked = true;
            document.body.classList.add('glow-enabled');
        }
    }
    
    // Gestione Densità Interfaccia
    if (interfaceDensitySelect) {
        interfaceDensitySelect.addEventListener('change', function() {
            const density = this.value;
            document.body.className = document.body.className.replace(/interface-density-\w+/g, '');
            document.body.classList.add(`interface-density-${density}`);
            localStorage.setItem('clonix-interface-density', density);
        });
        
        const savedInterfaceDensity = localStorage.getItem('clonix-interface-density');
        if (savedInterfaceDensity) {
            interfaceDensitySelect.value = savedInterfaceDensity;
            document.body.classList.add(`interface-density-${savedInterfaceDensity}`);
        }
    }
    
    // Gestione Dimensione Testo
    if (textSizeSelect) {
        textSizeSelect.addEventListener('change', function() {
            const size = this.value;
            document.body.className = document.body.className.replace(/text-size-\w+/g, '');
            document.body.classList.add(`text-size-${size}`);
            localStorage.setItem('clonix-text-size', size);
        });
        
        const savedTextSize = localStorage.getItem('clonix-text-size');
        if (savedTextSize) {
            textSizeSelect.value = savedTextSize;
            document.body.classList.add(`text-size-${savedTextSize}`);
        }
    }
    
    // Gestione Mostra Ombre
    if (showShadowsCheckbox) {
        showShadowsCheckbox.addEventListener('change', function() {
            const show = this.checked;
            if (!show) {
                document.body.classList.add('no-shadows');
            } else {
                document.body.classList.remove('no-shadows');
            }
            localStorage.setItem('clonix-show-shadows', show);
        });
        
        const savedShowShadows = localStorage.getItem('clonix-show-shadows');
        if (savedShowShadows === 'false') {
            showShadowsCheckbox.checked = false;
            document.body.classList.add('no-shadows');
        }
    }
    
    // Gestione Mostra Gradienti
    if (showGradientsCheckbox) {
        showGradientsCheckbox.addEventListener('change', function() {
            const show = this.checked;
            if (!show) {
                document.body.classList.add('no-gradients');
            } else {
                document.body.classList.remove('no-gradients');
            }
            localStorage.setItem('clonix-show-gradients', show);
        });
        
        const savedShowGradients = localStorage.getItem('clonix-show-gradients');
        if (savedShowGradients === 'false') {
            showGradientsCheckbox.checked = false;
            document.body.classList.add('no-gradients');
        }
    }
    
    // Gestione Mostra Bordi
    if (showBordersCheckbox) {
        showBordersCheckbox.addEventListener('change', function() {
            const show = this.checked;
            if (!show) {
                document.body.classList.add('no-borders');
            } else {
                document.body.classList.remove('no-borders');
            }
            localStorage.setItem('clonix-show-borders', show);
        });
        
        const savedShowBorders = localStorage.getItem('clonix-show-borders');
        if (savedShowBorders === 'false') {
            showBordersCheckbox.checked = false;
            document.body.classList.add('no-borders');
        }
    }

    // Funzioni per effetti speciali
    function initParticles() {
        document.addEventListener('mousemove', createParticle);
    }
    
    function removeParticles() {
        document.removeEventListener('mousemove', createParticle);
        document.querySelectorAll('.particle-trail').forEach(p => p.remove());
    }
    
    function createParticle(e) {
        if (!document.body.classList.contains('particles-enabled')) return;
        
        const particle = document.createElement('div');
        particle.className = 'particle-trail';
        particle.style.left = e.clientX + 'px';
        particle.style.top = e.clientY + 'px';
        document.body.appendChild(particle);
        
        setTimeout(() => particle.remove(), 1000);
    }
    
    function initParallax() {
        document.addEventListener('scroll', handleParallax);
    }
    
    function removeParallax() {
        document.removeEventListener('scroll', handleParallax);
    }
    
    function handleParallax() {
        if (!document.body.classList.contains('parallax-enabled')) return;
        
        const scrolled = window.pageYOffset;
        const parallaxElements = document.querySelectorAll('.stat-card');
        
        parallaxElements.forEach((element, index) => {
            const speed = 0.5 + (index * 0.1);
            element.style.transform = `translateY(${scrolled * speed}px)`;
        });
    }

    // FUNZIONALITÀ IMPOSTAZIONI
    const notificationCheckboxes = document.querySelectorAll('.notification-settings input[type="checkbox"]');
    const privacyCheckboxes = document.querySelectorAll('.privacy-settings input[type="checkbox"]');
    const settingSelects = document.querySelectorAll('.setting-select');
    const accountButtons = document.querySelectorAll('.account-settings .btn-secondary');

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
                        background: localStorage.getItem('clonix-background'),
                        notifications: {},
                        privacy: {}
                    },
                    exportDate: new Date().toISOString()
                };
                
                const dataStr = JSON.stringify(userData, null, 2);
                const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
                
                const exportFileDefaultName = `clonix-data-${new Date().toISOString().split('T')[0]}.json`;
                
                const linkElement = document.createElement('a');
                linkElement.setAttribute('href', dataUri);
                linkElement.setAttribute('download', exportFileDefaultName);
                linkElement.click();
                
                alert('Dati esportati con successo!');
            }
        });
    });
});
