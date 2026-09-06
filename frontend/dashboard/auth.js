import { state } from './state.js?v=20260828a';
import { showPage } from './ui.js?v=20260905hard';
import { clearSupabaseConfig, getSupabaseConfig, setSupabaseConfig } from './supabaseRuntimeConfig.js?v=20260828a';

let supabase = null;
let authReadyResolve = null;
const authReady = new Promise((resolve) => {
    authReadyResolve = resolve;
});

function isConfigured() {
    const cfg = getSupabaseConfig();
    return Boolean(cfg?.url && cfg?.anonKey);
}

function isSecretKey(value) {
    const v = (value || '').trim();
    return v.startsWith('sb_secret_');
}

function showSupabaseConfigPanel(show) {
    const panel = document.getElementById('supabase-config-panel');
    if (!panel) return;
    panel.style.display = show ? 'block' : 'none';

    if (show) {
        const cfg = getSupabaseConfig();
        const urlInput = document.getElementById('supabase-url');
        const anonInput = document.getElementById('supabase-anon-key');
        if (urlInput && !urlInput.value) urlInput.value = cfg.url || '';
        if (anonInput && !anonInput.value) anonInput.value = cfg.anonKey || '';
    }
}

function setAuthStatusMessage(message, tone = 'info') {
    const el = document.getElementById('auth-status');
    if (!el) return;
    el.textContent = message || '';
    el.className = `text-sm ${tone === 'error' ? 'text-red-400' : tone === 'success' ? 'text-green-400' : 'text-gray-300'}`;
}

function setAuthControls() {
    const userLabel = document.getElementById('auth-user-label');
    const loginBtn = document.getElementById('auth-login-btn');
    const logoutBtn = document.getElementById('auth-logout-btn');
    const userLabelMob = document.getElementById('auth-user-label-mobile');
    const loginBtnMob = document.getElementById('auth-login-btn-mobile');
    const logoutBtnMob = document.getElementById('auth-logout-btn-mobile');

    const user = state.auth.user;
    const email = user?.email ? user.email : '';
    if (userLabel) userLabel.textContent = email;
    if (userLabelMob) userLabelMob.textContent = email;

    const loggedIn = Boolean(user);
    if (loginBtn) loginBtn.style.display = loggedIn ? 'none' : 'inline-flex';
    if (logoutBtn) logoutBtn.style.display = loggedIn ? 'inline-flex' : 'none';
    if (loginBtnMob) loginBtnMob.style.display = loggedIn ? 'none' : 'inline-flex';
    if (logoutBtnMob) logoutBtnMob.style.display = loggedIn ? 'inline-flex' : 'none';
}

function setAuthTab(mode) {
    const loginTab = document.getElementById('auth-tab-login');
    const signupTab = document.getElementById('auth-tab-signup');
    const nameRow = document.getElementById('auth-name-row');
    const termsRow = document.getElementById('auth-terms-row');
    const submitBtn = document.getElementById('auth-submit-btn');
    const modeInput = document.getElementById('auth-mode');
    const titleEl = document.getElementById('auth-title');

    const isSignup = mode === 'signup';
    if (loginTab) loginTab.classList.toggle('active', !isSignup);
    if (signupTab) signupTab.classList.toggle('active', isSignup);
    if (nameRow) nameRow.style.display = isSignup ? 'block' : 'none';
    if (termsRow) termsRow.style.display = isSignup ? 'flex' : 'none';
    if (submitBtn) submitBtn.textContent = isSignup ? 'Criar conta' : 'Entrar';
    if (modeInput) modeInput.value = isSignup ? 'signup' : 'login';
    if (titleEl) titleEl.textContent = isSignup ? 'Criar conta' : 'Entrar';
    setAuthStatusMessage('');
}

export function getSupabaseClient() {
    return supabase;
}

export function isLoggedIn() {
    return Boolean(state.auth.user);
}

export async function initAuth() {
    if (!isConfigured()) {
        authReadyResolve?.();
        setAuthControls();
        return null;
    }

    const cfg = getSupabaseConfig();
    if (isSecretKey(cfg.anonKey)) {
        console.error('Supabase anonKey inválida: parece ser uma service role key (sb_secret_).');
        supabase = null;
        clearSupabaseConfig();
        authReadyResolve?.();
        setAuthControls();
        return null;
    }

    try {
        const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
        supabase = createClient(cfg.url, cfg.anonKey, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true
            }
        });
    } catch (error) {
        console.error('Falha ao carregar Supabase client:', error);
        supabase = null;
        authReadyResolve?.();
        setAuthControls();
        return null;
    }

    const { data: { session } } = await supabase.auth.getSession();
    state.auth.session = session || null;
    state.auth.user = session?.user || null;
    setAuthControls();
    window.dispatchEvent(new CustomEvent('auth:changed', { detail: { user: state.auth.user } }));

    supabase.auth.onAuthStateChange((_event, session2) => {
        state.auth.session = session2 || null;
        state.auth.user = session2?.user || null;
        setAuthControls();
        window.dispatchEvent(new CustomEvent('auth:changed', { detail: { user: state.auth.user } }));

        if (state.auth.user && state.auth.redirectTo) {
            const dest = state.auth.redirectTo;
            state.auth.redirectTo = null;
            showPage(dest);
            return;
        }

        if (state.auth.user && state.currentPage === 'auth') {
            showPage('dashboard');
        }
    });

    authReadyResolve?.();
    return supabase;
}

