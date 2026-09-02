function getRecommendationsBase() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('recommendationsBase');
    if (fromQuery) return fromQuery;

    const fromStorage = window.localStorage.getItem('recommendationsBase');
    if (fromStorage) return fromStorage;

    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
    if (isLocal) return 'http://127.0.0.1:8000';

    return '/api/reco';
}

function getChatBase() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('chatBase');
    if (fromQuery) return fromQuery;

    const fromStorage = window.localStorage.getItem('chatBase');
    if (fromStorage) return fromStorage;

    return getRecommendationsBase();
}

function getTradeBotToken() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('tradeBotToken');
    if (fromQuery) return fromQuery;
    const fromStorage = window.localStorage.getItem('TRADE_BOT_API_TOKEN');
    if (fromStorage) return fromStorage;
    return '';
}

export const CONFIG = {
    cryptos: [
        { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', binanceSymbol: 'BTCUSDT', color: '#f7931a' },
        { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', binanceSymbol: 'ETHUSDT', color: '#627eea' },
        { id: 'solana', symbol: 'SOL', name: 'Solana', binanceSymbol: 'SOLUSDT', color: '#00d4aa' },
        { id: 'cardano', symbol: 'ADA', name: 'Cardano', binanceSymbol: 'ADAUSDT', color: '#0033ad' },
        { id: 'ripple', symbol: 'XRP', name: 'Ripple', binanceSymbol: 'XRPUSDT', color: '#23292f' }
    ],
    apis: {
        binance: 'https://api.binance.com/api/v3',
        coingecko: 'https://api.coingecko.com/api/v3',
        fearGreed: 'https://api.alternative.me/fng/',
        recommendations: getRecommendationsBase(),
        chat: getChatBase()
    },
    tradeBotApiToken: getTradeBotToken(),
    updateIntervals: {
        prices: 30000, // 30s
        fearGreed: 300000, // 5min
        global: 60000, //1 min
        sentiment: 300000, // 5min
        chart : 60000,
    },
    chart: {
        defaultVisibleCandles: 50, // Número padrão de candles visíveis no autoajuste
        autoZoomBuffer: 5 // Buffer adicional para o zoom automático
    }
};
