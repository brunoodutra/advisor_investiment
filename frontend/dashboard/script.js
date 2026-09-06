import { CONFIG } from './config.js?v=20260828a';
import { state } from './state.js?v=20260828a';
import { normalizeUpdateIntervalMs } from './utils.js?v=20260828a';
import { fetchCryptoData, fetchFearGreedIndex, fetchGlobalData, fetchMarketExitData } from './api.js?v=20260828a';
import { renderCryptoCards, showPage, toggleTheme, toggleViewMode, preloadRecommendations, showCryptoDetail, showNotification } from './ui.js?v=20260905hard';
import { changeCrypto, changeTimeframe, home_dashboard, loadLightweightChart, openSettings, resetSettings, saveSettings, toggleRuler, showRulerInfo, clearRuler } from './chart.js?v=20260828a';
import { renderMarketExitCard, showMarketExitPage } from './marketExit.js?v=20260828a';
import { toggleMAPanel, applyMASettings, clearAllMA, handlePeriodCheckboxChange, updateMAToggleButtonState, toggleMovingAverages, toggleFibonacci, toggleRSI, toggleMACD } from './indicatorControls.js?v=20260828a';
import { initAuth, wireAuthUI, requireAuthThenNavigate } from './auth.js?v=20260828a';
import { loadUserSettings } from './userSettings.js?v=20260828a';
import { refreshAlerts, wireAlertsUI } from './alerts.js?v=20260828a';
import { initAIChat } from './chat.js?v=20260828a';
import { renderTradeBotCard, showTradeBotPage, loadTradeBotDashboardPage } from './tradeBotDashboard.js?v=20260905polish';

let userSettingsSchemaNotified = false;

// Initialization
document.addEventListener('DOMContentLoaded', async function() {
    // Load settings from storage
    loadSettingsFromStorage();

    await initAuth();
    wireAuthUI();
    wireDemoUnlockUI();
    updateDemoLockUI();
    await hydrateSettingsFromUser();
    await refreshAlerts();
    wireAlertsUI();
    initAIChat();
    window.addEventListener('auth:changed', async () => {
        await hydrateSettingsFromUser();
        await refreshAlerts();
        updateDemoLockUI();
        fetchCryptoData();
    });
    
    // Initialize data fetching
    fetchGlobalData();
    fetchFearGreedIndex();
    fetchCryptoData();

    // Render skeleton de loading imediatamente (sem disparar requests)
    renderMarketExitCardComponent();
    renderTradeBotCardComponent();

    // Market Exit: busca e atualiza UI em cadeia. Quando termina, popula state.marketExitData
    // e o próximo render (por interval) só usa cache. Evita dupla chamada no init.
    fetchMarketExitData().then(() => {
        const container = document.getElementById('market-exit-card-container');
        if (container && state.marketExitData) renderMarketExitCard(container);
    }).catch(() => {/* noop */});

    // Pre-load recommendations in background for better performance
    setTimeout(() => {
        if (typeof preloadRecommendations === 'function') {
            try { preloadRecommendations(); } catch (e) { /* noop */ }
        }
    }, 2000);
    
    // Set up intervals for data updates
    setDataIntervals();

    window.addEventListener('settings:changed', () => {
        setDataIntervals();
    });
    
    // Set default active timeframe button
    const defaultTimeframeBtn = document.querySelector(`[data-timeframe="${state.settings.timeframe}"]`);
    if (defaultTimeframeBtn) {
        defaultTimeframeBtn.classList.add('active');
    }
    
    console.log('Dashboard initialized with settings:', state.settings);
    
    // Make functions globally available for HTML onclick handlers
window.changeCrypto = changeCrypto;
window.changeTimeframe = changeTimeframe;
window.home_dashboard = home_dashboard;
window.openSettings = openSettings;
window.resetSettings = resetSettings;
window.saveSettings = saveSettings;
window.toggleRuler = toggleRuler;
window.showCryptoDetail = showCryptoDetail;
window.showRulerInfo = showRulerInfo;
window.clearRuler = clearRuler;
window.showMarketExitPage = showMarketExitPage;
window.showTradeBotPage = showTradeBotPage;
window.toggleMAPanel = toggleMAPanel;
window.applyMASettings = applyMASettings;
window.clearAllMA = clearAllMA;
window.handlePeriodCheckboxChange = handlePeriodCheckboxChange;
window.updateMAToggleButtonState = updateMAToggleButtonState;
window.toggleMovingAverages = toggleMovingAverages;
window.toggleFibonacci = toggleFibonacci;
window.toggleRSI = toggleRSI;
window.toggleMACD = toggleMACD;

// Debug: Verificar se as funções estão disponíveis globalmente
console.log('🔧 Functions available globally:', {
    home_dashboard: typeof window.home_dashboard,
    toggleRuler: typeof window.toggleRuler,
    showCryptoDetail: typeof window.showCryptoDetail,
    showRulerInfo: typeof window.showRulerInfo,
    clearRuler: typeof window.clearRuler,
    showMarketExitPage: typeof window.showMarketExitPage,
    toggleMAPanel: typeof window.toggleMAPanel,
    applyMASettings: typeof window.applyMASettings,
    clearAllMA: typeof window.clearAllMA,
    toggleMovingAverages: typeof window.toggleMovingAverages,
    toggleFibonacci: typeof window.toggleFibonacci,
    toggleRSI: typeof window.toggleRSI,
    toggleMACD: typeof window.toggleMACD,
});

    // Add event listeners
    document.getElementById('nav-dashboard').addEventListener('click', () => home_dashboard());
    document.getElementById('nav-trade-bot').addEventListener('click', () => showTradeBotPage());
    document.getElementById('nav-portfolio').addEventListener('click', () => requireAuthThenNavigate('portfolio'));
    document.getElementById('nav-alerts').addEventListener('click', async () => {
        showPage('alerts');
        if (!state.auth?.user) {
            showNotification('Você não está logado: alertas serão salvos localmente.', 'info');
            await refreshAlerts();
        }
    });
    document.getElementById('investmentProfile').addEventListener('change', (e) => updateProfile(e.target.value));
    document.getElementById('open-settings-btn').addEventListener('click', () => openSettings());
    document.getElementById('theme-toggle-btn').addEventListener('click', () => toggleTheme());
    document.getElementById('view-toggle-btn').addEventListener('click', () => toggleViewMode());
    document.getElementById('back-to-dashboard-btn').addEventListener('click', () => showPage('dashboard'));
    document.getElementById('crypto-selector').addEventListener('change', (e) => changeCrypto(e.target.value));
    document.getElementById('ruler-btn').addEventListener('click', () => toggleRuler());
    document.getElementById('timeframe-buttons').addEventListener('click', (e) => {
        if (e.target.dataset.timeframe) {
            changeTimeframe(e.target.dataset.timeframe);
        }
    });
    document.getElementById('close-settings-btn').addEventListener('click', () => closeSettings());
    document.getElementById('save-settings-btn').addEventListener('click', () => saveSettings());
    document.getElementById('reset-settings-btn').addEventListener('click', () => resetSettings());

    initMobileNav();
});

