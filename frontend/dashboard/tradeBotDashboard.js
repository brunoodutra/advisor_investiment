import { fetchTradeBotDashboard, fetchTradeBotConfig, saveTradeBotConfig, toggleTradeBotStatus, emergencyCloseTradeBot, closeTradeBotPosition, fetchCandlestickData } from './api.js?v=20260828a';
import { showPage, showNotification } from './ui.js?v=20260905hard';

let cumulativeChart = null;
let historyPnlChart = null;
let dailyChart = null;
let symbolChart = null;
let reasonsChart = null;

function formatCurrency(value) {
    const number = Number(value || 0);
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(number);
}

function formatPercent(value) {
    const number = Number(value || 0);
    return `${number.toFixed(2)}%`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function toLocalDateTime(value) {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('pt-BR');
}

function getPnlClass(value) {
    if (value > 0) return 'text-green-400';
    if (value < 0) return 'text-red-400';
    return 'text-gray-300';
}

function destroyChart(chart) {
    if (chart) {
        chart.destroy();
    }
}

function chartTheme(canvas) {
    const hmi = canvas.closest('#trade-bot-page');
    return hmi
        ? { tick: '#8b949e', grid: '#30363d', legend: '#8b949e' }
        : { tick: '#8b949e', grid: '#30363d', legend: '#e5e7eb' };
}

function renderLineChart(canvasId, labels, values, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return null;
    const theme = chartTheme(canvas);
    return new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                data: values,
                borderColor: color,
                backgroundColor: `${color}22`,
                fill: true,
                tension: 0.25,
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: { ticks: { color: theme.tick }, grid: { color: theme.grid } },
                y: { ticks: { color: theme.tick }, grid: { color: theme.grid } }
            }
        }
    });
}

function renderBarChart(canvasId, labels, datasets, stacked = false) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return null;
    const theme = chartTheme(canvas);
    return new Chart(canvas, {
        type: 'bar',
        data: { labels, datasets },
        options: {
            responsive: true,
            plugins: {
                legend: { labels: { color: theme.legend } }
            },
            scales: {
                x: { stacked, ticks: { color: theme.tick }, grid: { color: theme.grid } },
                y: { stacked, ticks: { color: theme.tick }, grid: { color: theme.grid } }
            }
        }
    });
}

function renderDoughnutChart(canvasId, labels, values) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return null;
    const theme = chartTheme(canvas);
    return new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: ['#238636', '#da3633', '#d29922', '#8b949e', '#484f58', '#3fb950'],
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { labels: { color: theme.legend } }
            }
        }
    });
}

function renderOpenPositions(positions = []) {
    const container = document.getElementById('trade-bot-open-positions');
    if (!container) return;

    if (!positions.length) {
        container.innerHTML = '<p class="text-gray-400 text-center py-8">Nenhuma posição aberta.</p>';
        return;
    }

    container.innerHTML = `
        <div class="tradebot-table">
            <div class="tradebot-table-header">
                <span>Ativo</span>
                <span>Lado</span>
                <span>Entrada</span>
                <span>Atual</span>
                <span>P&L</span>
            </div>
            ${positions.map(position => `
                <div class="tradebot-table-row">
                    <span>${escapeHtml(position.symbol)}</span>
                    <span>${escapeHtml(String(position.side || '').toUpperCase())}</span>
                    <span>${position.entry_price != null ? formatCurrency(position.entry_price) : '--'}</span>
                    <span>${position.current_price != null ? formatCurrency(position.current_price) : '--'}</span>
                    <span class="${getPnlClass(Number(position.pnl_usd || 0))}">
                        ${position.pnl_usd != null ? `${formatCurrency(position.pnl_usd)} (${formatPercent(position.pnl_percent)})` : '--'}
                    </span>
                </div>
            `).join('')}
        </div>
    `;
}

