import { CONFIG } from './config.js?v=20260828a';
import { state } from './state.js?v=20260828a';
import { showNotification } from './ui.js?v=20260905hard';
import { tradeBotAuthHeaders } from './api.js?v=20260828a';

const STORAGE_KEYS = {
    sessionId: 'cdp_ai_chat_session_id_v1',
    messages: 'cdp_ai_chat_messages_v1',
    highlights: 'cdp_ai_chat_highlights_v1',
    sessionState: 'cdp_ai_chat_session_state_v1'
};

const SESSION_STATE_DEFAULTS = {
    missionCompleted: false,
    missionReason: null,
    missionConfidence: null,
    blocked: false,
    blockedReason: null,
    summary: null
};

const LIMITS = {
    maxMessages: 30,
    maxMessageChars: 4000,
    maxTotalChars: 16000,
    candleTail: 15
};

const TOOL_MAP = {
    chart: 'get_chart_snapshot',
    reco: 'get_recommendation',
    sentiment: 'get_crypto_news_sentiment',
    news: 'get_crypto_news',
    market: 'get_market_context',
    targetStop: 'get_target_stop'
};

function getStoredSessionState() {
    const base = readJsonFromStorage(STORAGE_KEYS.sessionState, { ...SESSION_STATE_DEFAULTS });
    return { ...SESSION_STATE_DEFAULTS, ...(base && typeof base === 'object' ? base : {}) };
}

function writeStoredSessionState(patch) {
    const current = getStoredSessionState();
    const next = { ...current, ...(patch && typeof patch === 'object' ? patch : {}) };
    writeJsonToStorage(STORAGE_KEYS.sessionState, next);
    return next;
}

function clearStoredSessionState() {
    writeJsonToStorage(STORAGE_KEYS.sessionState, { ...SESSION_STATE_DEFAULTS });
}

async function resetChatSessionOnBackend() {
    const sessionId = getOrCreateSessionId();
    try {
        const url = `${CONFIG.apis.chat.replace(/\/+$/, '')}/chat/reset`;
        const response = await fetch(url, {
            method: 'POST',
            headers: tradeBotAuthHeaders({
                'Content-Type': 'application/json'
            }),
            body: JSON.stringify({ sessionId })
        });
        if (!response.ok) {
            console.warn('Reset de sessao no backend falhou:', response.status);
        }
    } catch (error) {
        console.warn('Reset de sessao no backend falhou (rede):', error);
    }
}

function getOrCreateSessionId() {
    const existing = localStorage.getItem(STORAGE_KEYS.sessionId);
    if (existing) return existing;
    const id = `sess_${Math.random().toString(16).slice(2)}_${Date.now()}`;
    localStorage.setItem(STORAGE_KEYS.sessionId, id);
    return id;
}

function readJsonFromStorage(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return parsed ?? fallback;
    } catch {
        return fallback;
    }
}

function writeJsonToStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function clampString(value, maxChars) {
    if (!value) return '';
    const s = String(value);
    if (s.length <= maxChars) return s;
    return s.slice(0, maxChars) + '…';
}

function estimateTotalChars(messages) {
    return messages.reduce((sum, m) => sum + (m?.content?.length ?? 0), 0);
}

function pruneMessages(messages) {
    let pruned = Array.isArray(messages) ? messages.slice(-LIMITS.maxMessages) : [];
    pruned = pruned.map(m => ({
        role: m.role,
        content: clampString(m.content ?? '', LIMITS.maxMessageChars),
        ts: String(m.ts ?? Date.now())
    }));

    while (estimateTotalChars(pruned) > LIMITS.maxTotalChars && pruned.length > 6) {
        pruned.shift();
    }
    return pruned;
}

function el(id) {
    return document.getElementById(id);
}

function setStatus(text) {
    const node = el('ai-chat-status');
    if (node) node.textContent = text ?? '';
}

