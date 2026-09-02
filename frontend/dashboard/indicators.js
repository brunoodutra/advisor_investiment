/**
 * 📊 Módulo de Indicadores Técnicos
 * Implementa cálculos e visualizações de indicadores técnicos para o gráfico
 */

/**
 * Calcula Simple Moving Average (SMA)
 * @param {Array} data - Array de dados de preço (valores numéricos)
 * @param {number} period - Período da média móvel
 * @returns {Array} Array com valores da SMA
 */
export function calculateSMA(data, period) {
    console.log(`🔢 Calculating SMA(${period}) with ${data.length} data points`);
    
    if (!data || data.length < period) {
        console.warn(`⚠️ Insufficient data for SMA(${period}): need ${period}, have ${data?.length || 0}`);
        return [];
    }
    
    const smaData = [];
    
    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += data[i - j].close;
        }
        const smaValue = sum / period;
        
        smaData.push({
            time: data[i].time,
            value: smaValue
        });
    }
    
    console.log(`✅ SMA(${period}) calculated: ${smaData.length} points, first: ${smaData[0]?.value?.toFixed(2)}, last: ${smaData[smaData.length-1]?.value?.toFixed(2)}`);
    return smaData;
}

/**
 * Calcula Exponential Moving Average (EMA)
 * @param {Array} data - Array de dados de preço
 * @param {number} period - Período da média móvel
 * @returns {Array} Array com valores da EMA
 */
export function calculateEMA(data, period) {
    console.log(`🔢 Calculating EMA(${period}) with ${data.length} data points`);
    
    if (!data || data.length < period) {
        console.warn(`⚠️ Insufficient data for EMA(${period}): need ${period}, have ${data?.length || 0}`);
        return [];
    }
    
    const emaData = [];
    const multiplier = 2 / (period + 1);
    
    // Primeira EMA é a SMA do período
    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += data[i].close;
    }
    let ema = sum / period;
    
    emaData.push({
        time: data[period - 1].time,
        value: ema
    });
    
    // Calcular EMA para o resto dos dados
    for (let i = period; i < data.length; i++) {
        ema = (data[i].close * multiplier) + (ema * (1 - multiplier));
        emaData.push({
            time: data[i].time,
            value: ema
        });
    }
    
    console.log(`✅ EMA(${period}) calculated: ${emaData.length} points, first: ${emaData[0]?.value?.toFixed(2)}, last: ${emaData[emaData.length-1]?.value?.toFixed(2)}`);
    return emaData;
}

/**
 * Calcula níveis de retração de Fibonacci
 * @param {number} high - Preço máximo
 * @param {number} low - Preço mínimo
 * @param {boolean} isUptrend - Se é uma tendência de alta (true) ou baixa (false)
 * @returns {Object} Objeto com os níveis de Fibonacci
 */
export function calculateFibonacciLevels(high, low, isUptrend = true) {
    const diff = high - low;
    const levels = {};
    
    const fibRatios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    const fibExtensions = [1.272, 1.618, 2.618];
    
    if (isUptrend) {
        // Retração em tendência de alta (do high para baixo)
        fibRatios.forEach(ratio => {
            levels[`${(ratio * 100).toFixed(1)}%`] = high - (diff * ratio);
        });
        
        // Extensões
        fibExtensions.forEach(ratio => {
            levels[`${(ratio * 100).toFixed(1)}%`] = high - (diff * ratio);
        });
    } else {
        // Retração em tendência de baixa (do low para cima)
        fibRatios.forEach(ratio => {
            levels[`${(ratio * 100).toFixed(1)}%`] = low + (diff * ratio);
        });
        
        // Extensões
        fibExtensions.forEach(ratio => {
            levels[`${(ratio * 100).toFixed(1)}%`] = low + (diff * ratio);
        });
    }
    
    return levels;
}

/**
 * Calcula RSI (Relative Strength Index)
 * @param {Array} data - Array de dados de preço
 * @param {number} period - Período do RSI (padrão: 14)
 * @returns {Array} Array com valores do RSI
 */
