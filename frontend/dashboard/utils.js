/**
 * Settings historically stored updateInterval as seconds (10, 30, 60, 300).
 * setInterval expects milliseconds. Values below 1000 are treated as seconds.
 */
export function normalizeUpdateIntervalMs(value, fallback = 30000) {
    let n = Number(value);
    if (!Number.isFinite(n) || n <= 0) n = fallback;
    if (n < 1000) n = n * 1000;
    return Math.max(10000, Math.min(n, 600000));
}

/**
 * Debounces a function, delaying its execution until after a certain amount of time has passed without it being called.
 * @param {Function} func The function to debounce.
 * @param {number} delay The debounce delay in milliseconds.
 * @returns {Function} The debounced function.
 */
export function debounce(func, delay) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}

/**
 * Formats a number as a currency string.
 * @param {number} value The number to format.
 * @returns {string} The formatted currency string.
 */
export function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2
    }).format(value);
}

/**
 * Formats a number with two decimal places.
 * @param {number} value The number to format.
 * @returns {string} The formatted number string.
 */
export function formatNumber(value) {
    return new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}

/**
 * Formats a large number into a human-readable string with suffixes (K, M, B, T).
 * @param {number} value The number to format.
 * @returns {string} The formatted large number string.
 */
export function formatLargeNumber(value) {
    if (value >= 1e12) return (value / 1e12).toFixed(2) + 'T';
    if (value >= 1e9) return (value / 1e9).toFixed(2) + 'B';
    if (value >= 1e6) return (value / 1e6).toFixed(2) + 'M';
    if (value >= 1e3) return (value / 1e3).toFixed(2) + 'K';
    return value.toFixed(2);
}

/**
 * Normalizes a timestamp to the beginning of a candle based on the timeframe.
 * @param {number} timestamp The timestamp to normalize.
 * @param {string} timeframe The chart timeframe (e.g., '1m', '5m', '1h').
 * @returns {number} The normalized timestamp.
 */
export function normalizeTimeToCandle(timestamp, timeframe = '1m') {
    const date = new Date(timestamp * 1000);
    
    switch(timeframe) {
        case '1m':
            date.setSeconds(0, 0);
            break;
        case '5m':
            date.setMinutes(Math.floor(date.getMinutes() / 5) * 5, 0, 0);
            break;
        case '15m':
            date.setMinutes(Math.floor(date.getMinutes() / 15) * 15, 0, 0);
            break;
        case '1h':
            date.setMinutes(0, 0, 0);
            break;
        case '4h':
            date.setHours(Math.floor(date.getHours() / 4) * 4, 0, 0, 0);
            break;
        case '1d':
            date.setHours(0, 0, 0, 0);
            break;
        default:
            date.setSeconds(0, 0);
    }
    
    return Math.floor(date.getTime() / 1000);
}

/**
 * Updates an existing candle or creates a new one.
 * @param {any[]} existingData The array of existing candle data.
 * @param {number} newPrice The new price.
 * @param {number} timestamp The timestamp of the new price.
 * @param {number} volume The volume of the new price.
 * @returns {{type: string, candle: any, index: number}} An object containing the type of update ('update' or 'new'), the updated/new candle, and its index.
 */
export function updateCandleData(existingData, newPrice, timestamp, volume = 0) {
    const candleTime = normalizeTimeToCandle(timestamp);
    const lastCandle = existingData[existingData.length - 1];
    
    if (lastCandle && lastCandle.time === candleTime) {
        // Atualizar candle existente
        const updatedCandle = {
            ...lastCandle,
            high: Math.max(lastCandle.high, newPrice),
            low: Math.min(lastCandle.low, newPrice),
            close: newPrice,
            value: lastCandle.value + volume,
            color: newPrice >= lastCandle.open ? '#10b981' : '#ef4444'
        };
        
        // Substituir o último candle
        existingData[existingData.length - 1] = updatedCandle;
        return { type: 'update', candle: updatedCandle, index: existingData.length - 1 };
    } else {
        // Criar novo candle
        const newCandle = {
            time: candleTime,
            open: newPrice,
            high: newPrice,
            low: newPrice,
            close: newPrice,
            value: volume,
            color: '#26a69a'
        };
        
        existingData.push(newCandle);
        return { type: 'new', candle: newCandle, index: existingData.length - 1 };
    }
}

const MODEL_SIGNAL_INTERVAL_SEC = 4 * 60 * 60;

function chartIntervalSeconds(timeframe) {
    switch (timeframe) {
        case '1m': return 60;
        case '5m': return 5 * 60;
        case '15m': return 15 * 60;
        case '1h': return 60 * 60;
        case '4h': return MODEL_SIGNAL_INTERVAL_SEC;
        case '1d': return 24 * 60 * 60;
        case '1w': return 7 * 24 * 60 * 60;
        default: return MODEL_SIGNAL_INTERVAL_SEC;
    }
}

