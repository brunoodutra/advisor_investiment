import { CONFIG } from './config.js?v=20260828a';
import { state } from './state.js?v=20260828a';
import { calculateMarketExitScore } from './marketExit.js?v=20260828a';
import { formatLargeNumber, formatCurrency } from './utils.js?v=20260828a';
import { updateGauge, updateMarketExitCard, renderCryptoCards } from './ui.js?v=20260828a';

export function tradeBotAuthHeaders(extra = {}) {
    const headers = { Accept: 'application/json', ...extra };
    const token = CONFIG.tradeBotApiToken || (typeof localStorage !== 'undefined' ? localStorage.getItem('TRADE_BOT_API_TOKEN') : '');
    if (token) headers['X-Trade-Bot-Token'] = token;
    return headers;
}

/**
 * Fetches data from a URL with caching mechanism.
 * @param {string} url The URL to fetch data from.
 * @param {string|null} cacheKey The key to use for caching the data.
 * @param {number} cacheDuration The duration in milliseconds to cache the data.
 * @returns {Promise<any|null>} A promise that resolves to the fetched data or null if an error occurs.
 */
export async function fetchData(url, cacheKey = null, cacheDuration = 3000) {
    if (cacheKey && state.cache[cacheKey]) {
        const cached = state.cache[cacheKey];
        if (Date.now() - cached.timestamp < cacheDuration) {
            return cached.data;
        }
    }

    const urls = Array.isArray(url) ? url : [url];
    for (const u of urls) {
        try {
            const response = await fetch(u, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'CryptoDash-Pro/1.0'
                }
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            
            if (cacheKey) {
                state.cache[cacheKey] = {
                    data: data,
                    timestamp: Date.now()
                };
            }
            
            return data;
        } catch (error) {
            console.error('Fetch error:', error);
        }
    }
    return null;
}

/**
 * Fetches global cryptocurrency market data from the CoinGecko API.
 * Isolada: erros aqui NÃO propagam para outros módulos.
 */
export async function fetchGlobalData() {
    try {
        const data = await fetchData(
            `${CONFIG.apis.coingecko}/global`,
            'global_data',
            CONFIG.updateIntervals.global
        );

        if (data && data.data) {
            const mcapEl = document.getElementById('global-market-cap');
            const volEl = document.getElementById('global-volume');
            const domEl = document.getElementById('btc-dominance');
            const domBar = document.getElementById('btc-dominance-bar');

            if (mcapEl) mcapEl.textContent = '$' + formatLargeNumber(data.data.total_market_cap.usd);
            if (volEl) volEl.textContent = '$' + formatLargeNumber(data.data.total_volume.usd);
            const btcDominanceValue = data.data.market_cap_percentage.btc.toFixed(1);
            if (domEl) domEl.textContent = btcDominanceValue + '%';
            state.btcDominance = btcDominanceValue;
            if (domBar) domBar.style.width = btcDominanceValue + '%';
        }
    } catch (error) {
        console.warn('[fetchGlobalData] Indisponível:', error?.message || error);
    }
}

/**
 * Fetches Fear & Greed Index data. Isolada: erros não propagam.
 */
export async function fetchFearGreedIndex() {
    try {
        const data = await fetchData(
            CONFIG.apis.fearGreed,
            'fear_greed',
            CONFIG.updateIntervals.fearGreed
        );

        if (data && data.data && data.data[0]) {
            const fgData = data.data[0];
            const value = parseInt(fgData.value);
            const classification = fgData.value_classification;

            const numEl = document.getElementById('fear-greed-number');
            const lblEl = document.getElementById('fear-greed-label');
            const valEl = document.getElementById('fear-greed-value');
            if (numEl) numEl.textContent = value;
            if (lblEl) lblEl.textContent = classification;
            if (valEl) valEl.textContent = value;

            try { updateGauge(value); } catch (e) { /* noop */ }
        }
    } catch (error) {
        console.warn('[fetchFearGreedIndex] Indisponível:', error?.message || error);
    }
}

/**
 * Fetches 24-hour ticker data for all configured cryptocurrencies from the Binance API.
 * Opera de forma ISOLADA: falhas em uma cripto ou mesmo em todas NÃO afetam outros módulos.
 * Usa Promise.allSettled + fallback individual por cripto.
 */
let cryptoFetchInFlight = false;

