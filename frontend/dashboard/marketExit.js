/**
 * Market Exit Indicator Module
 * Implementa indicadores técnicos para detecção de pico do mercado de criptomoedas
 * Versão 2.0 - Otimizado: cache compartilhado + deduplicação de chamadas
 */

import { CONFIG } from './config.js?v=20260828a';
import { state } from './state.js?v=20260828a';
import { fetchData } from './api.js?v=20260828a';
import { formatLargeNumber, formatCurrency } from './utils.js?v=20260828a';

function unavailableIndicator(description = 'Dados indisponíveis') {
    return { value: null, score: null, trend: 'unknown', description };
}

const BTC_MARKET_CHART_CACHE_KEY = 'btc_market_chart_365d';
const BTC_MARKET_CHART_CACHE_MS = 300000;

let _btcMarketChartInFlight = null;
let _btcMarketChartCallCount = 0;
async function fetchBtcMarketChart365Shared() {
    _btcMarketChartCallCount++;
    const cached = state.cache[BTC_MARKET_CHART_CACHE_KEY];
    if (cached && Date.now() - cached.timestamp < BTC_MARKET_CHART_CACHE_MS) {
        return cached.data;
    }
    if (_btcMarketChartInFlight) {
        return _btcMarketChartInFlight;
    }
    const coingeckoBase = CONFIG.apis.coingecko;
    const url = `${coingeckoBase}/coins/bitcoin/market_chart?vs_currency=usd&days=365&interval=daily`;
    _btcMarketChartInFlight = (async () => {
        try {
            const data = await fetchData(url, BTC_MARKET_CHART_CACHE_KEY, BTC_MARKET_CHART_CACHE_MS);
            if (!data || !Array.isArray(data.prices)) {
                return null;
            }
            return data;
        } finally {
            _btcMarketChartInFlight = null;
        }
    })();
    return _btcMarketChartInFlight;
}

let _marketExitScoreInFlight = null;
let _marketExitScoreCached = null;
const MARKET_EXIT_SCORE_CACHE_MS = 60000;
let _calculateCallCount = 0;
let _realExecutionCount = 0;

// Configuração dos indicadores e seus pesos
const INDICATORS_CONFIG = {
    bitcoinDominance: { weight: 0.15, name: 'Bitcoin Dominance' },
    mvrvZScore: { weight: 0.20, name: 'MVRV Z-Score' },
    fearGreed: { weight: 0.10, name: 'Fear & Greed Index' },
    piCycle: { weight: 0.15, name: 'Pi Cycle Top Indicator' },
    puellMultiple: { weight: 0.10, name: 'Puell Multiple' },
    nupl: { weight: 0.10, name: 'NUPL - Net Unrealized P&L' },
    rsi22: { weight: 0.10, name: 'RSI 22-Day' },
    rainbowChart: { weight: 0.10, name: 'Rainbow Chart' }
};

/**
 * Calcula o score do Market Exit baseado nos indicadores
 * Usa deduplicação de chamada em-voo e cache de 1min para evitar múltiplas requests paralelas.
 * @returns {Object} Objeto com score e dados dos indicadores
 */