/* ==========================================================
   Mobile Nav — Drawer Toggle + Espelhamento de Eventos
   (botões mobile disparam o correspondente desktop)
   ========================================================== */
function initMobileNav() {
    const toggleBtn = document.getElementById('mobile-nav-toggle');
    const drawer = document.getElementById('mobile-nav-drawer');

    function syncToggleIcon() {
        if (!toggleBtn) return;
        const icon = toggleBtn.querySelector('i');
        const open = drawer && !drawer.classList.contains('hidden');
        if (icon) icon.className = open ? 'fas fa-times' : 'fas fa-bars';
    }

    function closeDrawer() {
        if (drawer) drawer.classList.add('hidden');
        syncToggleIcon();
    }

    if (toggleBtn && drawer) {
        toggleBtn.addEventListener('click', () => {
            drawer.classList.toggle('hidden');
            syncToggleIcon();
        });
    }

    // Mapa de id mobile → id desktop
    const mirrorPairs = [
        ['nav-dashboard-mobile',          'nav-dashboard'],
        ['nav-trade-bot-mobile',          'nav-trade-bot'],
        ['nav-portfolio-mobile',          'nav-portfolio'],
        ['nav-alerts-mobile',             'nav-alerts'],
        ['open-ai-chat-btn-mobile',       'open-ai-chat-btn'],
        ['open-settings-btn-mobile',      'open-settings-btn'],
        ['theme-toggle-btn-mobile',       'theme-toggle-btn'],
        ['auth-login-btn-mobile',         'auth-login-btn'],
        ['auth-logout-btn-mobile',        'auth-logout-btn'],
    ];
    mirrorPairs.forEach(([mobileId, desktopId]) => {
        const mob = document.getElementById(mobileId);
        const desk = document.getElementById(desktopId);
        if (mob && desk) {
            mob.addEventListener('click', (e) => {
                e.preventDefault();
                desk.click();
                closeDrawer();
            });
        }
    });

    // Sincronizar select de perfil (mobile ↔ desktop) bidirecionalmente
    const deskProfile = document.getElementById('investmentProfile');
    const mobProfile  = document.getElementById('investmentProfile-mobile');
    if (deskProfile && mobProfile) {
        mobProfile.value = deskProfile.value;
        deskProfile.addEventListener('change', () => { mobProfile.value = deskProfile.value; });
        mobProfile.addEventListener('change',  () => { deskProfile.value = mobProfile.value; deskProfile.dispatchEvent(new Event('change')); });
    }

    // Sincronizar o contador de alertas do mobile com o desktop
    const syncAlertBadge = () => {
        const deskBadge = document.getElementById('alert-count');
        const mobBadge  = document.getElementById('alert-count-mobile');
        if (!deskBadge || !mobBadge) return;
        mobBadge.style.display = deskBadge.style.display;
        mobBadge.textContent   = deskBadge.textContent;
    };
    const observer = new MutationObserver(syncAlertBadge);
    const deskBadge = document.getElementById('alert-count');
    if (deskBadge) observer.observe(deskBadge, { attributes: true, childList: true, subtree: false, attributeFilter: ['style', 'id'] });
    syncAlertBadge();

    // Fechar drawer ao redimensionar para ≥ md
    window.addEventListener('resize', () => {
        if (window.innerWidth >= 768) closeDrawer();
    });
}