export async function fetchCryptoData() {
    if (cryptoFetchInFlight) return;
    cryptoFetchInFlight = true;
    const cryptos = CONFIG.cryptos;
    const binanceBases = [
        CONFIG.apis.binance,
        'https://data-api.binance.vision/api/v3'
    ];

    const promises = cryptos.map(async (crypto) => {
        try {
            const urls = binanceBases.map(base => `${base}/ticker/24hr?symbol=${crypto.binanceSymbol}`);
            const data = await fetchData(urls, crypto.symbol, CONFIG.updateIntervals.prices);

            let current_price = parseFloat(data?.lastPrice ?? 0);
            let price_change_percentage_24h = parseFloat(data?.priceChangePercent ?? 0);
            let total_volume = parseFloat(data?.quoteVolume ?? 0);
            let market_cap = 0;

            if (!data) {
                try {
                    const cg = await fetchData(
                        `${CONFIG.apis.coingecko}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(crypto.id)}`,
                        `cg_markets_${crypto.id}`,
                        CONFIG.updateIntervals.prices
                    );
                    const row = Array.isArray(cg) ? cg[0] : null;
                    if (row) {
                        current_price = Number(row.current_price) || 0;
                        price_change_percentage_24h = Number(row.price_change_percentage_24h) || 0;
                        total_volume = Number(row.total_volume) || 0;
                        market_cap = Number(row.market_cap) || 0;
                    }
                } catch (cgErr) {
                    console.warn(`[fetchCryptoData] CoinGecko fallback falhou para ${crypto.symbol}:`, cgErr?.message || cgErr);
                }
            }

            return {
                id: crypto.id,
                symbol: crypto.symbol,
                name: crypto.name,
                image: `https://raw.githubusercontent.com/Cryptofonts/cryptoicons/refs/heads/master/SVG/${crypto.symbol.toLowerCase()}.svg`,
                current_price,
                price_change_percentage_24h,
                market_cap,
                total_volume,
                color: crypto.color
            };
        } catch (err) {
            console.error(`[fetchCryptoData] Falha individual em ${crypto.symbol}:`, err);
            return null;
        }
    });

    try {
        const results = await Promise.allSettled(promises);
        const data = results
            .filter(r => r.status === 'fulfilled' && r.value !== null)
            .map(r => r.value);

        renderCryptoCards(data);
    } catch (error) {
        console.error('[fetchCryptoData] Erro geral (renderização):', error);
    } finally {
        cryptoFetchInFlight = false;
    }
}

/**
 * Fetches the latest trading recommendation for a given cryptocurrency.
 * @param {string} crypto The cryptocurrency symbol (e.g., 'BTC').
 * @returns {Promise<any|null>} A promise that resolves to the recommendation data or null if an error occurs.
 */
export async function fetchRecommendation(crypto) {
    try {
        const data = await fetchData(
            `${CONFIG.apis.recommendations}/last_recommendation?model_name=${state.settings.model}&crypto=${crypto}`,
            `recommendation_${crypto}_${state.settings.model}`,
            CONFIG.updateIntervals.prices
        );
        return data;
    } catch (error) {
        console.error('Error fetching recommendation:', error);
        return null;
    }
}

/**
 * Fetches ranked news for a given cryptocurrency.
 * @param {string} crypto The cryptocurrency symbol (e.g., 'BTC').
 * @returns {Promise<{crypto: string|null, updatedAt: string|null, sourcesUsed: string[], newsItems: any[]}|null>}
 */
export async function fetchCryptoNews(crypto) {
    try {
        const symbol = String(crypto || '').toUpperCase();
        if (!symbol) return null;

        const data = await fetchData(
            `${CONFIG.apis.recommendations}/crypto_news?crypto=${encodeURIComponent(symbol)}`,
            `crypto_news_${symbol}`,
            CONFIG.updateIntervals.sentiment
        );

        if (!data || typeof data !== 'object') {
            return null;
        }

        return {
            crypto: typeof data.crypto === 'string' ? data.crypto : symbol,
            updatedAt: typeof data.updated_at === 'string'
                ? data.updated_at
                : (typeof data.updatedAt === 'string' ? data.updatedAt : null),
            sourcesUsed: Array.isArray(data.sources_used)
                ? data.sources_used
                : (Array.isArray(data.sourcesUsed) ? data.sourcesUsed : []),
            newsItems: Array.isArray(data.news_items)
                ? data.news_items
                : (Array.isArray(data.newsItems) ? data.newsItems : [])
        };
    } catch (error) {
        console.error('Error fetching crypto news:', error);
        return null;
    }
}

/**
 * Fetches the latest sentiment analysis for a given cryptocurrency.
 * @param {string} crypto The cryptocurrency symbol (e.g., 'BTC').
 * @returns {Promise<{sentiment: string|null, topNews: string[], newsCount: number, sourcesUsed: string[]}|null>}
 */