function setInputLocked(locked, reason) {
    const input = el('ai-chat-input');
    const sendBtn = el('ai-chat-send-btn');
    const clearBtn = el('ai-chat-clear-btn');
    const isLocked = Boolean(locked);

    if (input) {
        input.disabled = isLocked;
        input.readOnly = isLocked;
        input.classList.toggle('ai-chat-input-locked', isLocked);

        if (isLocked) {
            if (reason === 'mission') {
                input.placeholder = 'Análise concluída. Inicie uma nova sessão para perguntar sobre outro cenário ou ativo.';
            } else if (reason === 'blocked') {
                input.placeholder = 'Limite de interações alcançado. Limpe o histórico para continuar perguntando.';
            } else {
                input.placeholder = 'Conversa encerrada. Limpe o histórico para reiniciar.';
            }
        } else {
            input.placeholder = 'Pergunte sobre o gráfico, indicadores, recomendação atual...';
        }
    }
    if (sendBtn) {
        sendBtn.disabled = isLocked;
        sendBtn.classList.toggle('opacity-60', isLocked);
        sendBtn.classList.toggle('cursor-not-allowed', isLocked);
    }
    if (clearBtn) {
        clearBtn.classList.toggle('ai-chat-clear-btn--urgent', isLocked);
    }
}

function getBannerContainer() {
    const messagesEl = el('ai-chat-messages');
    if (!messagesEl) return null;
    const parent = messagesEl.parentNode;
    let container = parent.querySelector('#ai-chat-banners');
    if (container) return container;

    container = document.createElement('div');
    container.id = 'ai-chat-banners';
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('role', 'status');
    container.className = 'px-6 pt-4 space-y-3';
    parent.insertBefore(container, messagesEl);
    return container;
}

function triggerClearFromBanner(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    const clearBtn = el('ai-chat-clear-btn');
    if (clearBtn) {
        clearBtn.click();
    } else {
        clearMessages();
    }
}

function renderSessionBanners() {
    const container = getBannerContainer();
    if (!container) return;
    container.innerHTML = '';

    const sessionState = getStoredSessionState();
    const fragments = [];

    if (sessionState.missionCompleted) {
        const wrapper = document.createElement('div');
        wrapper.className = 'ai-chat-banner ai-chat-banner--success';
        wrapper.setAttribute('role', 'status');

        const header = document.createElement('div');
        header.className = 'ai-chat-banner__header';
        header.innerHTML = '<i class="fas fa-check-circle ai-chat-banner__icon"></i> '
            + '<span class="ai-chat-banner__title">Análise concluída com sucesso</span>';

        wrapper.appendChild(header);

        if (sessionState.missionReason) {
            const reasonEl = document.createElement('div');
            reasonEl.className = 'ai-chat-banner__reason';
            reasonEl.textContent = sessionState.missionReason;
            wrapper.appendChild(reasonEl);
        }

        const body = document.createElement('div');
        body.className = 'ai-chat-banner__body';
        body.textContent = 'Você já recebeu o panorama completo desta sessão. Para analisar outro ativo ou cenário, reinicie a conversa.';
        wrapper.appendChild(body);

        const actions = document.createElement('div');
        actions.className = 'ai-chat-banner__actions';
        const cta = document.createElement('button');
        cta.type = 'button';
        cta.className = 'ai-chat-banner__cta ai-chat-banner__cta--success';
        cta.innerHTML = '<i class="fas fa-redo-alt"></i> Limpar histórico e reiniciar';
        cta.addEventListener('click', triggerClearFromBanner);
        actions.appendChild(cta);
        wrapper.appendChild(actions);

        fragments.push(wrapper);
    }

    if (sessionState.blocked && !sessionState.missionCompleted) {
        const wrapper = document.createElement('div');
        wrapper.className = 'ai-chat-banner ai-chat-banner--warning';
        wrapper.setAttribute('role', 'alert');

        const header = document.createElement('div');
        header.className = 'ai-chat-banner__header';
        header.innerHTML = '<i class="fas fa-exclamation-triangle ai-chat-banner__icon"></i> '
            + '<span class="ai-chat-banner__title">Limite de interações alcançado</span>';
        wrapper.appendChild(header);

        const body = document.createElement('div');
        body.className = 'ai-chat-banner__body';

        if (sessionState.blockedReason === 'turn_limit_reached') {
            body.textContent = 'O número máximo de perguntas desta sessão foi atingido antes que todos os pontos fossem cobertos. Reinicie para continuar.';
        } else if (sessionState.blockedReason && typeof sessionState.blockedReason === 'string') {
            body.textContent = `${sessionState.blockedReason} Reinicie a sessão para continuar.`;
        } else {
            body.textContent = 'Esta conversa foi bloqueada temporariamente. Para fazer novas perguntas, limpe o histórico e reinicie.';
        }
        wrapper.appendChild(body);

        const actions = document.createElement('div');
        actions.className = 'ai-chat-banner__actions';
        const cta = document.createElement('button');
        cta.type = 'button';
        cta.className = 'ai-chat-banner__cta ai-chat-banner__cta--warning';
        cta.innerHTML = '<i class="fas fa-eraser"></i> Limpar histórico e continuar';
        cta.addEventListener('click', triggerClearFromBanner);
        actions.appendChild(cta);
        wrapper.appendChild(actions);

        fragments.push(wrapper);
    }

    for (const node of fragments) {
        container.appendChild(node);
    }

    const locked = Boolean(sessionState.blocked || sessionState.missionCompleted);
    const reason = sessionState.missionCompleted ? 'mission' : (sessionState.blocked ? 'blocked' : null);
    setInputLocked(locked, reason);
}