function recommendationTimestamp(rec) {
    const time = String(rec?.Time || '').trim();
    const date = String(rec?.Date || '').trim();
    if (!date || !time) return null;
    const parsed = new Date(`${date}T${time}Z`).getTime();
    return Number.isFinite(parsed) ? parsed / 1000 : null;
}

/**
 * CSV Date/Time is the closed 4h candle the model classified.
 * The call is for the next candle (candle+1): that is when the user/bot can act.
 */
function markerCandleTime(recTimestamp, candlestickData, timeframe) {
    const activeTime = recTimestamp + MODEL_SIGNAL_INTERVAL_SEC;
    const tolerance = Math.max(chartIntervalSeconds(timeframe), MODEL_SIGNAL_INTERVAL_SEC);
    let closestCandleTime = null;
    let minDiff = Infinity;

    candlestickData.forEach((candle) => {
        const diff = Math.abs(candle.time - activeTime);
        if (diff < minDiff && diff < tolerance) {
            minDiff = diff;
            closestCandleTime = candle.time;
        }
    });

    return closestCandleTime;
}

/**
 * Creates recommendation markers for the chart.
 * @param {any[]} recommendationHistory An array of recommendation history objects.
 * @param {any[]} candlestickData An array of candlestick data objects.
 * @param {number} confidenceThreshold Minimum confidence percentage to display markers (default: 70).
 * @param {string} timeframe Active chart timeframe.
 * @returns {any[]} An array of marker objects for the chart.
 */
export function createRecommendationMarkers(recommendationHistory, candlestickData, confidenceThreshold = 70, timeframe = '4h') {
    if (!Array.isArray(recommendationHistory) || !Array.isArray(candlestickData) || candlestickData.length === 0) {
        return [];
    }

    const threshold = confidenceThreshold / 100;
    const latestRec = recommendationHistory[recommendationHistory.length - 1];
    const latestKind = latestRec?.recommendation;
    const latestIsAction = latestKind === 'Buy' || latestKind === 'Sell' || latestKind === 'Compra' || latestKind === 'Venda';
    const latestAction = latestIsAction
        ? latestRec
        : [...recommendationHistory].reverse().find((rec) => {
            const kind = rec?.recommendation;
            return kind === 'Buy' || kind === 'Sell' || kind === 'Compra' || kind === 'Venda';
        });

    const byTime = new Map();

    recommendationHistory.forEach((rec, index) => {
        const percentage = parseFloat(rec.percentage) || 0;
        const isLatestAction = rec === latestRec && latestIsAction;
        if (percentage < threshold && !isLatestAction) return;

        const recTimestamp = recommendationTimestamp(rec);
        if (recTimestamp == null) return;

        const candleTime = markerCandleTime(recTimestamp, candlestickData, timeframe);
        if (candleTime == null) return;

        const isLast = rec === latestAction;
        let markerStyle = null;
        if (rec.recommendation === 'Buy' || rec.recommendation === 'Compra') {
            markerStyle = {
                position: 'belowBar',
                color: '#10b981',
                shape: 'arrowUp',
                text: 'Buy',
                size: isLast ? 1.8 : 1.2
            };
        } else if (rec.recommendation === 'Sell' || rec.recommendation === 'Venda') {
            markerStyle = {
                position: 'aboveBar',
                color: '#ef4444',
                shape: 'arrowDown',
                text: 'Sell',
                size: isLast ? 1.8 : 1.2
            };
        }
        if (!markerStyle) return;

        const recTime = recTimestamp;
        const previous = byTime.get(candleTime);
        if (previous && recTime < previous._recTime) return;

        byTime.set(candleTime, { id: index, time: candleTime, _recTime: recTime, ...markerStyle });
    });

    return [...byTime.values()]
        .sort((a, b) => a.time - b.time)
        .map(({ _recTime, ...marker }) => marker);
}

/**
 * Returns local and remote icon URLs for a given crypto symbol.
 * Prefer local `assets/icons` path; remote is the fallback source.
 * @param {string} symbol The cryptocurrency symbol (e.g., 'BTC').
 * @returns {{ local: string, remote: string }} Object with local and remote icon URLs.
 */
export function getIconUrls(symbol) {
    const lower = String(symbol || '').toLowerCase();
    return {
        local: `assets/icons/${lower}.svg`,
        remote: `https://raw.githubusercontent.com/Cryptofonts/cryptoicons/refs/heads/master/SVG/${lower}.svg`
    };
}

/**
 * Sets an image element `src` to the local icon and falls back to remote URL on error.
 * It attaches a one-time error handler to avoid infinite loops if the remote also fails.
 * @param {HTMLImageElement} imgEl The target image element.
 * @param {string} symbol The cryptocurrency symbol (e.g., 'BTC').
 */
export function setImageWithFallback(imgEl, symbol) {
    if (!imgEl) return;
    const { local, remote } = getIconUrls(symbol);
    const onErr = () => {
        imgEl.onerror = null;
        imgEl.src = remote;
    };
    imgEl.onerror = onErr;
    imgEl.src = local;
}