export async function fetchSentimentAnalysis(crypto) {
    try {
        const symbol = String(crypto || '').toUpperCase();
        if (!symbol) return null;

        const data = await fetchData(
            `${CONFIG.apis.recommendations}/sentiment_analysis?crypto=${encodeURIComponent(symbol)}`,
            `sentiment_${symbol}`,
            CONFIG.updateIntervals.sentiment
        );

        if (!data || typeof data !== 'object') {
            return null;
        }

        return {
            sentiment: typeof data.Sentiment === 'string'
                ? data.Sentiment
                : (typeof data.sentiment === 'string' ? data.sentiment : null),
            topNews: Array.isArray(data.Top_news)
                ? data.Top_news
                : (Array.isArray(data.top_news) ? data.top_news : []),
            newsCount: Number.isFinite(Number(data.news_count))
                ? Number(data.news_count)
                : (Number.isFinite(Number(data.newsCount)) ? Number(data.newsCount) : 0),
            sourcesUsed: Array.isArray(data.sources_used)
                ? data.sources_used
                : (Array.isArray(data.sourcesUsed) ? data.sourcesUsed : []),
            confidence: Number.isFinite(Number(data.confidence)) ? Number(data.confidence) : null,
            rationale: typeof data.rationale === 'string' ? data.rationale : null,
            keyDrivers: Array.isArray(data.key_drivers)
                ? data.key_drivers
                : (Array.isArray(data.keyDrivers) ? data.keyDrivers : []),
            sentimentMethod: typeof data.sentiment_method === 'string'
                ? data.sentiment_method
                : (typeof data.sentimentMethod === 'string' ? data.sentimentMethod : null)
        };
    } catch (error) {
        console.error('Error fetching sentiment analysis:', error);
        return null;
    }
}

/**
 * Fetches the recommendation history for a given cryptocurrency.
 * @param {string} crypto The cryptocurrency symbol (e.g., 'BTC').
 * @returns {Promise<any[]>} A promise that resolves to an array of recommendation history data or an empty array if an error occurs.
 */
export async function fetchRecommendationHistory(crypto) {
    try {
        const data = await fetchData(
            `${CONFIG.apis.recommendations}/recommendation_history?model_name=${state.settings.model}&crypto=${crypto}`,
            `recommendation_history_${crypto}_${state.settings.model}`,
            CONFIG.updateIntervals.prices
        );
        return data || [];
    } catch (error) {
        console.error('Error fetching recommendation history:', error);
        return [];
    }
}

/**
 * Fetches a specific historical recommendation for a given cryptocurrency, date, and time.
 * @param {string} crypto The cryptocurrency symbol (e.g., 'BTC').
 * @param {string} date The date of the recommendation (e.g., '2025-06-12').
 * @param {string} time The time of the recommendation (e.g., '20:00:00').
 * @returns {Promise<any|null>} A promise that resolves to the specific recommendation data or null if an error occurs.
 */
export async function fetchSpecificRecommendation(crypto, date, time) {
    try {
        const encodedTime = encodeURIComponent(time);
        const profile = state.settings.profile;
        const url = `${CONFIG.apis.recommendations}/specific_recommendation?model_name=${state.settings.model}&crypto=${crypto}&date=${date}&time=${encodedTime}&profile=${profile}`;
        // No caching for specific historical data as it's immutable
        const data = await fetchData(url, null, 0);
        return data;
    } catch (error) {
        console.error('Error fetching specific recommendation:', error);
        return null;
    }
}

export async function fetchTradeBotDashboard() {
    try {
        const data = await fetchData(
            `${CONFIG.apis.recommendations}/trade_bot/dashboard`,
            'trade_bot_dashboard',
            5000
        );
        return data;
    } catch (error) {
        console.error('Error fetching trade bot dashboard:', error);
        return null;
    }
}