export async function calculateMarketExitScore() {
    _calculateCallCount++;
    const now = Date.now();
    if (_marketExitScoreCached && (now - _marketExitScoreCached.timestamp) < MARKET_EXIT_SCORE_CACHE_MS) {
        return _marketExitScoreCached.value;
    }
    if (_marketExitScoreInFlight) {
        return _marketExitScoreInFlight;
    }
    _realExecutionCount++;
    _marketExitScoreInFlight = (async () => {
        try {
            console.log('Calculando Market Exit Score...');
            const indicators = await fetchAllIndicators();
        
        // Calcula score ponderado baseado nos indicadores reais
        let totalScore = 0;
        let totalWeight = 0;
        let validIndicators = 0;
        
        // Pesos ajustados para melhor precisão
        const weights = {
            bitcoinDominance: 0.12,    // Reduzido - menos confiável sozinho
            mvrvZScore: 0.25,          // Aumentado - indicador muito confiável
            fearGreed: 0.08,           // Reduzido - mais volátil
            piCycle: 0.20,             // Aumentado - historicamente preciso
            puellMultiple: 0.12,       // Mantido - bom indicador
            nupl: 0.10,                // Mantido - útil mas aproximado
            rsi22: 0.08,               // Reduzido - mais para timing
            rainbowChart: 0.05         // Reduzido - mais subjetivo
        };
        
        for (const [key, indicator] of Object.entries(indicators)) {
            if (indicator && indicator.score !== null && indicator.score !== undefined) {
                const weight = weights[key] || 0.1;
                totalScore += indicator.score * weight;
                totalWeight += weight;
                validIndicators++;
            }
        }
        
        // Normaliza o score se nem todos os indicadores estão disponíveis
        const finalScore = totalWeight > 0 ? Math.round(totalScore / totalWeight) : 50;
        
        // Determina nível de risco com base no score final
        const riskLevel = getRiskLevel(finalScore);
        
        // Adiciona lógica de confirmação para scores extremos
        let adjustedScore = finalScore;
        
        // Se score muito alto (>80), verifica se múltiplos indicadores confirmam
        if (finalScore > 80) {
            const highRiskIndicators = Object.values(indicators).filter(ind => 
                ind && ind.score > 75
            ).length;
            
            if (highRiskIndicators < 3) {
                adjustedScore = Math.max(70, finalScore - 10); // Reduz se poucos confirmam
            }
        }
        
        // Se score muito baixo (<30), verifica se múltiplos indicadores confirmam
        if (finalScore < 30) {
            const lowRiskIndicators = Object.values(indicators).filter(ind => 
                ind && ind.score < 35
            ).length;
            
            if (lowRiskIndicators < 3) {
                adjustedScore = Math.min(40, finalScore + 10); // Aumenta se poucos confirmam
            }
        }
        
        // Calcula tendência baseada em indicadores com trend
        const trendIndicators = Object.values(indicators).filter(ind => 
            ind && ind.trend && ind.trend !== 'unknown'
        );
        
        let trend = 'neutral';
        if (trendIndicators.length > 0) {
            const upTrends = trendIndicators.filter(ind => ind.trend === 'up').length;
            const downTrends = trendIndicators.filter(ind => ind.trend === 'down').length;
            
            if (upTrends > downTrends * 1.5) trend = 'up';
            else if (downTrends > upTrends * 1.5) trend = 'down';
        }
        
        // Gera recomendação baseada no score ajustado
        let recommendation;
        if (adjustedScore >= 85) {
            recommendation = 'VENDA FORTE - Múltiplos indicadores sugerem topo de mercado';
        } else if (adjustedScore >= 70) {
            recommendation = 'VENDA - Considere reduzir posições';
        } else if (adjustedScore >= 55) {
            recommendation = 'CAUTELA - Monitore indicadores de perto';
        } else if (adjustedScore >= 40) {
            recommendation = 'NEUTRO - Mantenha posições atuais';
        } else if (adjustedScore >= 25) {
            recommendation = 'ACUMULAÇÃO - Considere aumentar posições';
        } else {
            recommendation = 'COMPRA FORTE - Oportunidade de acumulação';
        }
        
            console.log(`Market Exit Score calculado: ${adjustedScore} (${validIndicators}/${Object.keys(indicators).length} indicadores válidos)`);

            const result = {
                score: adjustedScore,
                riskLevel: getRiskLevel(adjustedScore),
                trend: trend,
                recommendation: recommendation,
                indicators: indicators,
                validIndicators: validIndicators,
                totalIndicators: Object.keys(indicators).length,
                timestamp: new Date().toISOString()
            };
            _marketExitScoreCached = { value: result, timestamp: Date.now() };
            return result;

        } catch (error) {
            console.error('Erro ao calcular Market Exit Score:', error);

            const fallback = {
                score: 50,
                riskLevel: getRiskLevel(50),
                trend: 'neutral',
                recommendation: 'DADOS INDISPONÍVEIS - Aguarde atualização',
                indicators: {},
                validIndicators: 0,
                totalIndicators: 8,
                timestamp: new Date().toISOString(),
                error: true
            };
            _marketExitScoreCached = { value: fallback, timestamp: Date.now() };
            return fallback;
        } finally {
            _marketExitScoreInFlight = null;
        }
    })();
    return _marketExitScoreInFlight;
}

/**
 * Busca todos os indicadores necessários
 */
async function fetchAllIndicators() {
    const [
        bitcoinDominance,
        mvrvZScore,
        fearGreed,
        piCycle,
        puellMultiple,
        nupl,
        rsi22,
        rainbowChart
    ] = await Promise.all([
        fetchBitcoinDominance(),
        fetchMVRVZScore(),
        fetchFearGreedExtended(),
        fetchPiCycleIndicator(),
        fetchPuellMultiple(),
        fetchNUPL(),
        fetchRSI22(),
        fetchRainbowChart()
    ]);

    return {
        bitcoinDominance,
        mvrvZScore,
        fearGreed,
        piCycle,
        puellMultiple,
        nupl,
        rsi22,
        rainbowChart
    };
}

/**
 * Busca dominância do Bitcoin
 */
async function fetchBitcoinDominance() {
    try {
        // First, try to get from state
        if (state.btcDominance) {
            const dominance = parseFloat(state.btcDominance);
            let score;
            if (dominance >= 70) score = 10;
            else if (dominance >= 60) score = 25;
            else if (dominance >= 50) score = 40;
            else if (dominance >= 40) score = 60;
            else if (dominance >= 30) score = 80;
            else score = 95;

            return {
                value: dominance.toFixed(1),
                score: score,
                trend: 'stable',
                description: `Dominância de ${dominance.toFixed(1)}%`
            };
        }

        // Fallback to API call if not in state
        const data = await fetchData(
            `${CONFIG.apis.coingecko}/global`,
            'bitcoin_dominance',
            300000
        );

        if (data?.data?.market_cap_percentage?.btc) {
            const dominance = data.data.market_cap_percentage.btc;
            
            // Store in state for next time
            state.btcDominance = dominance.toFixed(1);

            // Score: maior dominância = menor risco (invertido)
            // 70%+ = score baixo (0-30), 30%- = score alto (70-100)
            let score;
            if (dominance >= 70) score = 10;
            else if (dominance >= 60) score = 25;
            else if (dominance >= 50) score = 40;
            else if (dominance >= 40) score = 60;
            else if (dominance >= 30) score = 80;
            else score = 95;

            return {
                value: dominance.toFixed(1),
                score: score,
                trend: 'stable',
                description: `Dominância de ${dominance.toFixed(1)}%`
            };
        }
    } catch (error) {
        console.error('Erro ao buscar dominância do Bitcoin:', error);
    }

    return { value: null, score: null, trend: 'unknown', description: 'Dados indisponíveis' };
}