function openModal() {
    const modal = el('ai-chat-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.classList.remove('hidden');
    renderMessages();
    renderSessionBanners();
    scrollMessagesToBottom();
    const input = el('ai-chat-input');
    if (input && !input.disabled) input.focus();
}

function closeModal() {
    const modal = el('ai-chat-modal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.classList.add('hidden');
    setStatus('');
}

function scrollMessagesToBottom() {
    const list = el('ai-chat-messages');
    if (!list) return;
    list.scrollTop = list.scrollHeight;
}

function getStoredMessages() {
    return pruneMessages(readJsonFromStorage(STORAGE_KEYS.messages, []));
}

function setStoredMessages(messages) {
    writeJsonToStorage(STORAGE_KEYS.messages, pruneMessages(messages));
}

function addMessage(role, content) {
    const messages = getStoredMessages();
    messages.push({ role, content, ts: String(Date.now()) });
    setStoredMessages(messages);
    renderMessages();
    scrollMessagesToBottom();
}

function clearMessages() {
    writeJsonToStorage(STORAGE_KEYS.messages, []);
    clearStoredSessionState();
    resetChatSessionOnBackend().catch(() => {});
    renderMessages();
    renderSessionBanners();
    setStatus('');
    setInputLocked(false, null);
    el('ai-chat-input')?.focus();
}

function parseNumericText(value) {
    if (value == null) return null;
    const cleaned = String(value).replace(/[^\d.,-]/g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
}

function getMarketSnapshotNumeric() {
    const fearGreedRaw = el('fear-greed-number')?.textContent?.trim() ?? null;
    const fearGreedValue = parseNumericText(fearGreedRaw);
    const fearGreedLabel = el('fear-greed-label')?.textContent?.trim() ?? null;
    const btcDominance = parseNumericText(el('btc-dominance')?.textContent);
    const globalMarketCap = el('global-market-cap')?.textContent?.trim() ?? null;
    const globalVolume = el('global-volume')?.textContent?.trim() ?? null;

    return {
        fearGreed: fearGreedValue != null ? { value: fearGreedValue, label: fearGreedLabel } : null,
        btcDominance,
        globalMarketCap,
        globalVolume
    };
}

function getCryptoHint() {
    if (state.currentPage !== 'crypto') return null;
    const id = state.currentCrypto;
    const config = CONFIG.cryptos.find(c => c.id === id) ?? null;
    return config?.symbol ?? el('crypto-symbol')?.textContent?.trim() ?? null;
}

function summarizeCandles(candles) {
    if (!Array.isArray(candles) || candles.length === 0) return null;
    const tail = candles.slice(-LIMITS.candleTail);
    const closes = tail.map(c => Number(c?.close)).filter(v => Number.isFinite(v));
    const highs = tail.map(c => Number(c?.high)).filter(v => Number.isFinite(v));
    const lows = tail.map(c => Number(c?.low)).filter(v => Number.isFinite(v));

    const firstClose = closes[0];
    const lastClose = closes[closes.length - 1];
    const pctChange = firstClose && lastClose ? ((lastClose - firstClose) / firstClose) * 100 : null;

    const min = lows.length ? Math.min(...lows) : null;
    const max = highs.length ? Math.max(...highs) : null;

    return {
        points: tail.length,
        last: tail[tail.length - 1] ?? null,
        range: { min, max, pctChange }
    };
}

function getActiveIndicatorsFromDom() {
    const active = (btnId) => el(btnId)?.classList?.contains('active') ?? false;

    const maType = document.querySelector('input[name="ma-type"]:checked')?.value ?? null;
    const maPeriods = Array.from(document.querySelectorAll('#ma-panel input[type="checkbox"]:checked'))
        .map(input => parseInt(input.value, 10))
        .filter(v => Number.isFinite(v))
        .sort((a, b) => a - b);

    return {
        ma: { active: active('ma-toggle-btn'), type: maType, periods: maPeriods },
        fib: { active: active('fib-btn') },
        rsi: { active: active('rsi-btn') },
        macd: { active: active('macd-btn') }
    };
}

function getContextSelection() {
    return {
        chart: el('ai-chat-ctx-chart')?.checked ?? true,
        reco: el('ai-chat-ctx-reco')?.checked ?? true,
        sentiment: el('ai-chat-ctx-sentiment')?.checked ?? true,
        news: el('ai-chat-ctx-news')?.checked ?? true,
        market: el('ai-chat-ctx-market')?.checked ?? true,
        targetStop: el('ai-chat-ctx-targetstop')?.checked ?? true
    };
}

function buildAllowedTools(selection) {
    const allowed = [];
    for (const [key, toolName] of Object.entries(TOOL_MAP)) {
        if (selection[key]) allowed.push(toolName);
    }
    return allowed;
}

function buildChatPayload() {
    const selection = getContextSelection();
    const crypto = getCryptoHint();
    const context = {};

    if (selection.chart) {
        const rawData = Array.isArray(state.candlestickData) ? state.candlestickData : [];
        const limitedData = rawData.slice(-LIMITS.candleTail);
        context.chart = {
            candlesSummary: summarizeCandles(rawData),
            candlesTail: limitedData.map(c => ({ time: c.time, close: c.close })),
            indicators: getActiveIndicatorsFromDom()
        };
    }

    if (selection.market) {
        context.market = getMarketSnapshotNumeric();
    }

    return {
        hints: {
            crypto,
            model: state.settings.model,
            profile: state.settings.profile,
            page: state.currentPage,
            allowed_tools: buildAllowedTools(selection)
        },
        context: Object.keys(context).length ? context : null
    };
}

function getHighlights() {
    const list = readJsonFromStorage(STORAGE_KEYS.highlights, []);
    if (!Array.isArray(list)) return [];
    return list.slice(-30);
}

function renderMessages() {
    const list = el('ai-chat-messages');
    if (!list) return;

    const messages = getStoredMessages();
    list.innerHTML = '';

    if (messages.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'text-sm text-gray-400';
        empty.textContent = 'Faça uma pergunta como: “Explique o último sinal da IA e o que no gráfico suporta isso.”';
        list.appendChild(empty);
        return;
    }

    for (const m of messages) {
        const wrapper = document.createElement('div');
        const isUser = m.role === 'user';
        wrapper.className = `flex ${isUser ? 'justify-end' : 'justify-start'}`;

        const bubble = document.createElement('div');
        bubble.className = `${isUser ? 'bg-blue-600' : 'bg-gray-700'} text-white rounded-lg px-4 py-3 max-w-2xl whitespace-pre-wrap`;
        bubble.textContent = m.content ?? '';

        wrapper.appendChild(bubble);
        list.appendChild(wrapper);
    }
}

async function callChatApi({ messages, hints, context, highlights }) {
    const url = `${CONFIG.apis.chat.replace(/\/+$/, '')}/chat`;
    const response = await fetch(url, {
        method: 'POST',
        headers: tradeBotAuthHeaders({
            'Content-Type': 'application/json'
        }),
        body: JSON.stringify({
            sessionId: getOrCreateSessionId(),
            messages,
            hints,
            context,
            highlights
        })
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}${text ? `: ${text}` : ''}`);
    }

    const data = await response.json().catch(() => null);
    return data;
}

function extractAssistantText(apiResponse) {
    if (!apiResponse) return null;
    if (typeof apiResponse === 'string') return apiResponse;
    if (typeof apiResponse?.answer === 'string' && apiResponse.answer.trim()) return apiResponse.answer;
    if (typeof apiResponse?.content === 'string' && apiResponse.content.trim()) return apiResponse.content;
    if (typeof apiResponse?.message?.content === 'string' && apiResponse.message.content.trim()) return apiResponse.message.content;
    if (typeof apiResponse?.text === 'string' && apiResponse.text.trim()) return apiResponse.text;
    if (typeof apiResponse?.summary === 'string' && apiResponse.summary.trim()) return apiResponse.summary;
    if (typeof apiResponse?.mission?.reason === 'string' && apiResponse.mission.reason.trim()) return apiResponse.mission.reason;
    return null;
}

async function handleSend() {
    const sessionState = getStoredSessionState();
    const alreadyLocked = Boolean(sessionState.blocked || sessionState.missionCompleted);
    if (alreadyLocked) {
        renderSessionBanners();
        return;
    }

    const input = el('ai-chat-input');
    const sendBtn = el('ai-chat-send-btn');
    const text = input?.value?.trim() ?? '';
    if (!text) return;

    input.value = '';
    addMessage('user', text);

    sendBtn.disabled = true;
    sendBtn.classList.add('opacity-60');
    setStatus('Consultando IA…');

    let missionCompleted = sessionState.missionCompleted;
    let blocked = sessionState.blocked;
    let blockedReason = sessionState.blockedReason;
    let missionReason = sessionState.missionReason;
    let missionConfidence = sessionState.missionConfidence;
    let summary = sessionState.summary;
    let assistantText = null;
    let hasError = false;

    try {
        const messages = getStoredMessages();
        const { hints, context } = buildChatPayload();
        const highlights = getHighlights();

        const apiResponse = await callChatApi({ messages, hints, context, highlights });
        assistantText = extractAssistantText(apiResponse) ?? 'Nao consegui interpretar a resposta do backend.';

        if (apiResponse && typeof apiResponse === 'object') {
            const mission = apiResponse.mission;
            if (mission && typeof mission === 'object') {
                missionCompleted = Boolean(mission.completed);
                const reasonRaw = mission.reason;
                missionReason = typeof reasonRaw === 'string' && reasonRaw.trim() ? reasonRaw.trim() : null;
                if (typeof mission.confidence === 'number') {
                    missionConfidence = mission.confidence;
                } else if (mission.confidence != null) {
                    const n = Number(mission.confidence);
                    if (Number.isFinite(n)) missionConfidence = n;
                }
            }

            blocked = Boolean(apiResponse.blocked);
            const br = apiResponse.blocked_reason ?? apiResponse.blockedReason;
            blockedReason = typeof br === 'string' && br.trim() ? br.trim() : (blocked ? 'blocked' : blockedReason);

            const s = apiResponse.summary;
            summary = typeof s === 'string' && s.trim() ? s.trim() : summary;
        }

        addMessage('assistant', assistantText);
        setStatus('');
    } catch (error) {
        hasError = true;
        console.error('AI chat error:', error);
        showNotification('Falha ao consultar IA. Verifique o endpoint de chat e CORS.', 'error');
        addMessage('assistant', 'Erro ao consultar IA. Confira o endpoint de chat configurado.');
        setStatus('');
    } finally {
        writeStoredSessionState({
            missionCompleted,
            missionReason,
            missionConfidence,
            blocked,
            blockedReason,
            summary
        });
        renderSessionBanners();

        const finalState = getStoredSessionState();
        const locked = Boolean(finalState.blocked || finalState.missionCompleted);
        if (!locked && !hasError) {
            sendBtn.disabled = false;
            sendBtn.classList.remove('opacity-60');
        }
    }
}

export function initAIChat() {
    getOrCreateSessionId();

    el('open-ai-chat-btn')?.addEventListener('click', openModal);
    el('open-ai-chat-chart-btn')?.addEventListener('click', openModal);
    el('close-ai-chat-btn')?.addEventListener('click', closeModal);
    el('ai-chat-clear-btn')?.addEventListener('click', clearMessages);

    el('ai-chat-modal')?.addEventListener('click', (e) => {
        if (e.target === el('ai-chat-modal')) closeModal();
    });

    el('ai-chat-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleSend();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });

    renderMessages();
    renderSessionBanners();
}