function updateDemoLockUI() {
    const banner = document.getElementById('demo-lock-banner');
    if (!banner) return;
    banner.style.display = state.auth?.user ? 'none' : 'block';
}

function wireDemoUnlockUI() {
    const btn = document.getElementById('demo-unlock-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        state.auth.redirectTo = 'dashboard';
        showPage('auth');
    });
}

function loadSettingsFromStorage() {
    const saved = localStorage.getItem('cryptoDashboardSettings');
    if (saved) {
        try {
            const settings = JSON.parse(saved);
            state.settings = { ...state.settings, ...settings };
            state.settings.updateInterval = normalizeUpdateIntervalMs(state.settings.updateInterval);
            state.investmentProfile = state.settings.profile;
        } catch (error) {
            console.error('Error loading settings from storage:', error);
        }
    }
}

async function hydrateSettingsFromUser() {
    try {
        const loaded = await loadUserSettings();
        if (loaded) {
            state.settings.updateInterval = normalizeUpdateIntervalMs(state.settings.updateInterval);
            localStorage.setItem('cryptoDashboardSettings', JSON.stringify(state.settings));
            const profileSelect = document.getElementById('investmentProfile');
            if (profileSelect) profileSelect.value = state.settings.profile;
            document.querySelectorAll('[data-timeframe]').forEach(btn => btn.classList.remove('active'));
            document.querySelector(`[data-timeframe="${state.settings.timeframe}"]`)?.classList.add('active');
        }
    } catch (error) {
        console.error('Falha ao carregar configurações do usuário:', error);
        if (!userSettingsSchemaNotified && error?.code === 'PGRST205') {
            userSettingsSchemaNotified = true;
            showNotification('Supabase: tabela user_settings não existe. Execute supabase/schema.sql no SQL Editor e recarregue.', 'error');
        }
    }
}

let dataIntervals = [];

function setDataIntervals() {
    clearAllIntervals();
    const priceInterval = normalizeUpdateIntervalMs(state.settings.updateInterval);
    state.settings.updateInterval = priceInterval;
    dataIntervals.push(setInterval(fetchCryptoData, priceInterval));
    dataIntervals.push(setInterval(fetchFearGreedIndex, CONFIG.updateIntervals.fearGreed));
    dataIntervals.push(setInterval(fetchGlobalData, CONFIG.updateIntervals.global));
    dataIntervals.push(setInterval(fetchMarketExitData, CONFIG.updateIntervals.marketExit || 300000)); // 5 minutos default
    dataIntervals.push(setInterval(() => {
        renderTradeBotCardComponent();
        if (state.currentPage === 'trade-bot') {
            loadTradeBotDashboardPage();
        }
    }, 30000));
}

function clearAllIntervals() {
    dataIntervals.forEach(interval => clearInterval(interval));
    dataIntervals = [];
}

function updateProfile(profile) {
    state.investmentProfile = profile;
    
    // Refresh recommendations if on crypto page
    if (state.currentPage === 'crypto' && state.currentCrypto) {
        loadCryptoRecommendation(state.currentCrypto);
        //Load LightweightChart (now default)
        loadLightweightChart(state.currentCrypto);
    }
    
    // Refresh dashboard recommendations
    if (state.currentPage === 'dashboard') {
        fetchCryptoData();
    }
}

function closeSettings() {
    const modal = document.getElementById("settings-modal");
    if (modal) {
        modal.classList.add("hidden");
        modal.style.display = "none";
    }
}

function showCreateAlert() {
    // TODO: Implement this function
}

// Market Exit Card Component
// Agora SINCRONA: só desenha dados. Request é responsabilidade de fetchMarketExitData().
function renderMarketExitCardComponent() {
    const container = document.getElementById('market-exit-card-container');
    if (!container) return;

    // Render (sincrono) — se dados ainda não estiverem prontos, mostra skeleton.
    renderMarketExitCard(container);

    // Click delegado no container (vale tanto para skeleton quanto para o card pronto)
    container.addEventListener('click', () => {
        showMarketExitPage();
    });
}

async function renderTradeBotCardComponent() {
    const container = document.getElementById('trade-bot-card-container');
    if (!container) return;

    await renderTradeBotCard(container);

    const card = container.querySelector('.tradebot-card');
    if (card) {
        card.addEventListener('click', () => {
            showTradeBotPage();
        });
    }
}