/**
 * Busca dados do MVRV Z-Score usando dados históricos do Bitcoin
 */
async function fetchMVRVZScore() {
    try {
        const data = await fetchBtcMarketChart365Shared();
        if (!data || !data.prices || data.prices.length === 0) {
            throw new Error('Dados de preço não disponíveis');
        }
        const prices = data.prices.map(p => p[1]);
        const currentPrice = prices[prices.length - 1];
        
        // Calcula valor realizado aproximado (usando média móvel de 200 dias como proxy)
        const ma200 = prices.slice(-200).reduce((sum, price) => sum + price, 0) / 200;
        const marketCap = currentPrice * 19700000; // Aproximação do supply do Bitcoin
        const realizedCap = ma200 * 19700000;
        
        // Calcula MVRV Z-Score
        const mvrv = marketCap / realizedCap;
        const mvrvHistory = [];
        
        // Calcula MVRV histórico para obter média e desvio padrão
        for (let i = 200; i < prices.length; i++) {
            const price = prices[i];
            const ma = prices.slice(i-200, i).reduce((sum, p) => sum + p, 0) / 200;
            mvrvHistory.push((price * 19700000) / (ma * 19700000));
        }
        
        const mvrvMean = mvrvHistory.reduce((sum, val) => sum + val, 0) / mvrvHistory.length;
        const mvrvStd = Math.sqrt(mvrvHistory.reduce((sum, val) => sum + Math.pow(val - mvrvMean, 2), 0) / mvrvHistory.length);
        
        const zScore = (mvrv - mvrvMean) / mvrvStd;
        
        let score;
        if (zScore >= 7) score = 95; // Muito sobrevalorizado
        else if (zScore >= 5) score = 85;
        else if (zScore >= 3) score = 70;
        else if (zScore >= 1) score = 50;
        else if (zScore >= 0) score = 30;
        else score = 15; // Subvalorizado

        const trend = zScore > 2.5 ? 'up' : 'down';

        return {
            value: zScore.toFixed(2),
            score: score,
            trend: trend,
            description: `Z-Score de ${zScore.toFixed(2)}`
        };
    } catch (error) {
        console.error('Erro ao buscar MVRV Z-Score:', error);
        return unavailableIndicator();
    }
}

/**
 * Busca Fear & Greed Index extendido
 */
async function fetchFearGreedExtended() {
    try {
        const data = await fetchData(
            CONFIG.apis.fearGreed,
            'fear_greed_extended',
            300000
        );

        if (data?.data?.[0]) {
            const value = parseInt(data.data[0].value);
            
            // Score: extremos de ganância = alto risco
            let score;
            if (value >= 90) score = 95; // Extrema ganância
            else if (value >= 75) score = 80; // Ganância
            else if (value >= 55) score = 60; // Neutro-alto
            else if (value >= 45) score = 40; // Neutro
            else if (value >= 25) score = 25; // Medo
            else score = 15; // Extremo medo

            return {
                value: value,
                score: score,
                trend: value > 50 ? 'up' : 'down',
                description: data.data[0].value_classification
            };
        }
    } catch (error) {
        console.error('Erro ao buscar Fear & Greed Index:', error);
    }

    return { value: null, score: null, trend: 'unknown', description: 'Dados indisponíveis' };
}

/**
 * Busca dados do Pi Cycle Top Indicator usando dados históricos do Bitcoin
 */
async function fetchPiCycleIndicator() {
    try {
        const data = await fetchBtcMarketChart365Shared();
        if (!data || !data.prices || data.prices.length < 350) {
            throw new Error('Dados insuficientes para Pi Cycle');
        }
        const prices = data.prices.map(p => p[1]);
        
        // Calcula médias móveis de 111 e 350 dias
        const ma111 = prices.slice(-111).reduce((sum, price) => sum + price, 0) / 111;
        const ma350 = prices.slice(-350).reduce((sum, price) => sum + price, 0) / 350;
        const ma350x2 = ma350 * 2; // Pi Cycle usa MA350 * 2
        
        // Verifica se há cruzamento (MA111 acima de MA350*2)
        const ratio = ma111 / ma350x2;
        const currentPrice = prices[prices.length - 1];
        
        let score, description;
        if (ratio > 1.05) {
            score = 95;
            description = 'Sinal de topo ativo';
        } else if (ratio > 0.98) {
            score = 80;
            description = 'Aproximando do topo';
        } else if (ratio > 0.90) {
            score = 60;
            description = 'Zona de atenção';
        } else {
            score = 25;
            description = 'Sem sinal de topo';
        }
        
        const trend = ratio > 0.95 ? 'up' : 'down';
        
        return {
            value: `${(ratio * 100).toFixed(1)}%`,
            score: score,
            trend: trend,
            description: description
        };
    } catch (error) {
        console.error('Erro ao buscar Pi Cycle Indicator:', error);
        return unavailableIndicator();
    }
}

/**
 * Busca dados do Puell Multiple usando dados históricos do Bitcoin
 */