export function calculateRSI(data, period = 14) {
    if (!data || data.length < period + 1) return [];
    
    const rsi = [];
    const gains = [];
    const losses = [];
    
    // Calcular ganhos e perdas
    for (let i = 1; i < data.length; i++) {
        const change = data[i].close - data[i - 1].close;
        gains.push(change > 0 ? change : 0);
        losses.push(change < 0 ? Math.abs(change) : 0);
    }
    
    // Calcular RSI
    for (let i = period - 1; i < gains.length; i++) {
        let avgGain = 0;
        let avgLoss = 0;
        
        if (i === period - 1) {
            // Primeira média simples
            for (let j = 0; j < period; j++) {
                avgGain += gains[i - j];
                avgLoss += losses[i - j];
            }
            avgGain /= period;
            avgLoss /= period;
        } else {
            // Média móvel suavizada
            const prevAvgGain = rsi[rsi.length - 1].avgGain;
            const prevAvgLoss = rsi[rsi.length - 1].avgLoss;
            
            avgGain = (prevAvgGain * (period - 1) + gains[i]) / period;
            avgLoss = (prevAvgLoss * (period - 1) + losses[i]) / period;
        }
        
        const rs = avgGain / avgLoss;
        const rsiValue = 100 - (100 / (1 + rs));
        
        rsi.push({
            time: data[i + 1].time,
            value: rsiValue,
            avgGain: avgGain,
            avgLoss: avgLoss
        });
    }
    
    return rsi;
}

/**
 * Calcula MACD (Moving Average Convergence Divergence)
 * @param {Array} data - Array de dados de preço
 * @param {number} fastPeriod - Período da EMA rápida (padrão: 12)
 * @param {number} slowPeriod - Período da EMA lenta (padrão: 26)
 * @param {number} signalPeriod - Período da linha de sinal (padrão: 9)
 * @returns {Object} Objeto com MACD, Signal e Histogram
 */
export function calculateMACD(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (!data || data.length < slowPeriod) return { macd: [], signal: [], histogram: [] };
    
    const fastEMA = calculateEMA(data, fastPeriod);
    const slowEMA = calculateEMA(data, slowPeriod);
    
    const macdLine = [];
    const startIndex = slowPeriod - fastPeriod;
    
    // Calcular linha MACD
    for (let i = 0; i < fastEMA.length - startIndex; i++) {
        macdLine.push({
            time: fastEMA[i + startIndex].time,
            value: fastEMA[i + startIndex].value - slowEMA[i].value
        });
    }
    
    // Calcular linha de sinal (EMA do MACD)
    const signalLine = calculateEMA(macdLine.map(item => ({ close: item.value, time: item.time })), signalPeriod);
    
    // Calcular histograma
    const histogram = [];
    for (let i = 0; i < signalLine.length; i++) {
        const macdIndex = macdLine.findIndex(item => item.time === signalLine[i].time);
        if (macdIndex !== -1) {
            histogram.push({
                time: signalLine[i].time,
                value: macdLine[macdIndex].value - signalLine[i].value
            });
        }
    }
    
    return {
        macd: macdLine,
        signal: signalLine,
        histogram: histogram
    };
}

/**
 * Configurações padrão dos indicadores
 */
export const INDICATORS_CONFIG = {
    movingAverages: {
        sma: {
            periods: [20, 50, 100, 200],
            colors: ['#fbbf24', '#3b82f6', '#10b981', '#ef4444'],
            enabled: [true, true, false, false]
        },
        ema: {
            periods: [12, 26, 50, 200],
            colors: ['#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899'],
            enabled: [false, false, true, false]
        }
    },
    fibonacci: {
        levels: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1],
        extensions: [1.272, 1.618, 2.618],
        colors: {
            retracement: '#6b7280',
            extension: '#9ca3af'
        },
        enabled: false
    },
    rsi: {
        period: 14,
        overbought: 70,
        oversold: 30,
        color: '#8b5cf6',
        enabled: false
    },
    macd: {
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        colors: {
            macd: '#3b82f6',
            signal: '#ef4444',
            histogram: '#6b7280'
        },
        enabled: false
    }
};

/**
 * Classe para gerenciar indicadores no gráfico
 */
export class IndicatorsManager {
    constructor(chart) {
        this.chart = chart;
        this.indicators = {
            sma: {},
            ema: {},
            fibonacci: null,
            rsi: null,
            macd: null
        };
        this.config = { ...INDICATORS_CONFIG };
    }
    