export async function ensureAuthReady() {
    await authReady;
}

export async function requireAuthThenNavigate(page) {
    await ensureAuthReady();
    if (!isConfigured()) {
        state.auth.redirectTo = page;
        showPage('auth');
        setAuthTab('login');
        setAuthStatusMessage('Autenticação ainda não configurada. Configure o Supabase abaixo (Project URL + anon key).', 'error');
        showSupabaseConfigPanel(true);
        return false;
    }
    const cfg = getSupabaseConfig();
    if (isSecretKey(cfg.anonKey)) {
        state.auth.redirectTo = page;
        showPage('auth');
        setAuthTab('login');
        setAuthStatusMessage('Chave inválida: você colou uma service role key (sb_secret_). Use a anon public key (Settings → API → anon).', 'error');
        showSupabaseConfigPanel(true);
        return false;
    }
    if (isLoggedIn()) {
        showPage(page);
        return true;
    }
    state.auth.redirectTo = page;
    showPage('auth');
    setAuthTab('login');
    return false;
}

export function wireAuthUI() {
    const loginTab = document.getElementById('auth-tab-login');
    const signupTab = document.getElementById('auth-tab-signup');
    const form = document.getElementById('auth-form');
    const resetLink = document.getElementById('auth-reset-link');
    const loginBtn = document.getElementById('auth-login-btn');
    const logoutBtn = document.getElementById('auth-logout-btn');

    if (loginTab) loginTab.addEventListener('click', () => setAuthTab('login'));
    if (signupTab) signupTab.addEventListener('click', () => setAuthTab('signup'));

    if (loginBtn) loginBtn.addEventListener('click', () => {
        showPage('auth');
        setAuthTab('login');
        if (!isConfigured()) {
            setAuthStatusMessage('Autenticação ainda não configurada. Configure o Supabase abaixo (Project URL + anon key).', 'error');
            showSupabaseConfigPanel(true);
        }
    });

    if (logoutBtn) logoutBtn.addEventListener('click', async () => {
        setAuthStatusMessage('');
        if (!supabase) return;
        await supabase.auth.signOut();
        showPage('dashboard');
    });

    if (resetLink) {
        resetLink.addEventListener('click', async (e) => {
            e.preventDefault();
            await ensureAuthReady();
            if (!supabase) return;

            const email = document.getElementById('auth-email')?.value?.trim();
            if (!email) {
                setAuthStatusMessage('Informe seu email para receber o link de redefinição.', 'error');
                return;
            }

            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin + window.location.pathname
            });
            if (error) {
                setAuthStatusMessage(error.message || 'Falha ao enviar email de redefinição.', 'error');
                return;
            }
            setAuthStatusMessage('Email de redefinição enviado. Verifique sua caixa de entrada.', 'success');
        });
    }

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await ensureAuthReady();

            if (!supabase) {
                setAuthStatusMessage('Autenticação não configurada.', 'error');
                showSupabaseConfigPanel(true);
                return;
            }

            const mode = document.getElementById('auth-mode')?.value || 'login';
            const email = document.getElementById('auth-email')?.value?.trim();
            const password = document.getElementById('auth-password')?.value || '';
            const name = document.getElementById('auth-name')?.value?.trim() || '';
            const acceptedTerms = Boolean(document.getElementById('auth-terms')?.checked);

            if (!email || !password) {
                setAuthStatusMessage('Preencha email e senha.', 'error');
                return;
            }

            if (mode === 'signup' && !acceptedTerms) {
                setAuthStatusMessage('Você precisa aceitar os Termos e a Privacidade para criar a conta.', 'error');
                return;
            }

            setAuthStatusMessage('Processando...');

            if (mode === 'signup') {
                const { error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        data: { name }
                    }
                });
                if (error) {
                    setAuthStatusMessage(error.message || 'Falha ao criar conta.', 'error');
                    return;
                }
                setAuthStatusMessage('Conta criada. Se a confirmação por email estiver ativa, verifique sua caixa de entrada.', 'success');
                return;
            }

            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) {
                setAuthStatusMessage(error.message || 'Falha ao entrar.', 'error');
                return;
            }

            setAuthStatusMessage('Login efetuado.', 'success');
        });
    }

    const configSaveBtn = document.getElementById('supabase-config-save');
    const configClearBtn = document.getElementById('supabase-config-clear');
    if (configSaveBtn) {
        configSaveBtn.addEventListener('click', async () => {
            const url = document.getElementById('supabase-url')?.value?.trim() || '';
            const anonKey = document.getElementById('supabase-anon-key')?.value?.trim() || '';

            if (!url || !anonKey) {
                setAuthStatusMessage('Preencha Project URL e anon key.', 'error');
                showSupabaseConfigPanel(true);
                return;
            }
            if (isSecretKey(anonKey)) {
                setAuthStatusMessage('Chave inválida: sb_secret_ não pode ficar no frontend. Use a anon key.', 'error');
                showSupabaseConfigPanel(true);
                return;
            }

            setSupabaseConfig({ url, anonKey });
            setAuthStatusMessage('Configuração salva. Recarregando...', 'success');
            window.location.reload();
        });
    }
    if (configClearBtn) {
        configClearBtn.addEventListener('click', () => {
            clearSupabaseConfig();
            setAuthStatusMessage('Configuração removida.', 'info');
            showSupabaseConfigPanel(true);
        });
    }

    setAuthTab('login');
    setAuthControls();
    showSupabaseConfigPanel(!isConfigured());
}