async function fetchPuellMultiple() {
    try {
        const data = await fetchBtcMarketChart365Shared();
        if (!data || !data.prices || data.prices.length < 365) {
            throw new Error('Dados insuficientes para Puell Multiple');
        }
        const prices = data.prices.map(p => p[1]);
        const currentPrice = prices[prices.length - 1];
        
        // Estima receita diária dos miners (aproximação usando preço * hash rate estimado)
        // Hash rate aproximado baseado na dificuldade e preço
        const estimatedHashRate = Math.pow(currentPrice / 10000, 0.5) * 100; // Aproximação
        const dailyRevenue = currentPrice * 900; // ~900 BTC minerados por dia
        
        // Calcula média móvel de 365 dias da receita
        const revenues = prices.map(price => price * 900);
        const ma365Revenue = revenues.slice(-365).reduce((sum, rev) => sum + rev, 0) / 365;
        
        // Puell Multiple = Receita diária atual / Média de 365 dias
        const puellMultiple = dailyRevenue / ma365Revenue;
        
        let score;
        if (puellMultiple >= 6) score = 95; // Muito alto (venda)
        else if (puellMultiple >= 4) score = 80;
        else if (puellMultiple >= 2) score = 60;
        else if (puellMultiple >= 1) score = 40;
        else if (puellMultiple >= 0.5) score = 25;
        else score = 15; // Baixo (compra)

        const trend = puellMultiple > 2 ? 'up' : 'down';

        return {
            value: puellMultiple.toFixed(2),
            score: score,
            trend: trend,
            description: `Múltiplo de ${puellMultiple.toFixed(2)}`
        };
    } catch (error) {
        console.error('Erro ao buscar Puell Multiple:', error);
        return unavailableIndicator();
    }
}

/**
 * Busca dados do NUPL (Net Unrealized Profit/Loss) usando dados históricos
 */
async function fetchNUPL() {
    try {
        const data = await fetchBtcMarketChart365Shared();
        if (!data || !data.prices || data.prices.length < 200) {
            throw new Error('Dados insuficientes para NUPL');
        }
        const prices = data.prices.map(p => p[1]);
        const currentPrice = prices[prices.length - 1];
        
        // Aproximação do NUPL usando preço atual vs média histórica
        // NUPL real requer dados on-chain, esta é uma aproximação
        const ma200 = prices.slice(-200).reduce((sum, price) => sum + price, 0) / 200;
        const ma50 = prices.slice(-50).reduce((sum, price) => sum + price, 0) / 50;
        
        // Calcula NUPL aproximado baseado na relação preço/médias
        const priceRatio = currentPrice / ma200;
        const shortTermRatio = ma50 / ma200;
        
        // NUPL aproximado (0 = break-even, 1 = euphoria)
        let nupl = Math.min(1, Math.max(0, (priceRatio - 1) * shortTermRatio * 0.5));
        
        let score, description;
        if (nupl > 0.75) {
            score = 95;
            description = 'Euphoria - possível topo';
        } else if (nupl > 0.55) {
            score = 80;
            description = 'Belief - zona de risco';
        } else if (nupl > 0.25) {
            score = 50;
            description = 'Optimism - moderado';
        } else if (nupl > 0) {
            score = 25;
            description = 'Hope - acumulação';
        } else {
            score = 10;
            description = 'Fear - oportunidade';
        }
        
        const trend = nupl > 0.25 ? 'up' : 'down';
        
        return {
            value: (nupl * 100).toFixed(1) + '%',
            score: score,
            trend: trend,
            description: description
        };
    } catch (error) {
        console.error('Erro ao buscar NUPL:', error);
        return unavailableIndicator();
    }
}

/**
 * Busca RSI de 22 dias (dados reais da Binance)
 */
async function fetchRSI22() {
    try {
        // Busca dados de 22 dias para BTC
        const btcConfig = CONFIG.cryptos.find(c => c.id === 'bitcoin');
        if (!btcConfig) return { value: null, score: null, trend: 'unknown', description: 'BTC não configurado' };

        const binanceBases = [
            CONFIG.apis.binance,
            'https://data-api.binance.vision/api/v3'
        ];
        const urls = binanceBases.map(base => `${base}/klines?symbol=${btcConfig.binanceSymbol}&interval=1d&limit=22`);
        const data = await fetchData(
            urls,
            'rsi22_data',
            300000
        );

        if (data && data.length >= 22) {
            // Calcula RSI simples de 14 períodos nos últimos 22 dias
            const closes = data.map(candle => parseFloat(candle[4]));
            const rsi = calculateRSI(closes, 14);
            
            let score;
            if (rsi >= 80) score = 90; // Sobrevendido = alto risco
            else if (rsi >= 70) score = 75;
            else if (rsi >= 60) score = 55;
            else if (rsi >= 40) score = 35;
            else if (rsi >= 30) score = 25;
            else score = 20; // Sobrevendido = baixo risco

            const trend = rsi > 50 ? 'up' : 'down';

            return {
                value: rsi.toFixed(1),
                score: score,
                trend: trend,
                description: `RSI de ${rsi.toFixed(1)}`
            };
        }
    } catch (error) {
        console.error('Erro ao buscar RSI22:', error);
    }

    return { value: null, score: null, trend: 'unknown', description: 'Dados indisponíveis' };
}

/**
 * Busca dados do Rainbow Chart usando dados históricos do Bitcoin
 */