export async function fetchTradeBotConfig() {
    try {
        const response = await fetch(`${CONFIG.apis.recommendations}/trade_bot/config`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error('Error fetching trade bot config:', error);
        throw error;
    }
}

export async function saveTradeBotConfig(config) {
    try {
        const response = await fetch(`${CONFIG.apis.recommendations}/trade_bot/config`, {
            method: 'POST',
            headers: tradeBotAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(config)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        delete state.cache['trade_bot_dashboard'];
        return await response.json();
    } catch (error) {
        console.error('Error saving trade bot config:', error);
        throw error;
    }
}

export async function toggleTradeBotStatus(status = null) {
    try {
        const payload = status ? { status } : {};
        const response = await fetch(`${CONFIG.apis.recommendations}/trade_bot/toggle`, {
            method: 'POST',
            headers: tradeBotAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        delete state.cache['trade_bot_dashboard'];
        return await response.json();
    } catch (error) {
        console.error('Error toggling trade bot status:', error);
        throw error;
    }
}

export async function emergencyCloseTradeBot() {
    try {
        const response = await fetch(`${CONFIG.apis.recommendations}/trade_bot/emergency_close`, {
            method: 'POST',
            headers: tradeBotAuthHeaders({ 'Content-Type': 'application/json' })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        delete state.cache['trade_bot_dashboard'];
        return await response.json();
    } catch (error) {
        console.error('Error closing all trade bot positions:', error);
        throw error;
    }
}

export async function closeTradeBotPosition(symbol, reason = 'MANUAL_CLOSE') {
    try {
        const response = await fetch(`${CONFIG.apis.recommendations}/trade_bot/positions/close`, {
            method: 'POST',
            headers: tradeBotAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ symbol, reason })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        delete state.cache['trade_bot_dashboard'];
        return await response.json();
    } catch (error) {
        console.error('Error closing trade bot position:', error);
        throw error;
    }
}

/**
 * Fetches candlestick data for a given cryptocurrency from the Binance API.
 * @param {string} crypto The cryptocurrency symbol (e.g., 'BTC').
 * @param {string|null} interval The chart interval (e.g., '1h', '4h').
 * @param {number|null} limit The number of candles to fetch.
 * @returns {Promise<any[]>} A promise that resolves to an array of candlestick data or an empty array if an error occurs.
 */
export async function fetchCandlestickData(crypto, interval = null, limit = null) {
    const config = CONFIG.cryptos.find(c => c.symbol === crypto);
    if (!config) {
        console.error('Crypto symbol not found:', crypto);
        return [];
    }
    
    const symbol = config.binanceSymbol;
    const actualInterval = interval || state.settings.timeframe;
    const actualLimit = limit || state.settings.candles;
    const binanceBases = [
        CONFIG.apis.binance,
        'https://data-api.binance.vision/api/v3'
    ];
    const urls = binanceBases.map(base => `${base}/klines?symbol=${symbol}&interval=${actualInterval}&limit=${actualLimit}`);
    
    try {
        const data = await fetchData(urls, `klines_${symbol}_${actualInterval}_${actualLimit}`, CONFIG.updateIntervals.chart);
        if (!data) return [];
        return data.map(candle => ({
            time: candle[0] / 1000,
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            value: parseFloat(candle[5]),
            color: parseFloat(candle[4]) >= parseFloat(candle[1]) ? 'rgba(16, 185, 129, 0.5)' : 'rgba(239, 68, 68, 0.5)'
        }));
    } catch (error) {
        console.error('Error fetching candlestick data:', error);
        return [];
    }
}

/**
 * Fetches the target and stop-loss prices for a given cryptocurrency and recommendation.
 * @param {string} crypto The cryptocurrency symbol (e.g., 'BTC').
 * @param {string} recommendation The trading recommendation ('buy' or 'sell').
 * @returns {Promise<any|null>} A promise that resolves to the target and stop-loss data or null if an error occurs.
 */
export async function fetchTargetStop(crypto, recommendation) {
    if (!recommendation || (recommendation.toLowerCase() !== 'buy' && recommendation.toLowerCase() !== 'sell')) {
        return null;
    }

    try {
        const data = await fetchData(
            `${CONFIG.apis.recommendations}/last_target_stop?model_name=${state.settings.model}&crypto=${crypto}&profile=${state.settings.profile}`,
            `target_stop_${crypto}_${state.settings.profile}_${state.settings.model}`,
            CONFIG.updateIntervals.prices
        );
        return data;
    } catch (error) {
        console.error('Error fetching target/stop data:', error);
        return null;
    }
}

/**
 * Fetches Market Exit Indicator data and updates the UI.
 * Isolada: falhas aqui NÃO afetam o carregamento das criptos/recomendações.
 */
export async function fetchMarketExitData() {
    try {
        const marketExitData = await calculateMarketExitScore();
        if (marketExitData) {
            state.marketExitData = marketExitData;
            try { updateMarketExitCard(marketExitData); } catch (e) { /* noop */ }
        }
        return marketExitData;
    } catch (error) {
        console.warn('[fetchMarketExitData] Indisponível:', error?.message || error);
        return null;
    }
}
