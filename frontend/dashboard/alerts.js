import { state } from './state.js?v=20260828a';
import { ensureAuthReady, getSupabaseClient, isLoggedIn } from './auth.js?v=20260828a';
import { showNotification } from './ui.js?v=20260828a';
import { CONFIG } from './config.js?v=20260828a';

let alertsSchemaNotified = false;

function getAlertsStorageKey() {
    const userId = state.auth?.user?.id || 'guest';
    return `cryptoDashboardAlerts:${userId}`;
}

function readLocalAlerts() {
    try {
        const raw = localStorage.getItem(getAlertsStorageKey());
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeLocalAlerts(alerts) {
    localStorage.setItem(getAlertsStorageKey(), JSON.stringify(Array.isArray(alerts) ? alerts : []));
}

function uuid() {
    try {
        return crypto.randomUUID();
    } catch {
        return String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    }
}

function setAlertBadge(count) {
    const badge = document.getElementById('alert-count');
    if (!badge) return;
    if (!count) {
        badge.style.display = 'none';
        badge.textContent = '0';
        return;
    }
    badge.style.display = 'inline-block';
    badge.textContent = String(count);
}

function formatCondition(alert) {
    const op = alert.operator === 'gte' ? '>=' : alert.operator === 'lte' ? '<=' : alert.operator || '';
    const price = typeof alert.target_price === 'number' ? alert.target_price : Number(alert.target_price);
    const symbol = alert.crypto_symbol || '';
    return `${symbol} ${op} ${price}`;
}

function renderAlerts() {
    const container = document.getElementById('alerts-list');
    if (!container) return;

    if (!state.alerts?.length) {
        container.innerHTML = `<p class="text-gray-400 text-center py-8">Nenhum alerta configurado</p>`;
        setAlertBadge(0);
        return;
    }

    container.innerHTML = state.alerts.map(a => {
        const enabled = a.enabled !== false;
        return `
            <div class="flex items-center justify-between py-3 border-b border-gray-700">
                <div>
                    <div class="font-semibold">${formatCondition(a)}</div>
                    <div class="text-xs text-gray-400">${enabled ? 'Ativo' : 'Pausado'}${a.note ? ` • ${a.note}` : ''}</div>
                </div>
                <div class="flex items-center space-x-2">
                    <button class="nav-btn" data-alert-toggle="${a.id}">${enabled ? 'Pausar' : 'Ativar'}</button>
                    <button class="nav-btn" data-alert-delete="${a.id}">Excluir</button>
                </div>
            </div>
        `;
    }).join('');

    setAlertBadge(state.alerts.length);
}

async function fetchAlerts() {
    await ensureAuthReady();
    const supabase = getSupabaseClient();
    if (!isLoggedIn() || !supabase) {
        return readLocalAlerts();
    }

    const userId = state.auth.user.id;
    const { data, error } = await supabase
        .from('alerts')
        .select('id,user_id,crypto_id,crypto_symbol,operator,target_price,enabled,note,created_at,updated_at,last_triggered_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
}

export async function refreshAlerts() {
    try {
        state.alerts = await fetchAlerts();
        renderAlerts();
    } catch (error) {
        console.error('Falha ao carregar alertas:', error);
        if (!alertsSchemaNotified && error?.code === 'PGRST205') {
            alertsSchemaNotified = true;
            showNotification('Supabase: tabela alerts não existe. Execute supabase/schema.sql no SQL Editor e recarregue.', 'error');
            state.alerts = readLocalAlerts();
            renderAlerts();
            return;
        }
        state.alerts = readLocalAlerts();
        renderAlerts();
        showNotification('Falha ao carregar alertas do Supabase. Usando alertas locais.', 'info');
    }
}

function openAlertModal() {
    const modal = document.getElementById('alert-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.style.display = 'block';

    const cryptoSel = document.getElementById('alert-crypto');
    if (cryptoSel && !cryptoSel.dataset.ready) {
        cryptoSel.innerHTML = CONFIG.cryptos.map(c => `<option value="${c.id}">${c.name} (${c.symbol})</option>`).join('');
        cryptoSel.dataset.ready = '1';
    }
}

function closeAlertModal() {
    const modal = document.getElementById('alert-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.style.display = 'none';
}

async function createAlertFromForm() {
    await ensureAuthReady();
    const loggedIn = isLoggedIn();
    const supabase = getSupabaseClient();

    const cryptoId = document.getElementById('alert-crypto')?.value;
    const operator = document.getElementById('alert-operator')?.value;
    const priceStr = document.getElementById('alert-price')?.value;
    const note = document.getElementById('alert-note')?.value?.trim() || null;
    const enabled = Boolean(document.getElementById('alert-enabled')?.checked);

    const crypto = CONFIG.cryptos.find(c => c.id === cryptoId);
    const target_price = Number(priceStr);

    if (!crypto || !operator || !Number.isFinite(target_price)) {
        showNotification('Preencha os dados do alerta.', 'error');
        return;
    }

    const payload = {
        id: uuid(),
        user_id: state.auth.user?.id || null,
        crypto_id: crypto.id,
        crypto_symbol: crypto.symbol,
        operator,
        target_price,
        enabled,
        note,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    let savedRemote = false;
    if (loggedIn && supabase) {
        const { error } = await supabase.from('alerts').insert({
            user_id: state.auth.user.id,
            crypto_id: payload.crypto_id,
            crypto_symbol: payload.crypto_symbol,
            operator: payload.operator,
            target_price: payload.target_price,
            enabled: payload.enabled,
            note: payload.note,
            updated_at: payload.updated_at
        });
        if (!error) {
            savedRemote = true;
        } else if (!alertsSchemaNotified && error?.code === 'PGRST205') {
            alertsSchemaNotified = true;
            showNotification('Supabase: tabela alerts não existe. Execute supabase/schema.sql no SQL Editor e recarregue.', 'error');
        }
    }

    if (!savedRemote) {
        const current = readLocalAlerts();
        current.unshift(payload);
        writeLocalAlerts(current);
    }

    closeAlertModal();
    showNotification(savedRemote ? 'Alerta criado.' : 'Alerta criado localmente (offline).', 'success');
    await refreshAlerts();
}

async function deleteAlert(id) {
    await ensureAuthReady();
    const loggedIn = isLoggedIn();
    const supabase = getSupabaseClient();

    let deletedRemote = false;
    if (loggedIn && supabase) {
        const { error } = await supabase.from('alerts').delete().eq('id', id);
        if (!error) {
            deletedRemote = true;
        }
    }

    if (!deletedRemote) {
        const next = readLocalAlerts().filter(a => String(a.id) !== String(id));
        writeLocalAlerts(next);
    }

    showNotification(deletedRemote ? 'Alerta excluído.' : 'Alerta excluído localmente (offline).', 'success');
    await refreshAlerts();
}

async function toggleAlert(id) {
    await ensureAuthReady();
    const loggedIn = isLoggedIn();
    const supabase = getSupabaseClient();

    const alert = state.alerts.find(a => String(a.id) === String(id));
    if (!alert) return;

    const nextEnabled = !(alert.enabled !== false);
    let updatedRemote = false;
    if (loggedIn && supabase) {
        const { error } = await supabase
            .from('alerts')
            .update({ enabled: nextEnabled, updated_at: new Date().toISOString() })
            .eq('id', id);
        if (!error) {
            updatedRemote = true;
        }
    }

    if (!updatedRemote) {
        const current = readLocalAlerts();
        const idx = current.findIndex(a => String(a.id) === String(id));
        if (idx >= 0) {
            current[idx] = { ...current[idx], enabled: nextEnabled, updated_at: new Date().toISOString() };
            writeLocalAlerts(current);
        }
    }

    await refreshAlerts();
}

export function wireAlertsUI() {
    const createBtn = document.getElementById('create-alert-btn');
    const closeBtn = document.getElementById('close-alert-btn');
    const form = document.getElementById('alert-form');
    const list = document.getElementById('alerts-list');

    if (createBtn) createBtn.addEventListener('click', async () => {
        await ensureAuthReady();
        if (!isLoggedIn()) {
            showNotification('Você não está logado: alertas serão salvos localmente.', 'info');
        }
        openAlertModal();
    });

    if (closeBtn) closeBtn.addEventListener('click', () => closeAlertModal());

    if (form) form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await createAlertFromForm();
    });

    if (list) {
        list.addEventListener('click', async (e) => {
            const target = e.target;
            if (!(target instanceof HTMLElement)) return;

            const delId = target.getAttribute('data-alert-delete');
            const toggleId = target.getAttribute('data-alert-toggle');
            if (delId) await deleteAlert(delId);
            if (toggleId) await toggleAlert(toggleId);
        });
    }
}