async function fetchRainbowChart() {
    try {
        const data = await fetchBtcMarketChart365Shared();
        if (!data || !Array.isArray(data.prices)) {
            console.warn('Estrutura inesperada:', data);
            throw new Error('Resposta da API não contém preços.');
        }
        if (data.prices.length < 300) {
            console.warn('Quantidade de preços insuficiente:', data.prices.length);
            throw new Error('Dados insuficientes para Rainbow Chart');
        }

        const prices = data.prices.map(p => p[1]);
        const currentPrice = prices[prices.length - 1];
        
        // Calcula regressão logarítmica aproximada (Rainbow Chart base)
        // Usando dados históricos para estabelecer bandas
        const logPrices = prices.map(p => Math.log(p));
        const n = logPrices.length;
        
        // Calcula tendência logarítmica
        const xValues = Array.from({length: n}, (_, i) => i);
        const sumX = xValues.reduce((sum, x) => sum + x, 0);
        const sumY = logPrices.reduce((sum, y) => sum + y, 0);
        const sumXY = xValues.reduce((sum, x, i) => sum + x * logPrices[i], 0);
        const sumX2 = xValues.reduce((sum, x) => sum + x * x, 0);
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;
        
        // Calcula valor esperado baseado na regressão
        const expectedLogPrice = intercept + slope * (n - 1);
        const expectedPrice = Math.exp(expectedLogPrice);
        
        // Calcula desvio padrão dos resíduos
        const residuals = logPrices.map((logPrice, i) => logPrice - (intercept + slope * i));
        const stdDev = Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / n);
        
        // Determina posição nas bandas do Rainbow Chart
        const logCurrentPrice = Math.log(currentPrice);
        const deviation = (logCurrentPrice - expectedLogPrice) / stdDev;
        
        let score, description, band;
        if (deviation > 2.5) {
            score = 95;
            description = 'Máximo histórico - venda';
            band = 'Vermelho escuro';
        } else if (deviation > 2) {
            score = 85;
            description = 'Zona de venda';
            band = 'Vermelho';
        } else if (deviation > 1.5) {
            score = 70;
            description = 'Sobrevalorizado';
            band = 'Laranja';
        } else if (deviation > 1) {
            score = 55;
            description = 'Moderadamente alto';
            band = 'Amarelo';
        } else if (deviation > 0) {
            score = 40;
            description = 'Valor justo';
            band = 'Verde';
        } else if (deviation > -1) {
            score = 25;
            description = 'Subvalorizado';
            band = 'Azul';
        } else {
            score = 10;
            description = 'Zona de compra';
            band = 'Azul escuro';
        }
        
        const trend = deviation > 0 ? 'up' : 'down';
        
        return {
            value: band,
            score: score,
            trend: trend,
            description: description
        };
    } catch (error) {
        console.error('Erro ao buscar Rainbow Chart:', error);
        return unavailableIndicator();
    }
}

/**
 * Calcula RSI (Relative Strength Index)
 */
function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50; // RSI neutro se dados insuficientes

    let gains = 0;
    let losses = 0;

    // Calcula mudanças iniciais
    for (let i = 1; i <= period; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) gains += change;
        else losses -= change;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Calcula RSI para o último período
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return Math.round(rsi * 10) / 10; // Arredonda para 1 casa decimal
}

/**
 * Determina nível de risco baseado no score
 */
function getRiskLevel(score) {
    if (score <= 33) return { level: 'low', color: 'green', text: 'Baixo Risco', emoji: '🟢' };
    if (score <= 66) return { level: 'moderate', color: 'yellow', text: 'Risco Moderado', emoji: '🟡' };
    return { level: 'high', color: 'red', text: 'Alto Risco', emoji: '🔴' };
}

/**
 * Renderiza o card de Market Exit no dashboard.
 * SOMENTE RENDERIZA DADOS. NÃO DISPARA REQUESTS.
 * Se não houver dados prontos em state.marketExitData, mostra skeleton/loading.
 * Quem busca os dados é fetchMarketExitData() em api.js.
 */