    /**
     * Adiciona médias móveis ao gráfico
     * @param {Array} data - Dados de candlestick
     * @param {string} type - Tipo de média ('sma' ou 'ema')
     */
    addMovingAverages(data, type = 'sma') {
        const config = this.config.movingAverages[type];
        
        config.periods.forEach((period, index) => {
            if (!config.enabled[index]) return;
            
            let maData;
            if (type === 'sma') {
                const prices = data.map(candle => candle.close);
                maData = calculateSMA(prices.map((price, i) => ({ time: data[i].time, close: price })), period);
            } else {
                maData = calculateEMA(data, period);
            }
            
            if (maData.length > 0) {
                const series = this.chart.addLineSeries({
                    color: config.colors[index],
                    lineWidth: 2,
                    title: `${type.toUpperCase()}(${period})`
                });
                
                series.setData(maData);
                this.indicators[type][period] = series;
            }
        });
    }
    
    /**
     * Remove médias móveis do gráfico
     * @param {string} type - Tipo de média ('sma' ou 'ema')
     */
    removeMovingAverages(type = 'sma') {
        Object.values(this.indicators[type]).forEach(series => {
            this.chart.removeSeries(series);
        });
        this.indicators[type] = {};
    }
    
    /**
     * Adiciona uma média móvel específica
     * @param {string} id - ID único do indicador
     * @param {Array} data - Dados de candlestick
     * @param {number} period - Período da média
     * @param {string} type - Tipo ('sma' ou 'ema')
     */
    addMovingAverage(id, data, period, type = 'sma') {
        console.log(`🔵 Adding Moving Average: ${id}, type: ${type}, period: ${period}, data length: ${data.length}`);

        // Evitar duplicatas: remover série existente por id ou aninhada por tipo/período
        try {
            const existingById = this.indicators[id];
            if (existingById && existingById.series) {
                this.chart.removeSeries(existingById.series);
                delete this.indicators[id];
            }
        } catch (_) {}

        try {
            if (this.indicators[type] && this.indicators[type][period]) {
                this.chart.removeSeries(this.indicators[type][period]);
                delete this.indicators[type][period];
            }
        } catch (_) {}
        
        if (!data || data.length === 0) {
            console.error('❌ No data provided for moving average');
            return;
        }

        let calculatedData;
        if (type === 'sma') {
            calculatedData = calculateSMA(data, period);
        } else if (type === 'ema') {
            calculatedData = calculateEMA(data, period);
        } else {
            console.error(`❌ Unknown moving average type: ${type}`);
            return;
        }

        console.log(`📊 Calculated ${type.toUpperCase()} data:`, calculatedData.slice(0, 5), '...');

        if (!calculatedData || calculatedData.length === 0) {
            console.error(`❌ No calculated data for ${type.toUpperCase()}`);
            return;
        }

        const color = type === 'sma' ? 
            (period === 20 ? '#2563eb' : '#dc2626') : 
            (period === 12 ? '#059669' : '#7c3aed');

        try {
            const series = this.chart.addLineSeries({
                color: color,
                lineWidth: 2,
                title: `${type.toUpperCase()}(${period})`
            });

            series.setData(calculatedData);
            this.indicators[id] = { series, type: 'ma', config: { period, type } };
            
            console.log(`✅ Moving Average ${id} added successfully to chart`);
        } catch (error) {
            console.error(`❌ Error adding moving average series to chart:`, error);
        }
    }
    
    /**
     * Atualiza uma média móvel específica
     * @param {string} id - ID único do indicador
     * @param {Array} data - Dados de candlestick
     * @param {number} period - Período da média
     * @param {string} type - Tipo ('sma' ou 'ema')
     */
    updateMovingAverage(id, data, period, type = 'sma') {
    const maData = type === 'sma' ? calculateSMA(data, period) : calculateEMA(data, period);
    if (!maData || maData.length === 0) return;

    if (this.indicators[id] && this.indicators[id].series) {
        this.indicators[id].series.setData(maData);
        console.log('MA updated [id]', type, period);
        return;
    }

    const nested = this.indicators[type] && this.indicators[type][period];
    if (nested) {
        nested.setData(maData);
        console.log('MA updated [nested]', type, period);
    }
}
    updateFibonacci(id, data) {
        if (this.indicators.fibonacci) {
            this.removeIndicator('fibonacci');
            this.addFibonacci(id, data);
        }
    }
    
