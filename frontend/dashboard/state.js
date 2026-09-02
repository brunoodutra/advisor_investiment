export let state = {
    currentPage: 'dashboard',
    currentCrypto: null,
    investmentProfile: 'moderate',
    portfolio: { balance: 10000, positions: [], transactions: [] },
    alerts: [],
    auth: {
        user: null,
        session: null,
        redirectTo: null
    },
    cache: {},
    // Chart state for LightweightCharts (now default)
    lightweightChart: null,
    candlestickSeries: null,
    volumeSeries: null,
    recommendationHistory: [],
    candlestickData: [],
    // Indicators Manager
    indicatorsManager: null,
    // Trading Signals Manager
    tradingSignals: null,
    // Configuration state
    settings: {
        model: 'CNN',
        timeframe: '4h',
        candles: 200,
        updateInterval: 30000,
        profile: 'moderate',
        soundNotifications: false,
        confidenceThreshold: 70
    },
    // View state
    viewMode: 'cards', // 'cards' or 'list'
    // Ruler state - ENHANCED AND FIXED
    ruler: {
        active: false,
        startPoint: null,
        endPoint: null,
        lineSeries: null,
        infoBox: null,
        isDragging: false
    },
    // Chart update control
    chartUpdateControl: {
        lastCandleTime: null,
        lastRecommendationTime: null
    }
};