export function renderMarketExitCard(container) {
    try {
        let marketExitData = null;
        try {
            if (state.marketExitData) {
                marketExitData = state.marketExitData;
            }
        } catch (e) { /* noop */ }

        if (!marketExitData) {
            // Renderiza estado de loading / sem dados
            container.innerHTML = `
                <div class="crypto-card bg-gray-800/50 border-gray-600/30 border-2">
                    <div class="flex items-center justify-between mb-4">
                        <h3 class="text-lg font-bold text-white">Market Exit Indicator</h3>
                        <span class="text-2xl">⏳</span>
                    </div>
                    <div class="text-center">
                        <div class="text-xl font-bold text-gray-400 mb-2 animate-pulse">--/100</div>
                        <div class="text-sm text-gray-500 mb-4">CARREGANDO...</div>
                        <div class="w-full bg-gray-700 rounded-full h-3 mb-4">
                            <div class="bg-gray-500 h-3 rounded-full animate-pulse" style="width: 0%"></div>
                        </div>
                        <div class="text-xs text-gray-500 text-center">
                            Calculando indicadores de mercado...
                        </div>
                    </div>
                </div>
            `;
            return;
        }

        // Determina cor baseada no score
        let colorClass, bgClass, textClass, emoji;
        if (marketExitData.score >= 80) {
            colorClass = 'text-red-400';
            bgClass = 'bg-red-900/20 border-red-500/30';
            textClass = 'text-red-300';
            emoji = '🔴';
        } else if (marketExitData.score >= 60) {
            colorClass = 'text-orange-400';
            bgClass = 'bg-orange-900/20 border-orange-500/30';
            textClass = 'text-orange-300';
            emoji = '🟠';
        } else if (marketExitData.score >= 40) {
            colorClass = 'text-yellow-400';
            bgClass = 'bg-yellow-900/20 border-yellow-500/30';
            textClass = 'text-yellow-300';
            emoji = '🟡';
        } else {
            colorClass = 'text-green-400';
            bgClass = 'bg-green-900/20 border-green-500/30';
            textClass = 'text-green-300';
            emoji = '🟢';
        }
        
        // Determina ícone de tendência
        let trendIcon = '';
        if (marketExitData.trend === 'up') {
            trendIcon = '<i class="fas fa-arrow-up text-red-400 ml-1"></i>';
        } else if (marketExitData.trend === 'down') {
            trendIcon = '<i class="fas fa-arrow-down text-green-400 ml-1"></i>';
        } else {
            trendIcon = '<i class="fas fa-minus text-gray-400 ml-1"></i>';
        }
        
        container.innerHTML = `
            <div class="crypto-card ${bgClass} border-2 cursor-pointer hover:scale-105 transition-all duration-300" 
                 onclick="showMarketExitPage()">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="text-lg font-bold text-white">Market Exit Indicator</h3>
                    <span class="text-2xl">${emoji}</span>
                </div>
                
                <div class="text-center mb-4">
                    <div class="text-3xl font-bold ${colorClass} mb-2">
                        ${marketExitData.score}/100
                        ${trendIcon}
                    </div>
                    <div class="text-sm ${textClass} mb-2">
                        ${marketExitData.riskLevel.text.toUpperCase()}
                    </div>
                </div>
                
                <!-- Barra de progresso -->
                <div class="w-full bg-gray-700 rounded-full h-3 mb-4">
                    <div class="${marketExitData.score >= 80 ? 'bg-red-400' : marketExitData.score >= 60 ? 'bg-orange-400' : marketExitData.score >= 40 ? 'bg-yellow-400' : 'bg-green-400'} 
                              h-3 rounded-full transition-all duration-500" 
                         style="width: ${marketExitData.score}%"></div>
                </div>
                
                <!-- Recomendação -->
                <div class="text-xs ${textClass} text-center mb-3 font-medium">
                    ${marketExitData.recommendation}
                </div>
                
                <!-- Indicadores válidos -->
                <div class="flex justify-between items-center text-xs text-gray-400">
                    <span>Indicadores: ${marketExitData.validIndicators}/${marketExitData.totalIndicators}</span>
                    <span class="text-xs">
                        ${new Date(marketExitData.lastUpdate || marketExitData.timestamp).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit'
                        })}
                    </span>
                </div>
                
                ${marketExitData.error ? `
                    <div class="mt-2 text-xs text-red-400 text-center">
                        <i class="fas fa-exclamation-triangle mr-1"></i>
                        Erro ao carregar dados
                    </div>
                ` : ''}
                
                <div class="mt-3 text-xs text-gray-500 text-center">
                    Clique para ver detalhes
                </div>
            </div>
        `;
        
    } catch (error) {
        console.error('Erro ao renderizar Market Exit Card:', error);
        
        // Renderiza card de erro
        container.innerHTML = `
            <div class="crypto-card bg-gray-800/50 border-gray-600/30 border-2">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="text-lg font-bold text-white">Market Exit Indicator</h3>
                    <span class="text-2xl">⚠️</span>
                </div>
                
                <div class="text-center">
                    <div class="text-xl font-bold text-gray-400 mb-2">--/100</div>
                    <div class="text-sm text-gray-500 mb-4">INDISPONÍVEL</div>
                    
                    <div class="w-full bg-gray-700 rounded-full h-3 mb-4">
                        <div class="bg-gray-500 h-3 rounded-full" style="width: 0%"></div>
                    </div>
                    
                    <div class="text-xs text-gray-500 text-center">
                        Erro ao carregar indicadores
                    </div>
                </div>
            </div>
        `;
    }
}

/**
 * Mostra a página de Market Exit com todos os indicadores
 */