    /**
     * Adiciona RSI
     * @param {string} id - ID único do indicador
     * @param {Array} data - Dados de candlestick
     */
    addRSI(id, data) {
        console.log('📊 Adding RSI indicator:', id);
        
        const rsiData = calculateRSI(data);
        
        if (rsiData && rsiData.length > 0) {
            const rsiSeries = this.chart.addLineSeries({
                color: '#8b5cf6',
                lineWidth: 2,
                title: 'RSI(14)',
                priceScaleId: 'rsi',
                scaleMargins: { top: 0.1, bottom: 0.1 }
            });
            
            // Configurar escala do RSI
            this.chart.priceScale('rsi').applyOptions({
                scaleMargins: { top: 0.1, bottom: 0.1 },
                autoScale: false,
                mode: 0, // Normal mode
                invertScale: false,
                alignLabels: true,
                borderVisible: false,
                borderColor: '#485158',
                textColor: '#b2b5be',
                entireTextOnly: false,
                visible: true,
                ticksVisible: true,
                minimumWidth: 0,
            });
            
            rsiSeries.setData(rsiData);
            this.indicators.rsi = rsiSeries;
            console.log(`✅ RSI added with ${rsiData.length} points`);
        } else {
            console.warn('⚠️ No RSI data calculated');
        }
    }
    
    /**
     * Atualiza RSI
     * @param {string} id - ID único do indicador
     * @param {Array} data - Dados de candlestick
     */
    updateRSI(id, data) {
        if (this.indicators.rsi) {
            const rsiData = calculateRSI(data);
            if (rsiData && rsiData.length > 0) {
                this.indicators.rsi.setData(rsiData);
                console.log('🔄 RSI updated');
            }
        }
    }
    
    /**
     * Adiciona MACD
     * @param {string} id - ID único do indicador
     * @param {Array} data - Dados de candlestick
     */
    addMACD(id, data) {
        console.log('📊 Adding MACD indicator:', id);
        
        const macdData = calculateMACD(data);
        
        if (macdData && macdData.macd.length > 0) {
            const macdSeries = this.chart.addLineSeries({
                color: '#3b82f6',
                lineWidth: 2,
                title: 'MACD',
                priceScaleId: 'macd'
            });
            
            const signalSeries = this.chart.addLineSeries({
                color: '#ef4444',
                lineWidth: 2,
                title: 'Signal',
                priceScaleId: 'macd'
            });
            
            const histogramSeries = this.chart.addHistogramSeries({
                color: '#6b7280',
                title: 'Histogram',
                priceScaleId: 'macd'
            });
            
            // Configurar escala do MACD
            this.chart.priceScale('macd').applyOptions({
                scaleMargins: { top: 0.1, bottom: 0.1 },
                autoScale: true
            });
            
            macdSeries.setData(macdData.macd);
            signalSeries.setData(macdData.signal);
            histogramSeries.setData(macdData.histogram);
            
            this.indicators.macd = {
                macd: macdSeries,
                signal: signalSeries,
                histogram: histogramSeries
            };
            
            console.log(`✅ MACD added with ${macdData.macd.length} points`);
        } else {
            console.warn('⚠️ No MACD data calculated');
        }
    }
    
    /**
     * Atualiza MACD
     * @param {string} id - ID único do indicador
     * @param {Array} data - Dados de candlestick
     */
    updateMACD(id, data) {
        if (this.indicators.macd) {
            const macdData = calculateMACD(data);
            if (macdData && macdData.macd.length > 0) {
                this.indicators.macd.macd.setData(macdData.macd);
                this.indicators.macd.signal.setData(macdData.signal);
                this.indicators.macd.histogram.setData(macdData.histogram);
                console.log('🔄 MACD updated');
            }
        }
    }
    