function renderRecentEvents(events = []) {
    const container = document.getElementById('trade-bot-recent-events');
    if (!container) return;

    if (!events.length) {
        container.innerHTML = '<p class="text-gray-400 text-center py-8">Sem eventos recentes.</p>';
        return;
    }

    container.innerHTML = `
        <div class="tradebot-events-list">
            ${events.map(event => `
                <div class="tradebot-event-item">
                    <div class="tradebot-event-header">
                        <span class="tradebot-event-type">${escapeHtml(event.event_type)}</span>
                        <span class="text-xs text-gray-400">${toLocalDateTime(event.timestamp)}</span>
                    </div>
                    <div class="text-sm text-gray-300">${escapeHtml(event.symbol || 'GLOBAL')}</div>
                    <div class="text-xs text-gray-400">${escapeHtml(JSON.stringify(event.details || {}))}</div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderTradeBotCharts(charts = {}) {
    destroyChart(cumulativeChart);
    destroyChart(historyPnlChart);
    destroyChart(dailyChart);
    destroyChart(symbolChart);
    destroyChart(reasonsChart);

    const cumulative = charts.cumulative_pnl || [];
    const cumLabels = cumulative.map(item => toLocalDateTime(item.timestamp));
    const cumValues = cumulative.map(item => Number(item.cumulative_pnl_usd || 0));
    cumulativeChart = renderLineChart('trade-bot-cumulative-chart', cumLabels, cumValues, '#3fb950');
    historyPnlChart = renderLineChart('trade-bot-history-pnl-chart', cumLabels, cumValues, '#3fb950');

    const daily = charts.daily_realized_pnl || [];
    dailyChart = renderBarChart(
        'trade-bot-daily-chart',
        daily.map(item => item.date),
        [{
            label: 'P&L diário',
            data: daily.map(item => Number(item.pnl_usd || 0)),
            backgroundColor: daily.map(item => Number(item.pnl_usd || 0) >= 0 ? '#238636' : '#da3633'),
        }]
    );

    const bySymbol = charts.entries_by_symbol || [];
    symbolChart = renderBarChart(
        'trade-bot-symbol-chart',
        bySymbol.map(item => item.symbol),
        [
            { label: 'Buy', data: bySymbol.map(item => item.buy || 0), backgroundColor: '#238636' },
            { label: 'Sell', data: bySymbol.map(item => item.sell || 0), backgroundColor: '#da3633' },
        ],
        true
    );

    const reasons = charts.close_reasons || [];
    reasonsChart = renderDoughnutChart(
        'trade-bot-reasons-chart',
        reasons.map(item => fmtCloseReason(item.reason)),
        reasons.map(item => item.count || 0)
    );
}

function updateSummary(summary = {}) {
    const realizedPnlEl = document.getElementById('trade-bot-realized-pnl');
    const avgPnlEl = document.getElementById('trade-bot-avg-pnl');
    const winRateEl = document.getElementById('trade-bot-win-rate');
    const closedTradesEl = document.getElementById('trade-bot-closed-trades');
    const activePositionsEl = document.getElementById('trade-bot-active-positions');
    const openPnlEl = document.getElementById('trade-bot-open-pnl');
    const entryTotalEl = document.getElementById('trade-bot-entry-total');
    const entryBreakdownEl = document.getElementById('trade-bot-entry-breakdown');
    const lastUpdateEl = document.getElementById('trade-bot-last-update');

    if (realizedPnlEl) {
        realizedPnlEl.textContent = formatCurrency(summary.realized_pnl_usd);
        realizedPnlEl.className = `tb-readout__value tabular-nums ${numSignClass(Number(summary.realized_pnl_usd || 0))}`;
    }
    if (avgPnlEl) avgPnlEl.textContent = `Média por trade: ${formatPercent(summary.avg_pnl_percent)}`;
    if (winRateEl) winRateEl.textContent = formatPercent(summary.win_rate);
    if (closedTradesEl) closedTradesEl.textContent = `${summary.closed_trades || 0} trades fechados`;
    if (activePositionsEl) activePositionsEl.textContent = String(summary.active_positions || 0);
    const investedUsd = Number(summary.open_margin_usd ?? summary.open_position_value_usd ?? 0);
    const notionalUsd = Number(summary.open_position_value_usd ?? summary.exposure_usd ?? investedUsd);
    const investedEl = document.getElementById('trade-bot-invested');
    if (investedEl) investedEl.textContent = formatCurrency(investedUsd);
    const investedSub = document.getElementById('tb-invested-sub');
    if (investedSub) {
        const n = Number(summary.active_positions || 0);
        const posLabel = `${n} posiç${n === 1 ? 'ão' : 'ões'}`;
        investedSub.textContent = Math.abs(notionalUsd - investedUsd) > 0.005
            ? `${posLabel} · exposição ${formatCurrency(notionalUsd)}`
            : `${posLabel} ativas`;
    }
    if (openPnlEl) {
        openPnlEl.textContent = formatCurrency(summary.open_pnl_usd);
        openPnlEl.className = `tb-readout__value tabular-nums ${numSignClass(Number(summary.open_pnl_usd || 0))}`;
    }
    const totalEntries = Number(summary.buy_entries || 0) + Number(summary.sell_entries || 0);
    if (entryTotalEl) entryTotalEl.textContent = String(totalEntries);
    if (entryBreakdownEl) entryBreakdownEl.textContent = `${summary.buy_entries || 0} buy / ${summary.sell_entries || 0} sell`;
    if (lastUpdateEl) lastUpdateEl.textContent = toLocalDateTime(summary.last_event_at);
}

export async function renderTradeBotCard(container) {
    if (!container) return;

    const data = await fetchTradeBotDashboard();
    if (!data?.summary) {
        container.innerHTML = `
            <div class="crypto-card p-6 tradebot-card">
                <div class="text-lg font-semibold mb-2">Trade Bot</div>
                <div class="text-sm text-gray-400">Painel indisponível no momento.</div>
            </div>
        `;
        return;
    }

    const summary = data.summary;
    container.innerHTML = `
        <div class="crypto-card p-6 tradebot-card">
            <div class="flex items-center justify-between mb-4">
                <div>
                    <h3 class="text-lg font-semibold text-gray-300">Trade Bot</h3>
                    <p class="text-sm text-gray-400">Operação, lucro e eventos</p>
                </div>
                <i class="fas fa-robot text-blue-400 text-2xl"></i>
            </div>
            <div class="space-y-2 text-sm">
                <div class="flex justify-between">
                    <span class="text-gray-400">Posições abertas</span>
                    <span class="font-bold">${summary.active_positions || 0}</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-gray-400">Investido</span>
                    <span class="font-bold">${formatCurrency(summary.open_margin_usd ?? summary.open_position_value_usd)}</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-gray-400">Win rate</span>
                    <span class="font-bold">${formatPercent(summary.win_rate)}</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-gray-400">P&L realizado</span>
                    <span class="font-bold ${getPnlClass(Number(summary.realized_pnl_usd || 0))}">${formatCurrency(summary.realized_pnl_usd)}</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-gray-400">Entradas</span>
                    <span class="font-bold">${(summary.buy_entries || 0) + (summary.sell_entries || 0)}</span>
                </div>
            </div>
        </div>
    `;
}

/* ==============================================================
   TRADE BOT 2.0 — Estado, UI, renderizadores avançados
   (loadTradeBotDashboardPage e showTradeBotPage estão no final do arquivo, versão aprimorada)
   ============================================================== */

let drawdownChart = null;
let _tbUiInitialized = false;
const _tbState = {
    running: false,
    startedAt: null,
    uptimeInterval: null,
    history: [],
    activePositions: [],
    historyFilters: { q: '', side: '', outcome: '', sort: 'opened_desc', page: 1, perPage: 10, level: '' },
    openFilters: { q: '', side: '' },
    selectedOpenId: null,
    lastData: null,
    sparklineCharts: {},
    environment: null,
};

/* ---------- Utilitários ---------- */
function fmtUSD(v) { return formatCurrency(v); }
function fmtPct(v) { return formatPercent(v); }
function numSignClass(v) { const n = Number(v || 0); return n > 0 ? 'num-up' : n < 0 ? 'num-down' : 'num-flat'; }
function fmtDurationMs(ms) {
    if (!ms || ms <= 0) return '—';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(sec)}`;
    return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}
function tradeOutcome(t) {
    const pnl = Number(t?.realized_pnl_usd ?? t?.pnl_usd ?? 0);
    if (pnl > 0) return 'win';
    if (pnl < 0) return 'loss';
    return 'flat';
}

/* ---------- Sparkline por posição (LightweightCharts) ---------- */
function destroySparklines() {
    Object.values(_tbState.sparklineCharts).forEach(chart => {
        try { chart?.remove(); } catch (_) {}
    });
    _tbState.sparklineCharts = {};
}

async function renderPositionSparkline(container, pos) {
    if (!container || typeof LightweightCharts === 'undefined') return;
    const symbol = String(pos.symbol || '').replace('USDT', '');
    if (!symbol) return;

    const entry = Number(pos.entry_price || 0);
    const sl = Number(pos.stop_loss || 0);
    const tp = Number(pos.take_profit || 0);
    const cur = Number(pos.current_price ?? entry);
    const openedAt = pos.opened_at ? new Date(pos.opened_at).getTime() / 1000 : null;

    try {
        const candles = await fetchCandlestickData(symbol, '1h', 48);
        if (!candles.length) return;

        container.innerHTML = '';
        const chart = LightweightCharts.createChart(container, {
            width: container.clientWidth || 220,
            height: 72,
            layout: {
                background: { type: 'solid', color: 'transparent' },
                textColor: '#8b949e',
                fontSize: 9,
            },
            grid: {
                vertLines: { visible: false },
                horzLines: { visible: false },
            },
            rightPriceScale: { visible: false },
            timeScale: { visible: false },
            crosshair: { visible: false },
            handleScroll: false,
            handleScale: false,
        });

        // Candlestick series
        const candleSeries = chart.addCandlestickSeries({
            upColor: '#3fb950',
            downColor: '#f85149',
            borderUpColor: '#3fb950',
            borderDownColor: '#f85149',
            wickUpColor: '#3fb950',
            wickDownColor: '#f85149',
            priceLineVisible: false,
            lastValueVisible: false,
        });
        candleSeries.setData(candles);

        // Marcador de entrada (seta para cima embaixo do candle de entrada)
        if (openedAt) {
            const entryCandle = candles.find(c => c.time >= openedAt) || candles[candles.length - 1];
            if (entryCandle) {
                candleSeries.setMarkers([{
                    time: entryCandle.time,
                    position: 'belowBar',
                    color: '#d29922',
                    shape: 'arrowUp',
                    text: 'Entrada',
                    size: 1,
                }]);
            }
        }

        // SL / TP / Entry como price lines
        if (sl > 0) candleSeries.createPriceLine({ price: sl, color: '#f85149', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: false, title: '' });
        if (tp > 0) candleSeries.createPriceLine({ price: tp, color: '#3fb950', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: false, title: '' });
        if (entry > 0) candleSeries.createPriceLine({ price: entry, color: '#d29922', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Solid, axisLabelVisible: false, title: '' });

        chart.timeScale().fitContent();
        _tbState.sparklineCharts[pos.id || pos.symbol] = chart;
    } catch (e) {
        console.warn('sparkline fail', symbol, e);
    }
}
const TB_CLOSE_REASONS = {
    TAKE_PROFIT: 'Alvo atingido (take profit)',
    STOP_LOSS: 'Stop loss',
    REVERSAL: 'Sinal contrário da IA',
    REVERSAL_SIGNAL: 'Sinal contrário da IA',
    REVERSAL_IGNORED: 'Sinal contrário ignorado — posição segue até o alvo/stop',
    TARGET_GIVEBACK: 'Voltou abaixo do alvo',
    RUNNER_SELL: 'Sell depois do alvo',
    TARGET_REACHED: 'Alvo tocado — esperando Sell ou pullback',
    MANUAL: 'Fechamento manual',
    MANUAL_CLOSE: 'Fechamento manual',
    EMERGENCY_CLOSE: 'Fechamento emergencial',
    PROTECTION_FAILED: 'Falha na proteção',
    POSITION_NOT_FOUND: 'Posição não encontrada',
    UNKNOWN: '—',
};
function fmtCloseReason(reason) {
    if (!reason) return '—';
    const key = String(reason).toUpperCase();
    if (TB_CLOSE_REASONS[key]) return TB_CLOSE_REASONS[key];
    if (key.endsWith('_ERROR')) return 'Erro no fechamento';
    return String(reason);
}
function normalizePositionSide(side) {
    const v = String(side || '').toLowerCase();
    if (v === 'buy' || v === 'long') return 'buy';
    if (v === 'sell' || v === 'short') return 'sell';
    return '';
}
function tradeExitSide(t) {
    if (t?.exit_side) return String(t.exit_side).toLowerCase();
    const side = normalizePositionSide(t?.side);
    if (side === 'buy') return 'sell';
    if (side === 'sell') return 'buy';
    return '';
}
function tradeCycleHtml(t) {
    const entry = normalizePositionSide(t?.side) || 'buy';
    const exit = tradeExitSide(t) || (entry === 'buy' ? 'sell' : 'buy');
    return `
      <span class="tb-cycle" title="Entrada ${entry.toUpperCase()} → saída ${exit.toUpperCase()} (posição fechada)">
        <span class="tb-cycle__leg tb-cycle__leg--${entry}">${entry.toUpperCase()}</span>
        <span class="tb-cycle__arrow" aria-hidden="true">→</span>
        <span class="tb-cycle__leg tb-cycle__leg--${exit}">${exit.toUpperCase()}</span>
      </span>
      <div class="tb-cycle__hint">fechado</div>
    `;
}
function downloadCSV(filename, rows) {
    if (!rows?.length) return;
    const headers = Object.keys(rows[0]);
    const esc = (v) => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Tabs ---------- */
function initTabs() {
    const tabBtns = Array.from(document.querySelectorAll('[data-tb-tab]'));
    const tabPanels = document.querySelectorAll('[data-tb-panel]');
    const page = document.getElementById('trade-bot-page');
    const activate = (btn, focus = false) => {
        const name = btn.dataset.tbTab;
        tabBtns.forEach(b => { b.classList.toggle('active', b === btn); b.setAttribute('aria-selected', b === btn ? 'true' : 'false'); });
        tabPanels.forEach(p => p.classList.toggle('active', p.dataset.tbPanel === name));
        if (page) page.dataset.activeTab = name;
        if (focus) btn.focus();
    };
    tabBtns.forEach((btn, i) => {
        btn.addEventListener('click', () => activate(btn));
        btn.addEventListener('keydown', (e) => {
            let next = null;
            if (e.key === 'ArrowRight') next = tabBtns[(i + 1) % tabBtns.length];
            else if (e.key === 'ArrowLeft') next = tabBtns[(i - 1 + tabBtns.length) % tabBtns.length];
            else if (e.key === 'Home') next = tabBtns[0];
            else if (e.key === 'End') next = tabBtns[tabBtns.length - 1];
            if (next) { e.preventDefault(); activate(next, true); }
        });
    });
}

/* ---------- Modo de operação (PAPER/REAL · mercado) ---------- */
function fmtMarketMode(market) {
    const m = String(market || '').toUpperCase();
    if (m === 'FUTURES') return 'FUTUROS';
    if (m === 'SPOT') return 'SPOT';
    return m || '';
}

function applyModeBadge(badgeEl, labelEl, env) {
    if (!badgeEl || !labelEl) return;
    badgeEl.classList.remove('tb-mode-badge--paper', 'tb-mode-badge--real', 'tb-mode-badge--unknown');
    const tradingRaw = String(env?.trading_mode || '').toUpperCase();
    if (!env || !tradingRaw) {
        badgeEl.classList.add('tb-mode-badge--unknown');
        labelEl.textContent = 'Modo —';
        badgeEl.title = 'Modo de operação indisponível — a API não informou o ambiente do bot.';
        return;
    }
    // exchange_client.py: is_paper = TRADING_MODE == "PAPER" — qualquer outro valor opera de verdade
    const isPaper = tradingRaw === 'PAPER';
    const market = fmtMarketMode(env.market_mode);
    badgeEl.classList.add(isPaper ? 'tb-mode-badge--paper' : 'tb-mode-badge--real');
    labelEl.textContent = market ? `${tradingRaw} · ${market}` : tradingRaw;
    badgeEl.title = isPaper
        ? 'Modo simulação (TRADING_MODE=PAPER): nenhuma ordem vai para a Binance.'
        : `MODO REAL (${tradingRaw}): ordens executam na Binance com saldo de verdade.`;
}

function fmtModeShort() {
    const env = _tbState.environment;
    const trading = String(env?.trading_mode || '').toUpperCase();
    if (!trading) return '';
    const market = fmtMarketMode(env.market_mode);
    return market ? `${trading} · ${market}` : trading;
}

/* ---------- Banner persistente de comando (Logs & Eventos) ---------- */
function pushCommandBanner({ level = 'warn', title = '', detail = '' } = {}) {
    const container = document.getElementById('tb-command-banner');
    if (!container) return;
    const mode = fmtModeShort();
    const stamp = new Date().toLocaleString('pt-BR');
    const item = document.createElement('div');
    item.className = `tb-cmd-banner__item tb-cmd-banner__item--${level}`;
    item.setAttribute('role', 'status');
    item.innerHTML = `
        <span class="tb-cmd-banner__dot" aria-hidden="true"></span>
        <div class="tb-cmd-banner__body">
            <div class="tb-cmd-banner__title">${escapeHtml(title)}</div>
            <div class="tb-cmd-banner__meta">${escapeHtml([detail, stamp, mode].filter(Boolean).join(' · '))}</div>
        </div>
        <button class="tb-cmd-banner__dismiss" type="button" aria-label="Dispensar aviso">&times;</button>
    `;
    item.querySelector('.tb-cmd-banner__dismiss')?.addEventListener('click', () => {
        item.remove();
        if (!container.querySelector('.tb-cmd-banner__item')) container.hidden = true;
    });
    container.prepend(item);
    const items = container.querySelectorAll('.tb-cmd-banner__item');
    for (let i = 3; i < items.length; i++) items[i].remove();
    container.hidden = false;
}

/* ---------- Modal de confirmação de comando destrutivo ---------- */
const _tbConfirm = { resolve: null, lastTrigger: null };

function initConfirmModal() {
    const modal = document.getElementById('tb-confirm-modal');
    if (!modal) return;
    const closeBtn = document.getElementById('tb-confirm-close');
    const cancelBtn = document.getElementById('tb-confirm-cancel');
    const acceptBtn = document.getElementById('tb-confirm-accept');

    const settle = (accepted) => {
        if (modal.classList.contains('hidden')) return;
        modal.classList.add('hidden');
        const resolve = _tbConfirm.resolve;
        _tbConfirm.resolve = null;
        const trigger = _tbConfirm.lastTrigger;
        _tbConfirm.lastTrigger = null;
        if (trigger && typeof trigger.focus === 'function' && document.contains(trigger)) trigger.focus();
        if (resolve) resolve(accepted);
    };

    closeBtn?.addEventListener('click', () => settle(false));
    cancelBtn?.addEventListener('click', () => settle(false));
    acceptBtn?.addEventListener('click', () => settle(true));
    modal.addEventListener('click', (e) => { if (e.target === modal) settle(false); });
    document.addEventListener('keydown', (e) => {
        if (modal.classList.contains('hidden')) return;
        if (e.key === 'Escape') { e.preventDefault(); settle(false); return; }
        if (e.key !== 'Tab') return;
        const focusables = Array.from(modal.querySelectorAll('button:not(:disabled)'));
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
}

function openTbConfirm({ title, stats = [], note = '', acceptLabel = 'Confirmar', trigger = null } = {}) {
    const modal = document.getElementById('tb-confirm-modal');
    if (!modal) return Promise.resolve(false);
    const titleEl = document.getElementById('tb-confirm-title');
    const statsEl = document.getElementById('tb-confirm-stats');
    const noteEl = document.getElementById('tb-confirm-note');
    const acceptBtn = document.getElementById('tb-confirm-accept');
    const cancelBtn = document.getElementById('tb-confirm-cancel');

    if (titleEl) titleEl.textContent = title || 'Confirmar comando';
    if (acceptBtn) acceptBtn.textContent = acceptLabel;
    if (noteEl) noteEl.textContent = note;
    if (statsEl) {
        statsEl.innerHTML = stats.map(([label, value, valueClass]) => `
            <div>
                <dt>${escapeHtml(label)}</dt>
                <dd${valueClass ? ` class="${escapeHtml(valueClass)}"` : ''}>${escapeHtml(value)}</dd>
            </div>
        `).join('');
    }
    applyModeBadge(
        document.getElementById('tb-confirm-mode-badge'),
        document.getElementById('tb-confirm-mode-label'),
        _tbState.environment
    );

    return new Promise((resolve) => {
        _tbConfirm.resolve = resolve;
        _tbConfirm.lastTrigger = trigger || document.activeElement;
        modal.classList.remove('hidden');
        (cancelBtn || acceptBtn)?.focus();
    });
}

/* ---------- Master toggle (ligar/desligar bot) ---------- */
function setBotStatus(status, startedAt = null) {
    const pill = document.getElementById('tb-status-pill');
    const label = pill?.querySelector('.tb-status-label');
    const iconChip = document.getElementById('tb-hero-icon');
    const btn = document.getElementById('tb-master-toggle');
    const btnLabel = document.getElementById('tb-master-toggle-label');
    const btnIcon = document.getElementById('tb-master-toggle-icon');

    const allowed = ['running', 'paused', 'offline', 'error'];
    if (!allowed.includes(status)) status = 'offline';
    pill?.classList.remove('tb-status--running', 'tb-status--paused', 'tb-status--offline', 'tb-status--error');
    pill?.classList.add(`tb-status--${status}`);
    if (label) {
        label.textContent = status === 'running' ? 'Ao vivo' : status === 'paused' ? 'Pausado' : status === 'error' ? 'Erro' : 'Offline';
    }
    const running = status === 'running';
    _tbState.running = running;
    _tbState.startedAt = startedAt || (running ? new Date() : null);
    updateUptime();
    if (_tbState.uptimeInterval) clearInterval(_tbState.uptimeInterval);
    if (running) _tbState.uptimeInterval = setInterval(updateUptime, 1000);

    if (btn) {
        btn.setAttribute('aria-pressed', String(running));
        if (btnLabel) btnLabel.textContent = running ? 'Pausar Bot' : 'Ligar Bot';
        if (btnIcon) btnIcon.className = running ? 'fas fa-pause' : 'fas fa-play';
    }
    if (iconChip) {
        iconChip.classList.remove('tb-lamp--running', 'tb-lamp--paused', 'tb-lamp--offline', 'tb-lamp--error', 'icon-green', 'icon-yellow', 'icon-red', 'icon-blue');
        iconChip.classList.add(`tb-lamp--${status}`);
    }
}
function updateUptime() {
    const el = document.getElementById('tb-hero-uptime');
    if (!el) return;
    if (!_tbState.running || !_tbState.startedAt) { el.textContent = '00:00:00'; return; }
    el.textContent = fmtDurationMs(Date.now() - _tbState.startedAt.getTime());
}
function initMasterToggle() {
    const toggle = document.getElementById('tb-master-toggle');
    const emergency = document.getElementById('tb-emergency-close');
    toggle?.addEventListener('click', async () => {
        const nextRunning = !_tbState.running;
        const targetStatus = nextRunning ? 'running' : 'paused';
        try {
            toggle.disabled = true;
            toggle.classList.add('opacity-75', 'cursor-not-allowed');
            const res = await toggleTradeBotStatus(targetStatus);
            const isNowRunning = res.status === 'running';
            setBotStatus(res.status, res.config?.started_at ? new Date(res.config.started_at) : (isNowRunning ? new Date() : null));
            showNotification(isNowRunning ? 'Trade Bot ativado com sucesso! Operações em andamento.' : 'Trade Bot pausado com sucesso. Nenhuma nova ordem será aberta.', isNowRunning ? 'success' : 'info');
        } catch (err) {
            console.error('Erro ao alternar status do Trade Bot:', err);
            showNotification(`Erro ao alterar status do bot: ${err.message || 'Falha de comunicação'}`, 'error');
        } finally {
            toggle.disabled = false;
            toggle.classList.remove('opacity-75', 'cursor-not-allowed');
        }
    });
    emergency?.addEventListener('click', async () => {
        const positions = Array.isArray(_tbState.activePositions) ? _tbState.activePositions : [];
        const summary = _tbState.lastData?.summary || {};
        const exposure = Number(summary.open_position_value_usd || summary.exposure_usd || 0)
            || positions.reduce((sum, p) => sum + (Number(p.position_value_usd) || (Number(p.quantity || 0) * Number(p.current_price ?? p.entry_price ?? 0)) || 0), 0);
        const invested = Number(summary.open_margin_usd ?? 0)
            || positions.reduce((sum, p) => sum + Number(p.margin_used_usd ?? p.position_value_usd ?? 0), 0);
        const openPnl = Number(summary.open_pnl_usd ?? positions.reduce((sum, p) => sum + Number(p.pnl_usd || 0), 0));

        const accepted = await openTbConfirm({
            title: 'Fechar todas as posições',
            trigger: emergency,
            stats: [
                ['Posições abertas', String(positions.length)],
                ['Investido', fmtUSD(invested)],
                ['Exposição total', fmtUSD(exposure)],
                ['P&L aberto', fmtUSD(openPnl), numSignClass(openPnl)],
                ['Estado após', 'Bot pausado'],
            ],
            note: positions.length
                ? 'O bot envia o fechamento imediato de TODAS as posições para a exchange e pausa novas entradas. O resultado fica registrado em Logs & Eventos.'
                : 'Sem posições abertas no momento — este comando pausa o bot e impede novas entradas.',
            acceptLabel: positions.length ? 'Fechar tudo agora' : 'Pausar bot',
        });
        if (!accepted) return;

        try {
            emergency.disabled = true;
            emergency.classList.add('opacity-75', 'cursor-not-allowed');
            const res = await emergencyCloseTradeBot();
            setBotStatus('paused');
            const msg = res.queued
                ? 'Fechamento emergencial enfileirado. O bot vai zerar as posições na exchange e pausar novas entradas.'
                : `Fechamento emergencial executado. Posições encerradas: ${res.closed_positions ?? res.closed_count ?? 0}`;
            showNotification(msg, 'warning');
            pushCommandBanner({
                level: 'warn',
                title: 'Fechamento emergencial',
                detail: res.queued
                    ? `Comando${res.command_id ? ` #${res.command_id}` : ''} enfileirado · ${positions.length} posiç${positions.length === 1 ? 'ão' : 'ões'} · exposição ${fmtUSD(exposure)} · bot pausado`
                    : `Executado · ${res.closed_positions ?? res.closed_count ?? 0} posições encerradas · bot pausado`,
            });
            await loadTradeBotDashboardPage();
        } catch (err) {
            console.error('Erro no fechamento emergencial:', err);
            showNotification(`Erro ao fechar posições: ${err.message || 'Falha na requisição'}`, 'error');
            pushCommandBanner({
                level: 'error',
                title: 'Falha no fechamento emergencial',
                detail: err.message || 'Falha na requisição',
            });
        } finally {
            emergency.disabled = false;
            emergency.classList.remove('opacity-75', 'cursor-not-allowed');
        }
    });
}

/* ---------- Modal detalhe trade ---------- */
function initModal() {
    const modal = document.getElementById('tb-trade-detail-modal');
    const close = document.getElementById('tb-modal-close');
    close?.addEventListener('click', () => modal?.classList.add('hidden'));
    modal?.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) modal.classList.add('hidden');
    });
}
function openTradeDetailModal(trade) {
    const modal = document.getElementById('tb-trade-detail-modal');
    const title = document.getElementById('tb-modal-title');
    const body  = document.getElementById('tb-modal-body');
    if (!modal || !trade) return;

    const outcome = tradeOutcome(trade);
    const pnl = Number(trade?.realized_pnl_usd ?? trade?.pnl_usd ?? 0);
    const pnlPct = Number(trade?.realized_pnl_percent ?? trade?.pnl_percent ?? 0);
    const duration = trade.opened_at && trade.closed_at ? fmtDurationMs(new Date(trade.closed_at) - new Date(trade.opened_at)) : '—';
    const mkt = trade.market_context || {};
    const marketChips = [
        ['Fear & Greed', mkt.fear_and_greed != null ? `${mkt.fear_and_greed}` : '—'],
        ['BTC 24h',     mkt.btc_change_24h != null ? `${(+mkt.btc_change_24h).toFixed(2)}%` : '—'],
        ['Volatilidade', mkt.volatility != null ? `${(+mkt.volatility).toFixed(2)}%` : '—'],
        ['Tendência',    mkt.trend || '—'],
        ['Alcance/Compra', mkt.risk_on ? 'Risk ON' : (mkt.risk_on === false ? 'Risk OFF' : '—')],
    ];

    title.textContent = `${trade.symbol || '—'} · ciclo fechado`;
    body.innerHTML = `
      <div class="flex items-center gap-2 flex-wrap">
        ${tradeCycleHtml(trade)}
        <span class="tb-pill-outcome ${outcome === 'flat' ? '' : outcome}">
          ${outcome === 'win' ? 'LUCRO' : outcome === 'loss' ? 'PREJUÍZO' : 'EMPATE'}
        </span>
        <span class="text-sm text-gray-400 tabular-nums">ID: ${escapeHtml(trade.id || trade.symbol)}</span>
      </div>
      <div class="tb-modal-grid">
        <div class="stat"><div class="lbl">Preço Entrada</div><div class="val">${fmtUSD(trade.entry_price)}</div></div>
        <div class="stat"><div class="lbl">Preço Saída</div><div class="val">${Number(trade.exit_price || trade.current_price || 0) > 0 ? fmtUSD(trade.exit_price ?? trade.current_price) : '—'}</div></div>
        <div class="stat"><div class="lbl">Stop Loss</div><div class="val">${fmtUSD(trade.stop_loss)}</div></div>
        <div class="stat"><div class="lbl">Take Profit</div><div class="val">${fmtUSD(trade.take_profit)}</div></div>
        <div class="stat"><div class="lbl">P&amp;L (USD)</div><div class="val ${numSignClass(pnl)}">${fmtUSD(pnl)}</div></div>
        <div class="stat"><div class="lbl">P&amp;L (%)</div><div class="val ${numSignClass(pnlPct)}">${fmtPct(pnlPct)}</div></div>
        <div class="stat"><div class="lbl">Aberto em</div><div class="val">${toLocalDateTime(trade.opened_at)}</div></div>
        <div class="stat"><div class="lbl">Fechado em</div><div class="val">${toLocalDateTime(trade.closed_at || trade.exit_at) || '—'}</div></div>
        <div class="stat"><div class="lbl">Duração</div><div class="val">${duration}</div></div>
        <div class="stat"><div class="lbl">Motivo Saída</div><div class="val">${escapeHtml(fmtCloseReason(trade.exit_reason || trade.close_reason))}</div></div>
      </div>

      ${mkt && Object.keys(mkt).length ? `
        <div class="tb-modal-section-title">Situação do Mercado (momento do trade)</div>
        <div class="tb-market-snapshot">
          ${marketChips.map(([lbl, val]) => `<div class="tb-mkt-chip"><div class="lbl">${lbl}</div><div class="val">${escapeHtml(String(val))}</div></div>`).join('')}
        </div>` : ''}

      ${(trade.rationale || trade.signal_reason || trade.note) ? `
        <div class="tb-modal-section-title">Razão / Observações</div>
        <div class="tb-mkt-chip" style="padding:0.75rem 0.9rem;line-height:1.55;">
          <div class="val" style="font-weight:500;white-space:pre-wrap;">${escapeHtml(trade.rationale || trade.signal_reason || trade.note || '')}</div>
        </div>` : ''}
    `;
    modal.classList.remove('hidden');
}

/* ---------- Tabela: posições abertas (RICA, com barra TP/SL) ---------- */
function renderOpenPositionsRich(positions = []) {
    const container = document.getElementById('trade-bot-open-positions');
    const tabContainer = document.getElementById('trade-bot-open-positions-tab');
    _tbState.activePositions = positions;

    const side = (_tbState.openFilters.side || '').toUpperCase();
    const q = (_tbState.openFilters.q || '').trim().toLowerCase();
    let filtered = positions.filter(p => {
        if (side && String(p.side || '').toUpperCase() !== side) return false;
        if (q && !(p.symbol || '').toLowerCase().includes(q)) return false;
        return true;
    });

    const badge = document.getElementById('tb-tab-open-count');
    if (badge) {
        badge.textContent = String(positions.length);
        badge.classList.toggle('hidden', positions.length === 0);
    }
    const subEl = document.getElementById('tb-open-pnl-sub');
    if (subEl) subEl.textContent = `${positions.length} posiç${positions.length === 1 ? 'ão' : 'ões'} ativa${positions.length === 1 ? '' : 's'}`;

    const emptyHtml = `<p class="text-gray-400 text-center py-8">${positions.length === 0 ? 'Nenhuma posição aberta.' : 'Nenhuma posição corresponde ao filtro.'}</p>`;
    const tableHtml = !filtered.length ? emptyHtml : `
      <table class="tb-open-table">
        <thead><tr>
          <th>Ativo</th><th>Lado</th><th>Entrada / Atual</th>
          <th>Preço (48h)</th>
          <th>Progresso SL → TP</th>
          <th>P&amp;L</th><th>Aberto há</th><th></th>
        </tr></thead>
        <tbody>
          ${filtered.map(p => {
            const entry = Number(p.entry_price || 0);
            const cur = Number(p.current_price ?? p.exit_price ?? entry);
            const sl = Number(p.stop_loss || 0);
            const tp = Number(p.take_profit || 0);
            const pnl = Number(p.pnl_usd || 0);
            const pnlPct = Number(p.pnl_percent || 0);
            const isShort = String(p.side || '').toLowerCase() === 'short';
            let progress = 0.5;
            if (entry && sl && tp) {
                const total = Math.abs(tp - sl);
                const distSL = Math.abs(cur - sl);
                if (total > 0) progress = Math.max(0, Math.min(1, distSL / total));
            }
            const selected = _tbState.selectedOpenId === p.id;
            if (selected) _tbState.selectedOpenId = p.id;
            const openDur = p.opened_at ? fmtDurationMs(Date.now() - new Date(p.opened_at).getTime()) : '—';
            return `
              <tr data-id="${escapeHtml(p.id || p.symbol)}" class="${selected ? 'tb-row-selected' : ''}" data-pos-index="${filtered.indexOf(p)}">
                <td>
                  <div class="font-semibold text-base">${escapeHtml(p.symbol || '—')}</div>
                  <div class="text-xs text-gray-400">Qtd: ${escapeHtml(String(p.quantity ?? p.size ?? '—'))}</div>
                  <div class="text-xs text-gray-400 tabular-nums">Inv: ${fmtUSD(p.margin_used_usd ?? p.position_value_usd)}</div>
                  ${p.target_reached ? '<div class="text-xs text-yellow-400">Alvo tocado · esperando Sell</div>' : ''}
                </td>
                <td><span class="tb-side-pill ${isShort ? 'short' : 'long'}">
                    <i class="fas ${isShort ? 'fa-arrow-down' : 'fa-arrow-up'}"></i>
                    ${String(p.side || 'LONG').toUpperCase()}
                </span></td>
                <td>
                  <div class="tabular-nums text-sm">
                    <div><span class="text-gray-400">Ent: </span>${fmtUSD(entry)}</div>
                    <div><span class="text-gray-400">Atu: </span><span class="${numSignClass(cur - entry)}">${fmtUSD(cur)}</span></div>
                  </div>
                </td>
                <td>
                  <div class="tb-sparkline" data-spark-symbol="${escapeHtml(p.symbol || '')}"></div>
                </td>
                <td>
                  <div class="tb-tpsl">
                    <span class="tb-tpsl-label sl">SL ${fmtUSD(sl)}</span>
                    <span class="tb-tpsl-label tp">TP ${fmtUSD(tp)}</span>
                    <div class="tb-tpsl-track"><div class="tb-tpsl-fill" style="left:0;width:${(progress * 100).toFixed(2)}%;"></div></div>
                    <div class="tb-tpsl-dot" style="left:${(progress * 100).toFixed(2)}%;"></div>
                  </div>
                </td>
                <td>
                  <div class="font-bold tabular-nums ${numSignClass(pnl)}">${fmtUSD(pnl)}</div>
                  <div class="text-xs tabular-nums ${numSignClass(pnlPct)}">${fmtPct(pnlPct)}</div>
                </td>
                <td class="text-sm text-gray-400 tabular-nums">${openDur}</td>
                <td class="text-right">
                  <div class="flex gap-1.5 justify-end">
                    <button class="tb-action-btn" data-action="detail" title="Detalhes"><i class="fas fa-eye"></i></button>
                    <button class="tb-action-btn" data-action="tp" title="Mover TP"><i class="fas fa-flag"></i></button>
                    <button class="tb-action-btn danger" data-action="close" title="Fechar posição"><i class="fas fa-times"></i></button>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;

    if (container) container.innerHTML = tableHtml;
    if (tabContainer) tabContainer.innerHTML = tableHtml;

    // Render sparklines após o DOM estar pronto
    destroySparklines();
    filtered.forEach(p => {
        const el = document.querySelector(`.tb-sparkline[data-spark-symbol="${CSS.escape(p.symbol || '')}"]`);
        if (el) renderPositionSparkline(el, p);
    });

    // Não seleciona automaticamente — espera o usuário clicar
    renderOpenDetailPanel(null);

    [container, tabContainer].forEach(c => {
        if (!c) return;
        c.querySelectorAll('tbody tr').forEach(row => {
            row.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-action]');
                const idx = Number(row.dataset.posIndex || 0);
                const pos = filtered[idx];
                if (btn) {
                    const action = btn.dataset.action;
                    if (action === 'detail') openTradeDetailModal(pos);
                    if (action === 'close') {
                        const posPnl = Number(pos?.pnl_usd || 0);
                        openTbConfirm({
                            title: `Fechar ${pos?.symbol || 'posição'}`,
                            trigger: btn,
                            stats: [
                                ['Lado', String(pos?.side || 'LONG').toUpperCase()],
                                ['Entrada', fmtUSD(Number(pos?.entry_price || 0))],
                                ['Atual', fmtUSD(Number(pos?.current_price ?? pos?.entry_price ?? 0))],
                                ['P&L aberto', fmtUSD(posPnl), numSignClass(posPnl)],
                            ],
                            note: 'A posição é fechada a mercado na exchange. O bot segue operando os demais pares.',
                            acceptLabel: 'Fechar posição',
                        }).then(async (accepted) => {
                            if (!accepted) return;
                            try {
                                const res = await closeTradeBotPosition(pos.symbol);
                                showNotification(res.queued ? `Fechamento de ${pos.symbol} enfileirado.` : 'Solicitação enviada.', 'info');
                                pushCommandBanner({
                                    level: 'warn',
                                    title: `Fechar ${pos.symbol}`,
                                    detail: res.queued
                                        ? `Comando${res.command_id ? ` #${res.command_id}` : ''} enfileirado · P&L aberto ${fmtUSD(posPnl)}`
                                        : 'Solicitação enviada à exchange',
                                });
                                await loadTradeBotDashboardPage();
                            } catch (err) {
                                showNotification(`Erro ao fechar ${pos?.symbol}: ${err.message || 'Falha na requisição'}`, 'error');
                                pushCommandBanner({
                                    level: 'error',
                                    title: `Falha ao fechar ${pos?.symbol}`,
                                    detail: err.message || 'Falha na requisição',
                                });
                            }
                        });
                    }
                    if (action === 'tp') showNotification('Edição de TP/SL será integrada ao backend em breve.', 'info');
                    return;
                }
                _tbState.selectedOpenId = pos?.id ?? null;
                // Sincroniza seleção em ambas as tabelas
                [container, tabContainer].forEach(cc => {
                    cc?.querySelectorAll('tbody tr').forEach(r => {
                        r.classList.toggle('tb-row-selected', r.dataset.id === String(pos?.id || pos?.symbol));
                    });
                });
                renderOpenDetailPanel(pos);
            });
        });
    });
}
/* ---------- Open detail panel (lado direito) ---------- */
function renderOpenDetailPanel(pos) {
    const el = document.getElementById('tb-open-detail');
    const elTab = document.getElementById('tb-open-detail-tab');
    const html = !pos
        ? `<p class="text-sm text-gray-400 text-center py-10">Selecione uma posição para ver o contexto completo, gráfico de entrada e situação do mercado no momento do trade.</p>`
        : (() => {
            const entry = Number(pos.entry_price || 0);
            const cur = Number(pos.current_price ?? pos.exit_price ?? entry);
            const sl = Number(pos.stop_loss || 0);
            const tp = Number(pos.take_profit || 0);
            const pnl = Number(pos.pnl_usd || 0);
            const pnlPct = Number(pos.pnl_percent || 0);
            const mkt = pos.market_context || {};
            const chips = [
                ['Fear & Greed', mkt.fear_and_greed != null ? `${mkt.fear_and_greed}` : '—'],
                ['BTC 24h',     mkt.btc_change_24h != null ? `${(+mkt.btc_change_24h).toFixed(2)}%` : '—'],
                ['Volatilidade', mkt.volatility != null ? `${(+mkt.volatility).toFixed(2)}%` : '—'],
                ['Tendência',    mkt.trend || '—'],
            ];
            const rr = sl && tp ? `1:${(Math.abs(tp - entry) / Math.max(0.0001, Math.abs(entry - sl))).toFixed(2)}` : '—';
            return `
              <div class="flex items-center gap-2 mb-4 flex-wrap">
                <span class="text-lg font-bold">${escapeHtml(pos.symbol || '—')}</span>
                <span class="tb-side-pill ${String(pos.side || '').toLowerCase() === 'short' ? 'short' : 'long'}">${String(pos.side || 'LONG').toUpperCase()}</span>
              </div>
              <div class="grid grid-cols-2 gap-2 mb-4">
                <div class="tb-adv-kpi" style="padding:.6rem .7rem;"><span class="tb-adv-kpi__label">Entrada</span><span class="tb-adv-kpi__value tabular-nums">${fmtUSD(entry)}</span></div>
                <div class="tb-adv-kpi" style="padding:.6rem .7rem;"><span class="tb-adv-kpi__label">Atual</span><span class="tb-adv-kpi__value tabular-nums ${numSignClass(cur-entry)}">${fmtUSD(cur)}</span></div>
                <div class="tb-adv-kpi" style="padding:.6rem .7rem;"><span class="tb-adv-kpi__label">Stop Loss</span><span class="tb-adv-kpi__value tabular-nums" style="color:#f85149;">${fmtUSD(sl)}</span></div>
                <div class="tb-adv-kpi" style="padding:.6rem .7rem;"><span class="tb-adv-kpi__label">Take Profit</span><span class="tb-adv-kpi__value tabular-nums" style="color:#3fb950;">${fmtUSD(tp)}</span></div>
                <div class="tb-adv-kpi" style="padding:.6rem .7rem;"><span class="tb-adv-kpi__label">P&amp;L</span><span class="tb-adv-kpi__value tabular-nums ${numSignClass(pnl)}">${fmtUSD(pnl)}</span></div>
                <div class="tb-adv-kpi" style="padding:.6rem .7rem;"><span class="tb-adv-kpi__label">Risco/Retorno</span><span class="tb-adv-kpi__value tabular-nums">${rr}</span></div>
              </div>
              <div class="tb-modal-section-title" style="margin-top:.25rem;">PnL (%)</div>
              <div class="mb-4 font-bold text-xl tabular-nums ${numSignClass(pnlPct)}">${fmtPct(pnlPct)}</div>
              <div class="tb-modal-section-title">Mercado (momento entrada)</div>
              <div class="space-y-2 mb-4">
                ${chips.map(([l,v]) => `<div class="tb-mkt-row tb-mkt-chip"><span class="lbl">${l}</span><span class="val">${escapeHtml(String(v))}</span></div>`).join('')}
              </div>
              <div class="tb-modal-section-title">Razão</div>
              <p class="text-sm text-gray-300 leading-relaxed mb-4">${escapeHtml(pos.rationale || pos.signal_reason || 'Sinal gerado automaticamente pela estratégia configurada.')}</p>
              <div class="flex gap-2 flex-wrap">
                <button class="tb-btn tb-btn--primary rounded-lg text-sm px-3 py-2 w-full justify-center" data-tb-open-modal-from-panel="1">
                  <i class="fas fa-expand"></i> Abrir detalhes completos
                </button>
              </div>
            `;
        })();
    if (el) el.innerHTML = html;
    if (elTab) elTab.innerHTML = html;
    [el, elTab].forEach(target => {
        target?.querySelector('[data-tb-open-modal-from-panel]')?.addEventListener('click', () => openTradeDetailModal(pos), { once: true });
    });
}

/* ---------- Tabela: Histórico ---------- */
function getSortedFilteredHistory() {
    let arr = Array.isArray(_tbState.history) ? _tbState.history.slice() : [];
    const f = _tbState.historyFilters;
    if (f.q) {
        const q = f.q.toLowerCase();
        arr = arr.filter(t =>
            (t.symbol || '').toLowerCase().includes(q) ||
            String(t.exit_reason || t.close_reason || '').toLowerCase().includes(q) ||
            String(t.side || '').toLowerCase().includes(q)
        );
    }
    if (f.side) arr = arr.filter(t => normalizePositionSide(t.side) === normalizePositionSide(f.side));
    if (f.outcome) arr = arr.filter(t => tradeOutcome(t) === f.outcome);
    switch (f.sort) {
        case 'opened_asc':  arr.sort((a,b) => new Date(a.closed_at||a.opened_at||0) - new Date(b.closed_at||b.opened_at||0)); break;
        case 'pnl_desc':    arr.sort((a,b) => Number(b.realized_pnl_usd ?? b.pnl_usd ?? 0) - Number(a.realized_pnl_usd ?? a.pnl_usd ?? 0)); break;
        case 'pnl_asc':     arr.sort((a,b) => Number(a.realized_pnl_usd ?? a.pnl_usd ?? 0) - Number(b.realized_pnl_usd ?? b.pnl_usd ?? 0)); break;
        case 'opened_desc':
        default: arr.sort((a,b) => new Date(b.closed_at||b.opened_at||0) - new Date(a.closed_at||a.opened_at||0));
    }
    return arr;
}
function renderHistoryTable() {
    const container = document.getElementById('tb-history-table');
    if (!container) return;
    const arr = getSortedFilteredHistory();
    const { page, perPage } = _tbState.historyFilters;
    const totalPages = Math.max(1, Math.ceil(arr.length / perPage));
    const p = Math.min(page, totalPages);
    _tbState.historyFilters.page = p;
    const pageStart = (p - 1) * perPage;
    const pageRows = arr.slice(pageStart, pageStart + perPage);

    const countEl = document.getElementById('tb-hist-count');
    const pageEl = document.getElementById('tb-hist-page');
    const totalEl = document.getElementById('tb-hist-total-pages');
    if (countEl) countEl.textContent = String(arr.length);
    if (pageEl) pageEl.textContent = String(p);
    if (totalEl) totalEl.textContent = String(totalPages);

    if (!arr.length) {
        container.innerHTML = `<p class="text-gray-400 text-center py-8">${_tbState.history.length ? 'Nenhum trade corresponde aos filtros.' : 'Histórico vazio.'}</p>`;
        return;
    }

    container.innerHTML = `
      <table class="tb-hist-table">
        <thead><tr>
          <th>Ativo</th><th>Ciclo</th><th>Aberto</th><th>Fechado</th>
          <th>Entrada → Saída</th><th>Motivo</th>
          <th>P&amp;L</th><th>%</th><th></th>
        </tr></thead>
        <tbody>
          ${pageRows.map(t => {
            const outcome = tradeOutcome(t);
            const pnl = Number(t.realized_pnl_usd ?? t.pnl_usd ?? 0);
            const pnlPct = Number(t.realized_pnl_percent ?? t.pnl_percent ?? 0);
            const exitPx = Number(t.exit_price || 0);
            return `
              <tr data-id="${escapeHtml(t.id || t.symbol + (t.opened_at||''))}">
                <td><span class="font-semibold">${escapeHtml(t.symbol || '—')}</span></td>
                <td>${tradeCycleHtml(t)}</td>
                <td class="text-gray-400 text-xs tabular-nums">${toLocalDateTime(t.opened_at)}</td>
                <td class="text-gray-400 text-xs tabular-nums">${toLocalDateTime(t.closed_at || t.exit_at) || '—'}</td>
                <td class="tabular-nums text-sm">
                  <span class="text-gray-400">${fmtUSD(t.entry_price)}</span>
                  <span class="tb-cycle__arrow">→</span>
                  <span class="${exitPx > 0 ? '' : 'text-gray-500'}">${exitPx > 0 ? fmtUSD(exitPx) : '—'}</span>
                </td>
                <td class="text-xs text-gray-300">${escapeHtml(fmtCloseReason(t.exit_reason || t.close_reason))}</td>
                <td class="tabular-nums font-bold ${numSignClass(pnl)}">${fmtUSD(pnl)}</td>
                <td class="tabular-nums font-semibold ${numSignClass(pnlPct)}">${fmtPct(pnlPct)}</td>
                <td class="text-right"><button class="tb-action-btn" data-action="detail" title="Ver detalhes"><i class="fas fa-eye"></i></button></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;

    container.querySelectorAll('tbody tr').forEach((row, i) => {
        row.addEventListener('click', (e) => {
            const trade = pageRows[i];
            const btn = e.target.closest('[data-action]');
            if (btn?.dataset.action === 'detail') openTradeDetailModal(trade);
            else openTradeDetailModal(trade);
        });
    });
}
function initHistoryFilters() {
    const q = document.getElementById('tb-hist-search');
    const side = document.getElementById('tb-hist-filter-side');
    const outcome = document.getElementById('tb-hist-filter-outcome');
    const sort = document.getElementById('tb-hist-sort');
    const exp = document.getElementById('tb-hist-export');
    const prev = document.getElementById('tb-hist-prev');
    const next = document.getElementById('tb-hist-next');
    const openQ = document.getElementById('tb-open-search');
    const openSide = document.getElementById('tb-open-filter-side');
    const openQTab = document.getElementById('tb-open-search-tab');
    const openSideTab = document.getElementById('tb-open-filter-side-tab');
    const onChange = () => {
        _tbState.historyFilters.q = q?.value || '';
        _tbState.historyFilters.side = side?.value || '';
        _tbState.historyFilters.outcome = outcome?.value || '';
        _tbState.historyFilters.sort = sort?.value || 'opened_desc';
        _tbState.historyFilters.page = 1;
        renderHistoryTable();
    };
    const onChangeOpen = () => {
        _tbState.openFilters.q = openQ?.value || openQTab?.value || '';
        _tbState.openFilters.side = openSide?.value || openSideTab?.value || '';
        renderOpenPositionsRich(_tbState.activePositions);
    };
    q?.addEventListener('input', onChange);
    side?.addEventListener('change', onChange);
    outcome?.addEventListener('change', onChange);
    sort?.addEventListener('change', onChange);
    openQ?.addEventListener('input', onChangeOpen);
    openSide?.addEventListener('change', onChangeOpen);
    openQTab?.addEventListener('input', onChangeOpen);
    openSideTab?.addEventListener('change', onChangeOpen);
    prev?.addEventListener('click', () => { if (_tbState.historyFilters.page > 1) { _tbState.historyFilters.page--; renderHistoryTable(); }});
    next?.addEventListener('click', () => { _tbState.historyFilters.page++; renderHistoryTable(); });
    exp?.addEventListener('click', () => {
        const arr = getSortedFilteredHistory();
        if (!arr.length) { showNotification('Sem dados para exportar.', 'info'); return; }
        const rows = arr.map(t => ({
            id: t.id ?? '',
            symbol: t.symbol ?? '',
            side: t.side ?? '',
            opened_at: t.opened_at ?? '',
            closed_at: t.closed_at ?? t.exit_at ?? '',
            entry_price: t.entry_price ?? '',
            exit_price: t.exit_price ?? '',
            stop_loss: t.stop_loss ?? '',
            take_profit: t.take_profit ?? '',
            pnl_usd: t.realized_pnl_usd ?? t.pnl_usd ?? '',
            pnl_percent: t.realized_pnl_percent ?? t.pnl_percent ?? '',
            exit_reason: t.exit_reason ?? t.close_reason ?? '',
            rationale: t.rationale ?? t.signal_reason ?? '',
        }));
        downloadCSV(`tradebot-historico-${new Date().toISOString().slice(0,10)}.csv`, rows);
        showNotification(`CSV com ${rows.length} trades exportado.`, 'success');
    });
}

/* ---------- Timeline logs human-readable ---------- */
function renderTimelineEvents(events = []) {
    const container = document.getElementById('trade-bot-recent-events');
    if (!container) return;
    const levelFilter = _tbState.historyFilters.level;
    let list = Array.isArray(events) ? events.slice().reverse() : [];
    if (levelFilter) list = list.filter(e => String(e.level || e.event_type || '').toLowerCase().includes(levelFilter.toLowerCase()));

    const clearBtn = document.getElementById('tb-logs-clear');
    clearBtn?.addEventListener('click', () => {
        container.innerHTML = `<p class="text-gray-400 text-center py-8">Nenhum evento registrado</p>`;
    }, { once: true });
    const levelSel = document.getElementById('tb-log-level');
    levelSel?.addEventListener('change', () => {
        _tbState.historyFilters.level = levelSel.value;
        renderTimelineEvents(_tbState.lastData?.recent_events || events);
    });

    if (!list.length) {
        container.innerHTML = `<p class="text-gray-400 text-center py-8">${events.length ? 'Sem eventos para o nível selecionado.' : 'Nenhum evento registrado.'}</p>`;
        return;
    }

    container.innerHTML = list.map(e => {
        const rawLevel = String(e.level || e.event_type || '').toLowerCase();
        let level = 'info';
        if (rawLevel.includes('error') || rawLevel.includes('fail')) level = 'error';
        else if (rawLevel.includes('warn') || rawLevel.includes('alert')) level = 'warn';
        else if (rawLevel.includes('trade') || rawLevel.includes('open') || rawLevel.includes('close') || rawLevel.includes('position')) level = 'trade';
        const title = e.title || e.message || e.event_type || 'Evento';
        const sym = e.symbol || null;
        const d = e.details || {};
        const bodyRows = [];
        if (sym) bodyRows.push({ k: 'Ativo', v: sym });
        if (d.entry_price != null || e.entry_price != null) bodyRows.push({ k: 'Preço', v: fmtUSD(d.entry_price ?? e.entry_price) });
        if (d.quantity != null || e.quantity != null) bodyRows.push({ k: 'Quantidade', v: String(d.quantity ?? e.quantity) });
        if (d.reason != null || e.close_reason != null) bodyRows.push({ k: 'Motivo', v: String(d.reason ?? e.close_reason) });
        if (d.pnl_usd != null || e.pnl_usd != null) {
            const p = Number(d.pnl_usd ?? e.pnl_usd);
            bodyRows.push({ k: 'P&L USD', v: `<span class="${numSignClass(p)}">${fmtUSD(p)}</span>` });
        }
        if (d.pnl_percent != null || e.pnl_percent != null) {
            const pp = Number(d.pnl_percent ?? e.pnl_percent);
            bodyRows.push({ k: 'P&L %', v: `<span class="${numSignClass(pp)}">${fmtPct(pp)}</span>` });
        }
        const extras = Object.keys(d).filter(k => !['entry_price','quantity','reason','pnl_usd','pnl_percent','stop_loss','take_profit'].includes(k));
        extras.slice(0, 6).forEach(k => bodyRows.push({ k: k.replace(/_/g,' '), v: typeof d[k] === 'object' ? JSON.stringify(d[k]) : String(d[k]) }));

        return `
          <div class="tb-tl-item level-${level}">
            <div class="tb-tl-head">
              <span class="tb-tl-level">${level}</span>
              <span class="tb-tl-title">${escapeHtml(title)}</span>
              <span class="tb-tl-time ml-auto">${toLocalDateTime(e.timestamp)}</span>
            </div>
            ${bodyRows.length ? `<div class="tb-tl-body"><dl>${bodyRows.map(r => `<dt>${escapeHtml(r.k)}:</dt><dd>${r.v && r.v.includes && r.v.includes('<span') ? r.v : escapeHtml(String(r.v))}</dd>`).join('')}</dl></div>` : ''}
          </div>
        `;
    }).join('');
}

/* ---------- KPIs avançados + heatmap mensal ---------- */
function renderAdvancedKpis(tradesClosed) {
    const tr = Array.isArray(tradesClosed) ? tradesClosed : [];
    const grossWin = tr.filter(t => tradeOutcome(t) === 'win').reduce((s,t) => s + Number(t.realized_pnl_usd ?? t.pnl_usd ?? 0), 0);
    const grossLoss = Math.abs(tr.filter(t => tradeOutcome(t) === 'loss').reduce((s,t) => s + Number(t.realized_pnl_usd ?? t.pnl_usd ?? 0), 0));
    const wins = tr.filter(t => tradeOutcome(t) === 'win');
    const losses = tr.filter(t => tradeOutcome(t) === 'loss');
    const biggest = wins.length ? Math.max(...wins.map(t => Number(t.realized_pnl_usd ?? t.pnl_usd ?? 0))) : 0;
    const worst = losses.length ? Math.min(...losses.map(t => Number(t.realized_pnl_usd ?? t.pnl_usd ?? 0))) : 0;

    let streakW = 0, streakL = 0, curW = 0, curL = 0;
    tr.slice().sort((a,b) => new Date(a.opened_at||0) - new Date(b.opened_at||0)).forEach(t => {
        const o = tradeOutcome(t);
        if (o === 'win')  { curW++; curL = 0; streakW = Math.max(streakW, curW); }
        if (o === 'loss') { curL++; curW = 0; streakL = Math.max(streakL, curL); }
    });
    const durations = tr
        .filter(t => t.opened_at && (t.closed_at || t.exit_at))
        .map(t => new Date(t.closed_at || t.exit_at) - new Date(t.opened_at));
    const avgDur = durations.length ? durations.reduce((a,b)=>a+b,0) / durations.length : 0;

    const gross = document.getElementById('tb-gross-pl');
    const bw = document.getElementById('tb-biggest-winner');
    const bl = document.getElementById('tb-biggest-loser');
    const sw = document.getElementById('tb-streak-wins');
    const sl = document.getElementById('tb-streak-losses');
    const av = document.getElementById('tb-avg-duration');
    if (gross) gross.innerHTML = `<span class="num-up">${fmtUSD(grossWin)}</span> / <span class="num-down">${fmtUSD(grossLoss)}</span>`;
    if (bw) bw.textContent = wins.length ? fmtUSD(biggest) : '—';
    if (bl) bl.textContent = losses.length ? fmtUSD(worst) : '—';
    if (sw) sw.textContent = String(streakW);
    if (sl) sl.textContent = String(streakL);
    if (av) av.textContent = avgDur ? fmtDurationMs(avgDur) : '—';
}
function renderHeatmap(tradesClosed) {
    const el = document.getElementById('tb-monthly-heatmap');
    if (!el) return;
    const tr = Array.isArray(tradesClosed) ? tradesClosed : [];
    if (!tr.length) { el.innerHTML = `<p class="text-sm text-gray-400 text-center py-6">Sem dados históricos suficientes.</p>`; return; }

    const byMY = {};
    tr.forEach(t => {
        const d = new Date(t.closed_at || t.exit_at || t.opened_at);
        if (Number.isNaN(d.getTime())) return;
        const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        if (!byMY[k]) byMY[k] = 0;
        byMY[k] += Number(t.realized_pnl_usd ?? t.pnl_usd ?? 0);
    });
    const keys = Object.keys(byMY).sort();
    if (!keys.length) { el.innerHTML = `<p class="text-sm text-gray-400 text-center py-6">Sem dados históricos suficientes.</p>`; return; }

    const years = [...new Set(keys.map(k => k.slice(0,4)))].sort();
    const monthLabels = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const values = Object.values(byMY);
    const maxAbs = Math.max(1e-9, ...values.map(Math.abs));

    function cellColor(v) {
        if (v === 0) return 'rgba(139,148,158,0.2)';
        const t = Math.min(1, Math.abs(v) / maxAbs);
        if (v > 0) return `rgba(63, 185, 80, ${0.22 + t * 0.7})`;
        return `rgba(248, 81, 73, ${0.22 + t * 0.7})`;
    }

    let html = `<div class="tb-heatmap-label-row"></div>` + monthLabels.map(m => `<div class="tb-heatmap-label-col">${m}</div>`).join('');
    years.forEach(y => {
        html += `<div class="tb-heatmap-label-row">${y}</div>`;
        for (let m = 1; m <= 12; m++) {
            const k = `${y}-${String(m).padStart(2,'0')}`;
            const v = byMY[k];
            if (v === undefined) html += `<div class="tb-heatmap-cell" data-empty="true" title="${monthLabels[m-1]}/${y}: sem dados">—</div>`;
            else html += `<div class="tb-heatmap-cell" style="background:${cellColor(v)};" title="${monthLabels[m-1]}/${y}: ${fmtUSD(v)}">${v > 0 ? '+' : ''}${v.toFixed(0)}</div>`;
        }
    });
    el.innerHTML = `<div class="tb-heatmap">${html}</div>`;
}

/* ---------- Mercado Agora (overview) ---------- */
function renderMarketOverview(overviewList) {
    const el = document.getElementById('tb-market-overview');
    if (!el) return;
    const arr = Array.isArray(overviewList) && overviewList.length ? overviewList : [
        { symbol: 'BTC/USDT', change_24h: 1.42, price: 68240.12 },
        { symbol: 'ETH/USDT', change_24h: -0.58, price: 3610.55 },
        { symbol: 'SOL/USDT', change_24h: 3.11, price: 178.20 },
        { symbol: 'Fear&Greed',  change_24h: 0,    price: 62,       note: 'Ganância' },
    ];
    el.innerHTML = arr.map(item => {
        const c = Number(item.change_24h || 0);
        const note = item.note || (c > 0 ? `${(+c).toFixed(2)}%` : c < 0 ? `${(+c).toFixed(2)}%` : '—');
        const cls = c > 0 ? 'num-up' : c < 0 ? 'num-down' : 'num-flat';
        return `
          <div class="tb-mkt-row">
            <span class="sym">
              <i class="fas fa-coins text-gray-400 text-xs"></i>
              ${escapeHtml(item.symbol)}
              <span class="text-gray-400 text-xs tabular-nums ml-auto pl-2">${item.price != null ? fmtUSD(item.price) : ''}</span>
            </span>
            <span class="chg ${cls}">${note}</span>
          </div>`;
    }).join('');
}

/* ---------- Gráfico Drawdown + charts enhanced ---------- */
function renderDrawdownChart(cumulative = []) {
    destroyChart(drawdownChart);
    const stamp = document.getElementById('tb-dd-stamp');
    if (!cumulative.length) { if (stamp) stamp.textContent = 'Máx: 0.00%'; return; }

    let peak = -Infinity; let maxDD = 0;
    const ddPct = cumulative.map(item => {
        const v = Number(item.cumulative_pnl_usd || item.equity || 0);
        if (v > peak) peak = v;
        const dd = peak > 0 ? (peak - v) / Math.max(1e-9, Math.abs(peak) + 100) * 100 : 0;
        if (dd > maxDD) maxDD = dd;
        return dd;
    });
    if (stamp) stamp.textContent = `Máx: ${maxDD.toFixed(2)}%`;
    const el = document.getElementById('trade-bot-drawdown-chart');
    if (!el || typeof Chart === 'undefined') return;
    const theme = chartTheme(el);
    drawdownChart = new Chart(el, {
        type: 'line',
        data: {
            labels: cumulative.map(c => toLocalDateTime(c.timestamp)),
            datasets: [{
                data: ddPct,
                borderColor: '#da3633',
                backgroundColor: 'rgba(218, 54, 51, 0.16)',
                fill: true, tension: 0.2, pointRadius: 0,
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `Drawdown: ${Number(c.parsed.y||0).toFixed(2)}%` } } },
            scales: {
                x: { ticks: { color: theme.tick }, grid: { color: theme.grid } },
                y: { ticks: { color: theme.tick, callback: (v) => `${Number(v||0).toFixed(1)}%` }, grid: { color: theme.grid }, reverse: false }
            }
        }
    });
}
function renderTradeBotChartsEnhanced(charts = {}) {
    renderTradeBotCharts(charts);
    const cumulative = charts.cumulative_pnl || charts.equity_curve || [];
    renderDrawdownChart(cumulative);
}

/* ---------- Summary enhanced (8 KPIs novos) ---------- */
function updateSummaryEnhanced(summary = {}, tradesClosed = []) {
    updateSummary(summary);

    const realized   = Number(summary.realized_pnl_usd || 0);
    const trades     = Number(summary.closed_trades || 0) || tradesClosed.length;
    const wins       = tradesClosed.filter(t => tradeOutcome(t) === 'win').length;
    const losses     = tradesClosed.filter(t => tradeOutcome(t) === 'loss').length;
    const grossWin   = tradesClosed.filter(t => tradeOutcome(t) === 'win').reduce((s,t) => s + Number(t.realized_pnl_usd ?? t.pnl_usd ?? 0), 0);
    const grossLoss  = Math.abs(tradesClosed.filter(t => tradeOutcome(t) === 'loss').reduce((s,t) => s + Number(t.realized_pnl_usd ?? t.pnl_usd ?? 0), 0));
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? 99 : 0);
    const maxDD = Number(summary.max_drawdown_percent || 0);
    const expectancy = trades > 0 ? realized / trades : 0;
    const investedUsd = Number(summary.open_margin_usd ?? summary.open_position_value_usd ?? 0);
    const exposure = Number(summary.open_position_value_usd ?? summary.exposure_usd ?? investedUsd);

    const elPnl = document.getElementById('trade-bot-realized-pnl');
    if (elPnl) { elPnl.className = `tb-readout__value tabular-nums ${numSignClass(realized)}`; }

    const oPnlEl = document.getElementById('trade-bot-open-pnl');
    if (oPnlEl) {
        const v = Number(summary.open_pnl_usd || 0);
        oPnlEl.textContent = fmtUSD(v);
        oPnlEl.className = `tb-readout__value tabular-nums ${numSignClass(v)}`;
    }

    const pf = document.getElementById('tb-profit-factor');
    if (pf) { pf.textContent = profitFactor.toFixed(2); pf.className = `tb-readout__value tabular-nums ${profitFactor >= 1.5 ? 'num-up' : profitFactor >= 1 ? 'num-flat' : 'num-down'}`; }

    const md = document.getElementById('tb-max-drawdown');
    if (md) { md.textContent = fmtPct(maxDD); md.className = `tb-readout__value tabular-nums ${maxDD <= 5 ? 'num-flat' : maxDD <= 15 ? 'num-warn' : 'num-down'}`; }
    if (document.getElementById('tb-max-dd-sub') && summary.max_drawdown_date) {
        document.getElementById('tb-max-dd-sub').textContent = `em ${toLocalDateTime(summary.max_drawdown_date).split(' ')[0]}`;
    }

    const exp = document.getElementById('tb-expectancy');
    if (exp) { exp.textContent = fmtUSD(expectancy); exp.className = `tb-readout__value tabular-nums ${numSignClass(expectancy)}`; }

    const investedEl = document.getElementById('trade-bot-invested');
    if (investedEl) investedEl.textContent = fmtUSD(investedUsd);
    const investedSub = document.getElementById('tb-invested-sub');
    if (investedSub) {
        const n = Number(summary.active_positions || 0);
        const posLabel = `${n} posiç${n === 1 ? 'ão' : 'ões'}`;
        investedSub.textContent = Math.abs(exposure - investedUsd) > 0.005
            ? `${posLabel} · exposição ${fmtUSD(exposure)}`
            : `${posLabel} ativas`;
    }
}

/* ---------- Modal de Configurações do Trade Bot (Limites por Cripto) ---------- */
function createCryptoLimitRow(symbol = '', limit = 100) {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2 p-2 bg-gray-900/60 rounded-lg border border-gray-700/80 tb-crypto-limit-row';
    row.innerHTML = `
        <div class="flex-1">
            <input type="text" class="tb-crypto-symbol w-full p-2 bg-gray-700 border border-gray-600 rounded text-sm text-white font-mono uppercase" placeholder="Ex: BTCUSDT" value="${escapeHtml(symbol)}" required>
        </div>
        <div class="w-36 relative">
            <span class="absolute left-2.5 top-2 text-xs text-gray-400 font-mono">$</span>
            <input type="number" step="10" min="1" max="500000" class="tb-crypto-limit w-full p-2 pl-6 bg-gray-700 border border-gray-600 rounded text-sm text-white font-mono" placeholder="250.00" value="${Number(limit) || ''}" required>
        </div>
        <button type="button" class="tb-crypto-remove-btn text-gray-400 hover:text-red-400 p-2 text-sm transition-colors" title="Remover limite">
            <i class="fas fa-trash-alt"></i>
        </button>
    `;

    row.querySelector('.tb-crypto-remove-btn')?.addEventListener('click', () => {
        row.remove();
    });

    return row;
}

function initBotConfigModal() {
    const modal = document.getElementById('tb-config-modal');
    const openBtn = document.getElementById('tb-config-btn');
    const closeBtn = document.getElementById('tb-config-modal-close');
    const cancelBtn = document.getElementById('tb-cfg-cancel-btn');
    const form = document.getElementById('tb-config-form');
    const addCryptoBtn = document.getElementById('tb-cfg-add-crypto-btn');
    const cryptoList = document.getElementById('tb-cfg-crypto-list');
    const saveBtn = document.getElementById('tb-cfg-save-btn');

    const statusSel = document.getElementById('tb-cfg-status');
    const defaultLimitInput = document.getElementById('tb-cfg-default-limit');
    const riskInput = document.getElementById('tb-cfg-risk');
    const confInput = document.getElementById('tb-cfg-confidence');
    const levInput = document.getElementById('tb-cfg-leverage');
    const exitPolicySel = document.getElementById('tb-cfg-exit-policy');

    const closeModal = () => {
        modal?.classList.add('hidden');
        modal?.classList.remove('flex');
    };

    const openModal = async () => {
        if (!modal) return;
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        try {
            const config = await fetchTradeBotConfig();
            if (statusSel) statusSel.value = config.status || (_tbState.running ? 'running' : 'paused');
            if (defaultLimitInput) defaultLimitInput.value = config.default_crypto_limit ?? 100;
            if (riskInput) riskInput.value = config.risk_per_trade != null ? (config.risk_per_trade * 100).toFixed(1) : '1.5';
            if (confInput) confInput.value = config.confidence_threshold != null ? Math.round(config.confidence_threshold * 100) : '60';
            if (levInput) levInput.value = config.leverage ?? 10;
            if (exitPolicySel) {
                const policy = String(config.exit_policy || 'protection').toLowerCase();
                exitPolicySel.value = ['protection', 'confirm', 'reversal', 'target_then_sell'].includes(policy) ? policy : 'protection';
            }

            if (cryptoList) {
                cryptoList.innerHTML = '';
                const allocations = config.max_allocation_per_crypto || {};
                const entries = Object.entries(allocations);
                if (entries.length > 0) {
                    entries.forEach(([sym, lim]) => {
                        cryptoList.appendChild(createCryptoLimitRow(sym, lim));
                    });
                } else {
                    ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].forEach(s => {
                        cryptoList.appendChild(createCryptoLimitRow(s, 200));
                    });
                }
            }
        } catch (err) {
            console.error('Erro ao carregar configuração do bot:', err);
            showNotification('Erro ao carregar configurações atuais do robô.', 'error');
        }
    };

    openBtn?.addEventListener('click', openModal);
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);
    modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) closeModal();
    });

    addCryptoBtn?.addEventListener('click', () => {
        if (cryptoList) {
            const row = createCryptoLimitRow('', defaultLimitInput?.value ? Number(defaultLimitInput.value) : 100);
            cryptoList.appendChild(row);
            row.querySelector('.tb-crypto-symbol')?.focus();
        }
    });

    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!saveBtn) return;

        const maxAllocation = {};
        const rows = cryptoList ? cryptoList.querySelectorAll('.tb-crypto-limit-row') : [];
        rows.forEach(r => {
            const sym = (r.querySelector('.tb-crypto-symbol')?.value || '').trim().toUpperCase();
            const lim = parseFloat(r.querySelector('.tb-crypto-limit')?.value);
            if (sym && !Number.isNaN(lim) && lim > 0) {
                maxAllocation[sym] = lim;
            }
        });

        const statusVal = statusSel?.value || 'running';
        const defaultLimitVal = parseFloat(defaultLimitInput?.value) || 100;
        const riskVal = (parseFloat(riskInput?.value) || 1.5) / 100;
        const confVal = (parseFloat(confInput?.value) || 60) / 100;
        const levVal = parseInt(levInput?.value, 10) || 10;
        const exitPolicyVal = exitPolicySel?.value || 'protection';

        const payload = {
            status: statusVal,
            default_crypto_limit: defaultLimitVal,
            max_allocation_per_crypto: maxAllocation,
            risk_per_trade: riskVal,
            confidence_threshold: confVal,
            leverage: levVal,
            exit_policy: exitPolicyVal,
            confirm_reversal_signals: 2
        };

        const originalText = saveBtn.innerHTML;
        try {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
            
            const res = await saveTradeBotConfig(payload);
            showNotification('Configurações do Trade Bot e limites de saldo salvos com sucesso!', 'success');
            closeModal();
            
            if (res.config?.status) {
                setBotStatus(res.config.status, res.config.started_at ? new Date(res.config.started_at) : null);
            }
            await loadTradeBotDashboardPage();
        } catch (err) {
            console.error('Erro ao salvar configuração do Trade Bot:', err);
            showNotification(`Erro ao salvar configurações: ${err.message || 'Falha na requisição'}`, 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalText;
        }
    });
}

/* ---------- Últimos trades (sidebar) ---------- */
function renderRecentTrades(closed = []) {
    const container = document.getElementById('tb-recent-trades');
    const countEl = document.getElementById('tb-recent-count');
    if (!container) return;
    const recent = closed.slice(0, 8);
    if (countEl) countEl.textContent = String(recent.length);
    if (!recent.length) {
        container.innerHTML = `<p class="tb-empty">Trades fechados recentes aparecem aqui.</p>`;
        return;
    }
    container.innerHTML = recent.map(t => {
        const pnl = Number(t.realized_pnl_usd ?? t.pnl_usd ?? 0);
        const pnlPct = Number(t.realized_pnl_percent ?? t.pnl_percent ?? 0);
        const outcome = tradeOutcome(t);
        return `
          <div class="tb-recent__item" data-id="${escapeHtml(t.id || '')}">
            <div>
              <div class="tb-recent__sym">${escapeHtml(t.symbol || '—')}</div>
              <div class="tb-recent__meta">${toLocalDateTime(t.closed_at || t.exit_at).split(' ')[0]}</div>
            </div>
            <div>
              <div class="tb-recent__reason">${escapeHtml(fmtCloseReason(t.exit_reason || t.close_reason))}</div>
            </div>
            <div class="tb-recent__pnl ${numSignClass(pnl)}">
              <div>${fmtUSD(pnl)}</div>
              <div class="tb-recent__pnl-pct ${numSignClass(pnlPct)}">${fmtPct(pnlPct)}</div>
            </div>
          </div>
        `;
    }).join('');
    container.querySelectorAll('.tb-recent__item').forEach((el, i) => {
        el.addEventListener('click', () => openTradeDetailModal(recent[i]));
    });
}

/* ---------- Merge histórico (tenta extrair do payload de várias formas) ---------- */
function repairExitPrice(t) {
    const exit = Number(t.exit_price || 0);
    if (exit > 0) return t;
    const entry = Number(t.entry_price || 0);
    const qty = Number(t.quantity || 0);
    const pnl = Number(t.realized_pnl_usd ?? t.pnl_usd ?? 0);
    const side = normalizePositionSide(t.side);
    if (!(entry > 0 && qty > 0 && pnl !== 0 && side)) return t;
    const inferred = side === 'buy' ? entry + (pnl / qty) : entry - (pnl / qty);
    return { ...t, exit_price: inferred, exit_side: t.exit_side || (side === 'buy' ? 'sell' : 'buy') };
}
function extractClosedTrades(data) {
    let arr = [];
    if (Array.isArray(data?.closed_trades) && data.closed_trades.length) arr = data.closed_trades;
    else if (Array.isArray(data?.history) && data.history.length) arr = data.history;
    else if (Array.isArray(data?.trades) && data.trades.length) {
        arr = data.trades.filter(t => t.closed_at || t.exit_at || t.realized_pnl_usd != null);
    }
    return arr.map(repairExitPrice);
}

/* ---------- Inicialização geral ---------- */
function initTradeBotUI() {
    if (_tbUiInitialized) return;
    _tbUiInitialized = true;
    initTabs();
    initMasterToggle();
    initModal();
    initBotConfigModal();
    initConfirmModal();
    initHistoryFilters();
}

/* ---------- Nova página completa ---------- */
export async function loadTradeBotDashboardPage() {
    initTradeBotUI();

    // Profile do hero
    const profileLabel = document.getElementById('tb-hero-profile');
    const p = (globalThis.state?.settings?.profile || globalThis.state?.dashboard?.investmentProfile || 'moderate');
    if (profileLabel) profileLabel.textContent = p === 'conservative' ? 'Conservador' : p === 'aggressive' ? 'Agressivo' : 'Moderado';

    let data;
    try {
        data = await fetchTradeBotDashboard();
    } catch (err) {
        data = null;
    }
    if (!data?.summary) {
        showNotification('Não foi possível carregar o dashboard do Trade Bot. Mostrando estado vazio.', 'error');
        data = data || {};
        data.summary = data.summary || {};
    }
    _tbState.lastData = data;

    const active = Array.isArray(data.active_positions) ? data.active_positions : [];
    const closed = extractClosedTrades(data);
    _tbState.history = closed;
    _tbState.historyFilters.page = 1;

    setBotStatus(data.bot_status === 'running' ? 'running' : data.bot_status === 'paused' ? 'paused' : data.bot_status === 'error' ? 'error' : 'offline',
                 data.bot_started_at ? new Date(data.bot_started_at) : null);

    _tbState.environment = data?.environment || null;
    applyModeBadge(
        document.getElementById('tb-mode-badge'),
        document.getElementById('tb-mode-badge-label'),
        _tbState.environment
    );

    updateSummaryEnhanced(data.summary, closed);
    renderTradeBotChartsEnhanced(data.charts || {});
    renderOpenPositionsRich(active);
    renderRecentTrades(closed);
    renderHistoryTable();
    renderTimelineEvents(Array.isArray(data.recent_events) ? data.recent_events : []);
    renderAdvancedKpis(closed);
    renderHeatmap(closed);
    renderMarketOverview(data.market_overview || null);
}

/* Mantém a assinatura antiga de showTradeBotPage */
export async function showTradeBotPage() {
    showPage('trade-bot');
    await loadTradeBotDashboardPage();
}