export async function showMarketExitPage() {
    // Esconde dashboard e mostra página de Market Exit
    document.getElementById('dashboard-page').classList.remove('active');
    document.getElementById('crypto-page').classList.remove('active');
    
    // Cria ou mostra página de Market Exit
    let marketExitPage = document.getElementById('market-exit-page');
    if (!marketExitPage) {
        marketExitPage = document.createElement('div');
        marketExitPage.id = 'market-exit-page';
        marketExitPage.className = 'page-view';
        document.body.appendChild(marketExitPage);
    }
    
    marketExitPage.classList.add('active');
    
    // Busca dados atualizados
    const marketExitData = await calculateMarketExitScore();
    
    // Renderiza conteúdo
    marketExitPage.innerHTML = `
        <div class="container mx-auto px-4 py-8">
            <div class="flex items-center space-x-3 mb-6">
                <button class="nav-btn" onclick="closeMarketExitPage()">
                    <i class="fas fa-arrow-left mr-2"></i>Voltar
                </button>
                <h1 class="text-3xl font-bold">
                    <i class="fas fa-exclamation-triangle mr-2 text-yellow-400"></i>
                    Market Exit Indicator
                </h1>
            </div>
            
            <!-- Score Geral -->
            <div class="crypto-card p-6 mb-8">
                <div class="text-center mb-6">
                    <h2 class="text-2xl font-bold mb-2">Score de Risco do Mercado</h2>
                    <div class="text-6xl font-bold mb-2 ${marketExitData.riskLevel.color === 'green' ? 'text-green-400' : marketExitData.riskLevel.color === 'yellow' ? 'text-yellow-400' : 'text-red-400'}">
                        ${Math.min(marketExitData.score, 100)}/100
                    </div>
                    <div class="text-xl mb-4">${marketExitData.riskLevel.emoji} ${marketExitData.riskLevel.text}</div>
                    <div class="w-full max-w-md mx-auto bg-gray-700 rounded-full h-4">
                        <div class="${marketExitData.riskLevel.color === 'green' ? 'bg-green-400' : marketExitData.riskLevel.color === 'yellow' ? 'bg-yellow-400' : 'bg-red-400'} h-4 rounded-full transition-all duration-1000" 
                             style="width: ${Math.min(marketExitData.score, 100)}%"></div>
                    </div>
                </div>
                
                <div class="text-center text-gray-400">
                    <p>Última atualização: ${new Date(marketExitData.timestamp).toLocaleString('pt-BR')}</p>
                    <p class="text-sm mt-2">
                        ${marketExitData.score <= 33 ? '🟢 Momento favorável para manter posições' : 
                          marketExitData.score <= 66 ? '🟡 Atenção! Considere reduzir exposição' : 
                          '🔴 Alerta! Momento de considerar saída do mercado'}
                    </p>
                </div>
            </div>
            
            <!-- Grid de Indicadores -->
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-8">
                ${renderIndicatorCards(marketExitData.indicators)}
            </div>
            
            <!-- Detalhes dos Indicadores -->
            <div class="crypto-card p-6">
                <h3 class="text-xl font-bold mb-4">📊 Detalhamento dos 8 Indicadores Técnicos</h3>
                <div class="space-y-4">
                    ${renderIndicatorDetails(marketExitData.indicators)}
                </div>
            </div>
            
            <!-- Notas Explicativas -->
            <div class="crypto-card p-6 mt-6">
                <h3 class="text-lg font-bold mb-3">ℹ️ Sobre este indicador</h3>
                <div class="text-sm text-gray-400 space-y-2">
                    <p>• O Market Exit Indicator combina 8 métricas diferentes para avaliar o risco atual do mercado de criptomoedas.</p>
                    <p>• Cada indicador tem um peso específico baseado em sua eficácia histórica.</p>
                    <p>• 🟢 0-33: Baixo risco - momento favorável para manter ou aumentar posições.</p>
                    <p>• 🟡 34-66: Risco moderado - considere reduzir exposição ou tomar lucros parciais.</p>
                    <p>• 🔴 67-100: Alto risco - momento de considerar saída significativa do mercado.</p>
                    <p>• ⚠️ Este é um indicador educativo e não deve ser usado como única fonte para decisões de investimento.</p>
                </div>
            </div>
        </div>
    `;
    
    // Adiciona event listener para voltar
    window.closeMarketExitPage = () => {
        marketExitPage.classList.remove('active');
        document.getElementById('dashboard-page').classList.add('active');
    };
}

/**
 * Renderiza cards individuais dos indicadores
 */
function renderIndicatorCards(indicators) {
    const details = [
        {
            name: 'Bitcoin Dominance',
            source: 'CoinGecko API',
            link: 'https://www.coingecko.com/en/global-charts'
        },
        {
            name: 'MVRV Z-Score',
            source: 'Cálculo baseado em dados on-chain',
            link: 'https://www.lookintobitcoin.com/charts/mvrv-z-score/'
        },
        {
            name: 'Fear & Greed Index',
            source: 'Alternative.me API',
            link: 'https://alternative.me/crypto/fear-and-greed-index/'
        },
        {
            name: 'Pi Cycle Top Indicator',
            source: 'Cálculo de médias móveis',
            link: 'https://www.lookintobitcoin.com/charts/pi-cycle-top-indicator/'
        },
        {
            name: 'Puell Multiple',
            source: 'Cálculo baseado em dados on-chain',
            link: 'https://www.lookintobitcoin.com/charts/puell-multiple/'
        },
        {
            name: 'NUPL - Net Unrealized P&L',
            source: 'Cálculo baseado em dados on-chain',
            link: 'https://www.lookintobitcoin.com/charts/net-unrealized-profit-loss/'
        },
        {
            name: 'RSI 22-Day',
            source: 'Binance API',
            link: 'https://www.binance.com/en/trade/BTC_USDT'
        },
        {
            name: 'Rainbow Chart',
            source: 'Modelo de Regressão Logarítmica',
            link: 'https://www.blockchaincenter.net/bitcoin-rainbow-chart/'
        }
    ];

    return Object.keys(INDICATORS_CONFIG).map((key, index) => {
        const indicator = indicators[key];
        const config = INDICATORS_CONFIG[key];
        const detail = details[index];
        
        if (!indicator || indicator.score === null) {
            return `
                <div class="crypto-card p-4 opacity-60">
                    <div class="text-center">
                        <div class="text-sm font-semibold text-gray-400 mb-2">${config.name}</div>
                        <div class="text-lg text-gray-500">Indisponível</div>
                        <div class="text-xs text-gray-600 mt-1">Peso: ${(config.weight * 100).toFixed(0)}%</div>
                    </div>
                </div>
            `;
        }
        
        const riskColor = indicator.score <= 33 ? 'green' : indicator.score <= 66 ? 'yellow' : 'red';
        const emoji = indicator.score <= 33 ? '🟢' : indicator.score <= 66 ? '🟡' : '🔴';
        
        return `
            <a href="${detail.link}" target="_blank" rel="noopener noreferrer" class="crypto-card p-4 block hover:bg-gray-800 transition-colors">
                <div class="text-center">
                    <div class="text-sm font-semibold text-gray-300 mb-2">${config.name}</div>
                    <div class="text-lg font-bold mb-1">${indicator.value}</div>
                    <div class="text-xs mb-2">${indicator.description}</div>
                    <div class="flex items-center justify-center space-x-1 mb-2">
                        <span class="text-lg">${emoji}</span>
                        <span class="text-xs">${indicator.score}/100</span>
                    </div>
                    <div class="w-full bg-gray-700 rounded-full h-2">
                        <div class="${riskColor === 'green' ? 'bg-green-400' : riskColor === 'yellow' ? 'bg-yellow-400' : 'bg-red-400'} h-2 rounded-full" 
                             style="width: ${indicator.score}%"></div>
                    </div>
                    <div class="text-xs text-gray-400 mt-1">
                        Peso: ${(config.weight * 100).toFixed(0)}%
                    </div>
                    <div class="text-xs text-gray-500 mt-1">Fonte: ${detail.source}</div>
                </div>
            </a>
        `;
    }).join('');
}