    /**
     * Remove um indicador específico
     * @param {string} type - Tipo do indicador
     */
    removeIndicator(type) {
    console.log(`??? Removing ${type} indicator`);

    // Handle moving averages by id (e.g., 'sma20', 'ema50')
    if (type.startsWith('sma') || type.startsWith('ema')) {
        const direct = this.indicators[type];
        if (direct && direct.series) {
            this.chart.removeSeries(direct.series);
            delete this.indicators[type];
            return;
        }
        const maType = type.startsWith('sma') ? 'sma' : 'ema';
        const periodStr = type.slice(maType.length);
        const period = parseInt(periodStr);
        if (!isNaN(period) && this.indicators[maType] && this.indicators[maType][period]) {
            this.chart.removeSeries(this.indicators[maType][period]);
            delete this.indicators[maType][period];
            return;
        }
    }

    if (type === 'fibonacci') {
        if (this.indicators.fibonacci && Array.isArray(this.indicators.fibonacci)) {
            this.indicators.fibonacci.forEach(series => this.chart.removeSeries(series));
            this.indicators.fibonacci = null;
        }
    } else if (type === 'rsi') {
        if (this.indicators.rsi) {
            this.chart.removeSeries(this.indicators.rsi);
            this.indicators.rsi = null;
        }
    } else if (type === 'macd') {
        if (this.indicators.macd) {
            this.chart.removeSeries(this.indicators.macd.macd);
            this.chart.removeSeries(this.indicators.macd.signal);
            this.chart.removeSeries(this.indicators.macd.histogram);
            this.indicators.macd = null;
        }
    }
}
    toggleMovingAverage(type, period, data) {
        const config = this.config.movingAverages[type];
        const periodIndex = config.periods.indexOf(period);
        
        if (periodIndex === -1) return;
        
        config.enabled[periodIndex] = !config.enabled[periodIndex];
        
        if (config.enabled[periodIndex]) {
            // Adicionar
            let maData;
            if (type === 'sma') {
                const prices = data.map(candle => candle.close);
                maData = calculateSMA(prices.map((price, i) => ({ time: data[i].time, close: price })), period);
            } else {
                maData = calculateEMA(data, period);
            }
            
            if (maData.length > 0) {
                const series = this.chart.addLineSeries({
                    color: config.colors[periodIndex],
                    lineWidth: 2,
                    title: `${type.toUpperCase()}(${period})`
                });
                
                series.setData(maData);
                this.indicators[type][period] = series;
            }
        } else {
            // Remover
            if (this.indicators[type][period]) {
                this.chart.removeSeries(this.indicators[type][period]);
                delete this.indicators[type][period];
            }
        }
    }
    
    /**
     * Limpa todos os indicadores
     */
    clearAllIndicators() {
        // Remover médias móveis
        ['sma', 'ema'].forEach(type => {
            Object.values(this.indicators[type]).forEach(series => {
                this.chart.removeSeries(series);
            });
            this.indicators[type] = {};
        });
        
        // Remover outros indicadores
        ['fibonacci', 'rsi', 'macd'].forEach(type => {
            if (this.indicators[type]) {
                if (Array.isArray(this.indicators[type])) {
                    this.indicators[type].forEach(series => this.chart.removeSeries(series));
                } else {
                    this.chart.removeSeries(this.indicators[type]);
                }
                this.indicators[type] = null;
            }
        });
    }
    
    /**
     * Atualiza configuração dos indicadores
     * @param {Object} newConfig - Nova configuração
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }
    
    /**
     * Obtém configuração atual
     * @returns {Object} Configuração atual
     */
    getConfig() {
        return this.config;
    }
}

/**
 * Utilitários para formatação
 */
export const IndicatorUtils = {
    /**
     * Formata valor para exibição
     * @param {number} value - Valor a ser formatado
     * @param {number} decimals - Número de casas decimais
     * @returns {string} Valor formatado
     */
    formatValue(value, decimals = 2) {
        return value.toFixed(decimals);
    },
    
    /**
     * Obtém cor baseada no valor do RSI
     * @param {number} rsiValue - Valor do RSI
     * @returns {string} Cor em hexadecimal
     */
    getRSIColor(rsiValue) {
        if (rsiValue >= 70) return '#ef4444'; // Sobrecompra - vermelho
        if (rsiValue <= 30) return '#10b981'; // Sobrevenda - verde
        return '#6b7280'; // Neutro - cinza
    },
    
    /**
     * Obtém cor baseada no valor do MACD
     * @param {number} macdValue - Valor do MACD
     * @param {number} signalValue - Valor da linha de sinal
     * @returns {string} Cor em hexadecimal
     */
    getMACDColor(macdValue, signalValue) {
        return macdValue > signalValue ? '#10b981' : '#ef4444';
    }
};