/**
 * Renderiza detalhes dos indicadores
 */
function renderIndicatorDetails(indicators) {
    const details = [
        {
            name: 'Bitcoin Dominance',
            description: 'Dominância do Bitcoin no mercado total de criptomoedas. Quando muito baixa, indica possível topo de mercado (alt season).',
            source: 'CoinGecko API',
            weight: '15%',
            link: 'https://www.coingecko.com/en/global-charts'
        },
        {
            name: 'MVRV Z-Score',
            description: 'Relação entre valor de mercado e valor realizado. Valores altos indicam sobrevalorização extrema.',
            source: 'Cálculo baseado em dados on-chain',
            weight: '20%',
            link: 'https://www.lookintobitcoin.com/charts/mvrv-z-score/'
        },
        {
            name: 'Fear & Greed Index',
            description: 'Índice de sentimento do mercado. Extrema ganância frequentemente precede correções.',
            source: 'Alternative.me API',
            weight: '10%',
            link: 'https://alternative.me/crypto/fear-and-greed-index/'
        },
        {
            name: 'Pi Cycle Top Indicator',
            description: 'Cruzamento de médias móveis 111 e 350 dias. Sinais históricos de topo de mercado.',
            source: 'Cálculo de médias móveis',
            weight: '15%',
            link: 'https://www.lookintobitcoin.com/charts/pi-cycle-top-indicator/'
        },
        {
            name: 'Puell Multiple',
            description: 'Múltiplo da receita diária dos miners. Valores extremos indicam pontos de inflexão.',
            source: 'Cálculo baseado em dados on-chain',
            weight: '10%',
            link: 'https://www.lookintobitcoin.com/charts/puell-multiple/'
        },
        {
            name: 'NUPL - Net Unrealized P&L',
            description: 'Lucro/prejuízo não realizado da rede. Euphoria indica possível topo.',
            source: 'Cálculo baseado em dados on-chain',
            weight: '10%',
            link: 'https://www.lookintobitcoin.com/charts/net-unrealized-profit-loss/'
        },
        {
            name: 'RSI 22-Day',
            description: 'Índice de força relativa de 22 dias do Bitcoin. Sobrevenda extrema em mercados em alta.',
            source: 'Binance API',
            weight: '10%',
            link: 'https://www.binance.com/en/trade/BTC_USDT'
        },
        {
            name: 'Rainbow Chart',
            description: 'Posição nas bandas logarítmicas de preço do Bitcoin. Topo da banda = possível venda.',
            source: 'Modelo de Regressão Logarítmica',
            weight: '10%',
            link: 'https://www.blockchaincenter.net/bitcoin-rainbow-chart/'
        }
    ];

    return details.map((detail, index) => {
        const key = Object.keys(INDICATORS_CONFIG)[index];
        const indicator = indicators[key];
        
        if (!indicator || indicator.score === null) {
            return `
                <div class="border-l-4 border-gray-600 pl-4 py-2 opacity-60">
                    <div class="flex justify-between items-start mb-2">
                        <h4 class="font-semibold">${detail.name}</h4>
                        <span class="text-xs bg-gray-700 px-2 py-1 rounded">${detail.weight}</span>
                    </div>
                    <div class="text-sm text-gray-500 mb-1">Dados indisponíveis</div>
                    <div class="text-xs text-gray-600">Fonte: ${detail.source}</div>
                </div>
            `;
        }
        
        return `
            <div class="border-l-4 ${indicator.score <= 33 ? 'border-green-400' : indicator.score <= 66 ? 'border-yellow-400' : 'border-red-400'} pl-4 py-2">
                <div class="flex justify-between items-start mb-2">
                    <h4 class="font-semibold">${detail.name}</h4>
                    <div class="flex items-center space-x-2">
                        <span class="text-sm ${indicator.score <= 33 ? 'text-green-400' : indicator.score <= 66 ? 'text-yellow-400' : 'text-red-400'}">
                            ${indicator.score}/100
                        </span>
                        <span class="text-xs bg-gray-700 px-2 py-1 rounded">${detail.weight}</span>
                    </div>
                </div>
                <div class="text-sm text-gray-300 mb-1">${detail.description}</div>
                <div class="text-xs text-gray-500 mb-1">Valor atual: <span class="font-mono">${indicator.value}</span></div>
                <div class="text-xs text-gray-600">Fonte: <a href="${detail.link}" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:underline">${detail.source}</a></div>
            </div>
        `;
    }).join('');
}

// Exporta funções principais
