import { CONFIG } from './config.js?v=20260828a';
import { state } from './state.js?v=20260828a';
import { fetchCandlestickData, fetchRecommendationHistory } from './api.js?v=20260828a';
import { IndicatorsManager } from './indicators.js?v=20260828a';
import { createRecommendationMarkers, debounce, normalizeTimeToCandle, updateCandleData, formatCurrency, normalizeUpdateIntervalMs } from './utils.js?v=20260828a';
import { showPage, loadCryptoRecommendation, loadCryptoSentiment, showRecommendationTooltip, showNotification } from './ui.js?v=20260828a';
import { saveUserSettings } from './userSettings.js?v=20260828a';

const darkThemeOptions = {
    chart: {
        layout: {
            background: { type: 'solid', color: '#2d3748' },
            textColor: '#a0aec0',
        },
        grid: {
            vertLines: { color: 'rgba(74, 85, 104, 0.5)' },
            horzLines: { color: 'rgba(74, 85, 104, 0.5)' },
        },
        rightPriceScale: {
            borderColor: 'rgba(74, 85, 104, 0.8)',
            scaleMargins: {
                top: 0.1,
                bottom: 0.05,
            },
            entireTextOnly: true,
        },
        timeScale: {
            borderColor: 'rgba(74, 85, 104, 0.8)',
            timeVisible: true,
            secondsVisible: false
        },
    },
};

/**
 * Initializes the Lightweight Chart.
 */
export function initializeLightweightChart() {
    const chartContainer = document.getElementById("chart-container");
    if (!chartContainer) return;

    // Clear existing chart
    if (state.lightweightChart) {
        state.lightweightChart.remove();
        state.lightweightChart = null;
    }
    chartContainer.innerHTML = "";
    
    const themeChartConfig = darkThemeOptions.chart;
    try {
        state.lightweightChart = LightweightCharts.createChart(chartContainer, {
            width: chartContainer.clientWidth,
            height: chartContainer.clientHeight,
            layout: themeChartConfig.layout,
            grid: themeChartConfig.grid,
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
            rightPriceScale: themeChartConfig.rightPriceScale,
            timeScale: themeChartConfig.timeScale,
            handleScroll: true,
            handleScale: true,
        });
                
        console.log("Chart object created with dark theme options.");
        
        // Add click handler for ruler - CORREÇÃO APLICADA
        state.lightweightChart.subscribeClick((param) => {
            console.log('📊 Chart click event received:', param);
            handleChartClick(param);
        });

        state.candlestickSeries = state.lightweightChart.addCandlestickSeries({
            upColor: '#10b981',
            downColor: '#ef4444',
            borderDownColor: '#ef4444',
            borderUpColor: '#10b981',
            wickDownColor: '#ef4444',
            wickUpColor: '#10b981',
            priceScaleId: 'right',
        });

        state.volumeSeries = state.lightweightChart.addHistogramSeries({
            color: "#26a69a",
            priceFormat: { type: "volume" },
            priceScaleId: "",
            scaleMargins: { top: 0.8, bottom: 0 },
        });

        state.lightweightChart.priceScale("").applyOptions({
            scaleMargins: { top: 0.8, bottom: 0 },
        });

        // Inicializar controle de atualização
        state.chartUpdateControl = {
            lastCandleTime: 0,
            lastRecommendationTime: 0,
            isUpdating: false,
            updateInterval: null,
            lastPriceData: null
        };

        // Initialize indicators manager
        state.indicatorsManager = new IndicatorsManager(state.lightweightChart);
        


        window.addEventListener('resize', debounce(() => {
            if (state.lightweightChart) {
                state.lightweightChart.resize(chartContainer.clientWidth, chartContainer.clientHeight);
            }
        }, 200));

        console.log("LightweightChart initialized successfully");
    } catch (error) {
        console.error("Error initializing LightweightChart:", error);
    }
}

/**
 * Loads the Lightweight Chart with data for a specific cryptocurrency.
 * @param {string} cryptoId The ID of the cryptocurrency.
 */
export async function loadLightweightChart(cryptoId) {
    // Ensure the correct timeframe button is visually active
    document.querySelectorAll('#timeframe-buttons .nav-btn').forEach(btn => btn.classList.remove('active'));
    const activeButton = document.querySelector(`[data-timeframe="${state.settings.timeframe}"]`);
    if (activeButton) {
        activeButton.classList.add('active');
    }

    if (!cryptoId) {
        console.error("Crypto ID não fornecido");
        return;
    }

    const config = CONFIG.cryptos.find(c => c.id === cryptoId);
    if (!config) {
        console.error("Configuração não encontrada para o ID de criptomoeda fornecido");
        return;
    }

    // Initialize chart if it doesn't exist
    initializeLightweightChart();

    if (!state.lightweightChart || !state.candlestickSeries || !state.volumeSeries) {
        console.warn("Gráfico não inicializado corretamente");
        return;
    }

    try {
        // Fetch initial data
        const [candlestickData, recommendationHistory] = await Promise.all([
            fetchCandlestickData(config.symbol),
            fetchRecommendationHistory(config.symbol)
        ]);

        console.log('DEBUG: Full recommendation history:', recommendationHistory);
        console.log('DEBUG: First recommendation percentage:', recommendationHistory[0]?.percentage);

        if (!candlestickData || !recommendationHistory) {
            console.error("Dados não encontrados");
            return;
        }

        // Store data in state
        state.candlestickData = [...candlestickData];
        state.recommendationHistory = [...recommendationHistory];

        // Set initial data
        const candleData = candlestickData.map(d => ({ 
            time: d.time, 
            open: d.open, 
            high: d.high, 
            low: d.low, 
            close: d.close 
        }));
        const volumeData = candlestickData.map(d => ({ 
            time: d.time, 
            value: d.value, 
            color: d.color 
        }));

        state.candlestickSeries.setData(candleData);
        state.volumeSeries.setData(volumeData);

        // Add recommendation markers with confidence threshold
        const markers = createRecommendationMarkers(recommendationHistory, candlestickData, state.settings.confidenceThreshold);
        state.candlestickSeries.setMarkers(markers);

        // Update indicators if they are active
        if (state.indicatorsManager) {
            const { updateIndicators } = await import('./indicatorControls.js');
            updateIndicators();
        }

        // Update control timestamps
        if (candlestickData.length > 0) {
            state.chartUpdateControl.lastCandleTime = candlestickData[candlestickData.length - 1].time;
        }
        if (recommendationHistory.length > 0) {
            state.chartUpdateControl.lastRecommendationTime = recommendationHistory[recommendationHistory.length - 1].time;
        }

        // Set initial view with auto-zoom
        if (candleData.length > 0) {
            const lastIndex = candleData.length - 1;
            const visibleCandles = CONFIG.chart.defaultVisibleCandles - 1; // -1 porque o índice começa em 0
            const startIndex = Math.max(0, lastIndex - visibleCandles);

            console.log('Aplicando auto-zoom:', { lastIndex, startIndex, totalCandles: candleData.length, visibleCandles: visibleCandles + 1 });

            // Apply auto-zoom with improved reliability and price scaling
            const applyAutoZoom = () => {
                if (state.lightweightChart && state.lightweightChart.timeScale) {
                    try {
                        state.lightweightChart.timeScale().setVisibleLogicalRange({ 
                            from: startIndex, 
                            to: lastIndex + 5 
                        });
                        
                        // Fit content to ensure proper price scaling
                        //state.lightweightChart.timeScale().fitContent();
                        
                        console.log('✅ Auto-zoom aplicado com sucesso:', { startIndex, lastIndex });
                    } catch (error) {
                        console.warn('Erro ao aplicar auto-zoom:', error);
                        // Retry after a short delay
                        setTimeout(applyAutoZoom, 100);
                    }
                } else {
                    console.log('Chart não pronto, aguardando...');
                    // Retry if chart not ready
                    setTimeout(applyAutoZoom, 100);
                }
            };

            // Try multiple timing strategies
            requestAnimationFrame(applyAutoZoom);
            //setTimeout(applyAutoZoom, 300);
            setTimeout(applyAutoZoom, 600);

        } else {
            console.log('Sem dados de candle para aplicar auto-zoom');
        }

        // Start automatic updates
        startChartAutoUpdate(config.symbol);

        console.log("LightweightChart loaded successfully with auto-update enabled");
    } catch (error) {
        console.error("Error loading the LightweightChart:", error);
    }
}

/**
 * Starts the automatic update of the chart.
 * @param {string} symbol The cryptocurrency symbol.
 */
export function startChartAutoUpdate(symbol) {
    // Clear existing interval
    if (state.chartUpdateControl.updateInterval) {
        clearInterval(state.chartUpdateControl.updateInterval);
    }

    // Update every 60 seconds for real-time feel
    state.chartUpdateControl.updateInterval = setInterval(async () => {
        await updateLightweightChart();
    }, CONFIG.updateIntervals.chart);

    console.log(`Auto-update started for ${symbol}`);
}

/**
 * Stops the automatic update of the chart.
 */
export function stopChartAutoUpdate() {
    if (state.chartUpdateControl && state.chartUpdateControl.updateInterval) {
        clearInterval(state.chartUpdateControl.updateInterval);
        state.chartUpdateControl.updateInterval = null;
        console.log("Auto-update stopped");
    } 
}

/**
 * Updates the Lightweight Chart with new data.
 */
export async function updateLightweightChart() {
    // Prevent concurrent updates
    if (state.chartUpdateControl.isUpdating) {
        return;
    }
    
    state.chartUpdateControl.isUpdating = true;

    try {
        if (!state.lightweightChart || !state.candlestickSeries || !state.volumeSeries) {
            console.warn("Gráfico não inicializado corretamente");
            return;
        }

        const config = CONFIG.cryptos.find(c => c.id === state.currentCrypto);
        if (!config) {
            console.error("Configuração não encontrada para o ID de criptomoeda fornecido");
            return;
        }

        // Fetch updated data using existing functions
        const [newCandlestickData, newRecommendations] = await Promise.all([
            fetchCandlestickData(config.symbol),
            fetchRecommendationHistory(config.symbol)
        ]);

        if (!newCandlestickData || !Array.isArray(newCandlestickData)) {
            console.error("Dados de candlestick inválidos");
            return;
        }

        let hasUpdates = false;

        // Process candlestick updates
        const lastLocalTime = state.candlestickData.length > 0 
            ? state.candlestickData[state.candlestickData.length - 1].time 
            : 0;

        // Find new or updated candles
        const updatedCandles = newCandlestickData.filter(newCandle => 
            newCandle.time >= lastLocalTime
        );

        if (updatedCandles.length > 0) {
            updatedCandles.forEach(newCandle => {
                const existingIndex = state.candlestickData.findIndex(
                    candle => candle.time === newCandle.time
                );

                if (existingIndex >= 0) {
                    // Update existing candle
                    state.candlestickData[existingIndex] = { ...newCandle };
                    
                    const candlePoint = {
                        time: newCandle.time,
                        open: newCandle.open,
                        high: newCandle.high,
                        low: newCandle.low,
                        close: newCandle.close
                    };
                    const volumePoint = {
                        time: newCandle.time,
                        value: newCandle.value,
                        color: newCandle.color
                    };

                    state.candlestickSeries.update(candlePoint);
                    state.volumeSeries.update(volumePoint);
                    
                    console.log(`Candle atualizado: ${newCandle.close} em ${new Date(newCandle.time * 1000).toLocaleTimeString()}`);
                } else {
                    // Add new candle
                    state.candlestickData.push({ ...newCandle });
                    
                    const candlePoint = {
                        time: newCandle.time,
                        open: newCandle.open,
                        high: newCandle.high,
                        low: newCandle.low,
                        close: newCandle.close
                    };
                    const volumePoint = {
                        time: newCandle.time,
                        value: newCandle.value,
                        color: newCandle.color
                    };

                    state.candlestickSeries.update(candlePoint);
                    state.volumeSeries.update(volumePoint);
                    
                    console.log(`Novo candle criado: ${newCandle.close} em ${new Date(newCandle.time * 1000).toLocaleTimeString()}`);
                }
            });

            hasUpdates = true;

            // Auto-scroll to show latest data with improved reliability
            const applyAutoScroll = () => {
                if (state.lightweightChart && state.lightweightChart.timeScale) {
                    try {
                        const totalLength = state.candlestickData.length;
                        const lastIndex = totalLength - 1;
                        const visibleCandles = CONFIG.chart.defaultVisibleCandles - 1; // -1 porque o índice começa em 0
                        const startIndex = Math.max(0, lastIndex - visibleCandles);
                        
                        state.lightweightChart.timeScale().setVisibleLogicalRange({ 
                            from: startIndex, 
                            to: lastIndex + CONFIG.chart.autoZoomBuffer 
                        });
                        
                        // Also fit content to ensure proper price scaling
                        //state.lightweightChart.timeScale().fitContent();
                        
                        console.log('✅ Auto-scroll aplicado:', { startIndex, lastIndex, totalLength, visibleCandles: visibleCandles + 1 });
                    } catch (error) {
                        console.warn('Erro no auto-scroll:', error);
                    }
                } else {
                    console.warn('Chart não disponível para auto-scroll');
                }
            };
            
            // Apply with multiple timing strategies for better reliability
            requestAnimationFrame(applyAutoScroll);
            //setTimeout(applyAutoScroll, 100);
            // Auto-scroll to show latest data
        }

        // Update recommendations
        if (newRecommendations && Array.isArray(newRecommendations)) {
            //TODO: melhorar essa atualização
            // Obter as últimas 10 recomendações
            const latestRecommendations = newRecommendations.slice(-200);
            
            // Atualizar as recomendações no estado
            state.recommendationHistory = latestRecommendations;

            // Atualizar os marcadores com confidence threshold
            const allMarkers = createRecommendationMarkers(
                state.recommendationHistory, 
                state.candlestickData,
                state.settings.confidenceThreshold
            );
            state.candlestickSeries.setMarkers(allMarkers);

            hasUpdates = true;
            console.log(`Recomendações atualizadas: ${latestRecommendations.length} novas recomendações adicionadas`);
        }

        if (hasUpdates) {
            console.log("Gráfico atualizado com sucesso");
        }
        // show crypto insights on crypto page
        loadCryptoRecommendation(state.currentCrypto);
        loadCryptoSentiment(state.currentCrypto);

    } catch (error) {
        console.error("Erro ao atualizar o gráfico:", error);
    } finally {
        state.chartUpdateControl.isUpdating = false;
    }
}

/**
 * Cleans up the chart resources.
 */
export function cleanupChart() {
    stopChartAutoUpdate();
    
    if (state.lightweightChart) {
        state.lightweightChart.remove();
        state.lightweightChart = null;
    }
    
    state.candlestickSeries = null;
    state.volumeSeries = null;
    state.candlestickData = [];
    state.recommendationHistory = [];
    
    console.log("Chart cleanup completed");
}

/**
 * Toggles the ruler tool on the chart.
 */
export function toggleRuler() {
    console.log('🔧 toggleRuler called, current state:', state.ruler.active);
    
    state.ruler.active = !state.ruler.active;
    
    console.log('🔧 toggleRuler new state:', state.ruler.active);
    
    const rulerBtn = document.getElementById('ruler-btn');
    console.log('🔧 Ruler button found:', !!rulerBtn);
    
    if (rulerBtn) {
        if (state.ruler.active) {
            rulerBtn.classList.add('active');
            rulerBtn.innerHTML = '<i class="fas fa-ruler mr-1"></i>Régua Ativa';
            console.log('🔧 Ruler activated - clearing previous state');
            clearRuler(); // Clear any previous ruler state but keep active = true
            state.ruler.active = true; // Ensure it stays active after clearRuler
            showRulerInfo('🎯 Clique no primeiro ponto do gráfico para iniciar a medição');
        } else {
            rulerBtn.classList.remove('active');
            rulerBtn.innerHTML = '<i class="fas fa-ruler mr-1"></i>Régua';
            console.log('🔧 Ruler deactivated - clearing all');
            clearRuler();
        }
    } else {
        console.error('🔧 Ruler button not found!');
    }
    
    console.log('🔧 Final ruler state:', state.ruler.active);
}

/**
 * Clears the ruler from the chart.
 */
export function clearRuler() {
    console.log('🧹 clearRuler called');
    
    try {
        // Remove visual elements from chart
        if (state.ruler.lineSeries && state.lightweightChart) {
            state.lightweightChart.removeSeries(state.ruler.lineSeries);
            console.log('🧹 Removed line series');
        }
        
        // Clear HTML info box
        if (state.ruler.infoBox) {
            state.ruler.infoBox.remove();
            console.log('🧹 Removed info box');
        }
        
        // Clear legacy ruler info
        const rulerInfo = document.getElementById('ruler-info');
        if (rulerInfo) {
            rulerInfo.remove();
            console.log('🧹 Removed legacy ruler info');
        }
        
        // Reset ruler state BUT keep active status
        const wasActive = state.ruler.active;
        state.ruler.startPoint = null;
        state.ruler.endPoint = null;
        state.ruler.lineSeries = null;
        state.ruler.infoBox = null;
        state.ruler.isDragging = false;
        
        // CORREÇÃO CRÍTICA: não alterar o estado active aqui
        // Apenas limpar se foi chamado explicitamente para desativar
        if (arguments.length > 0 && arguments[0] === 'deactivate') {
            state.ruler.active = false;
            const rulerBtn = document.getElementById('ruler-btn');
            if (rulerBtn) {
                rulerBtn.classList.remove('active');
                rulerBtn.innerHTML = '<i class="fas fa-ruler mr-1"></i>Régua';
            }
        } else {
            // Manter o estado ativo se estava ativo
            state.ruler.active = wasActive;
        }
        
        console.log('🧹 Ruler cleared successfully, active state:', state.ruler.active);
    } catch (error) {
        console.error('🧹 Error clearing ruler:', error);
    }
}

/**
 * Handles clicks on the chart, used for the ruler functionality.
 * @param {any} param The click event parameters from the chart library.
 */
export async function handleChartClick(param) {
    console.log('📊 Chart clicked, ruler active:', state.ruler.active);
    console.log('📊 Click param:', param);

    // Handle marker click first
    if (param.hoveredObjectId !== undefined) {
        const recommendation = state.recommendationHistory[param.hoveredObjectId];
        if (recommendation) {
            const chartContainer = document.getElementById('chart-container');
            const rect = chartContainer.getBoundingClientRect();
            const x = rect.left + param.point.x;
            const y = rect.top + param.point.y;
            showRecommendationTooltip(recommendation, x, y);
        }
        return; // Stop processing to avoid activating the ruler
    }
    
    if (!state.ruler.active || !param.time || state.ruler.endPoint) {
        if (state.ruler.endPoint) console.log('📊 Ruler measurement already complete, ignoring click.');
        else console.log('📊 Ruler not active or no time in param');
        return;
    }
    
    // Múltiplos métodos para obter preço - CORREÇÃO APLICADA
    let price = null;
    
    try {
        // Method 1: Try to get price from series data
        if (param.seriesPrices && param.seriesPrices.size > 0) {
            for (let [series, priceData] of param.seriesPrices) {
                if (series === state.candlestickSeries) {
                    price = priceData && typeof priceData === 'object' ? priceData.close : priceData;
                    console.log('📊 Price from seriesPrices:', price);
                    break;
                }
            }
        }
        
        // Method 2: Use coordinate conversion (corrected API usage) - CORREÇÃO APLICADA
        if (!price && param.point && state.lightweightChart) {
            try {
                const priceScale = state.lightweightChart.priceScale('right');
                if (priceScale && typeof priceScale.coordinateToPrice === 'function') {
                    price = priceScale.coordinateToPrice(param.point.y);
                    console.log('📊 Price from coordinateToPrice:', price);
                }
            } catch (coordError) {
                console.warn('📊 coordinateToPrice failed:', coordError);
            }
        }
        
        // Method 3: Fallback - find closest candle data - CORREÇÃO APLICADA
        if (!price && state.candlestickData && state.candlestickData.length > 0) {
            const closestCandle = state.candlestickData.reduce((prev, curr) => {
                return Math.abs(curr.time - param.time) < Math.abs(prev.time - param.time) ? curr : prev;
            });
            price = closestCandle.close;
            console.log('📊 Price from closest candle:', price);
        }
        
        // Validate price - CORREÇÃO APLICADA
        if (!price || isNaN(price) || price <= 0) {
            console.warn('📊 Invalid price obtained:', price);
            showRulerInfo('❌ Erro: Não foi possível obter o preço. Tente clicar diretamente em um candle.');
            return;
        }
        
        console.log('📊 Final price obtained:', price);
        
        // Process ruler click
        if (!state.ruler.startPoint) {
            // Set start point
            state.ruler.startPoint = {
                time: param.time,
                price: parseFloat(price)
            };
            
            console.log('📊 Ruler start point set:', state.ruler.startPoint);
            showRulerInfo('✅ Primeiro ponto selecionado! Clique em outro ponto para completar a medição.');
        } else {
            // Hide and remove the first point message before setting the end point
            const rulerInfoElement = document.getElementById('ruler-info');
            if (rulerInfoElement) {
                rulerInfoElement.remove();
            }
            
            // Set end point
            state.ruler.endPoint = {
                time: param.time,
                price: parseFloat(price)
            };
            
            console.log('📊 Ruler end point set:', state.ruler.endPoint);
            
            // CORREÇÃO: validar ordem temporal e corrigir se necessário
            let startPoint = state.ruler.startPoint;
            let endPoint = state.ruler.endPoint;
            
            if (startPoint.time > endPoint.time) {
                console.log('📊 Correcting temporal order: swapping start and end points');
                [startPoint, endPoint] = [endPoint, startPoint];
                state.ruler.startPoint = startPoint;
                state.ruler.endPoint = endPoint;
            }
            
            // Create connecting line and calculate measurement
            createRulerLine();
            calculateRulerMeasurement();
            
            console.log('📊 Ruler measurement completed - staying active for persistence');
        }
        
    } catch (error) {
        console.error('📊 Error in handleChartClick:', error);
        showRulerInfo('❌ Erro interno na régua. Tente novamente.');
    }
}

/**
 * Creates the ruler line on the chart.
 */
export function createRulerLine() {
    if (!state.lightweightChart || !state.ruler.startPoint || !state.ruler.endPoint) {
        console.error('Cannot create ruler line: missing chart or points');
        return;
    }
    
    try {
        // CORREÇÃO: validação de dados antes de criar linha
        const startTime = state.ruler.startPoint.time;
        const endTime = state.ruler.endPoint.time;
        const startPrice = state.ruler.startPoint.price;
        const endPrice = state.ruler.endPoint.price;
        
        if (!startTime || !endTime || isNaN(startPrice) || isNaN(endPrice)) {
            console.error('Invalid data for ruler line:', { startTime, endTime, startPrice, endPrice });
            return;
        }
        
        // NOVA FUNCIONALIDADE: linha tracejada preta
        state.ruler.lineSeries = state.lightweightChart.addLineSeries({
            color: '#000000', // Linha preta
            lineWidth: 2,
            lineStyle: LightweightCharts.LineStyle.Dashed, // Linha tracejada
            crosshairMarkerVisible: false,
            priceLineVisible: false,
            lastValueVisible: false
        });
        
        // Add line data points com validação
        const lineData = [
            { time: startTime, value: startPrice },
            { time: endTime, value: endPrice }
        ];
        
        state.ruler.lineSeries.setData(lineData);
        
        console.log('Ruler line created connecting points with dashed black line');
    } catch (error) {
        console.error('Error creating ruler line:', error);
        showRulerInfo('❌ Erro ao criar linha da régua. Tente novamente.');
    }
}

/**
 * Calculates and displays the ruler measurement.
 */
export function calculateRulerMeasurement() {
    if (!state.ruler.startPoint || !state.ruler.endPoint) {
        console.error('Pontos da régua não definidos');
        showRulerInfo('❌ Erro: Pontos da régua não definidos corretamente.');
        return;
    }
    
    try {
        const startPrice = parseFloat(state.ruler.startPoint.price);
        const endPrice = parseFloat(state.ruler.endPoint.price);
        
        if (isNaN(startPrice) || isNaN(endPrice)) {
            console.error('Invalid prices:', { startPrice, endPrice });
            showRulerInfo('❌ Erro: Preços inválidos para cálculo.');
            return;
        }
        
        const priceDiff = endPrice - startPrice;
        const percentChange = ((priceDiff / startPrice) * 100).toFixed(2);
        
        // Calculate time difference
        const startTime = new Date(state.ruler.startPoint.time * 1000);
        const endTime = new Date(state.ruler.endPoint.time * 1000);
        const timeDiff = Math.abs(endTime - startTime);
        
        const daysDiff = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
        const hoursDiff = Math.floor((timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutesDiff = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
        
        let timeText = '';
        if (daysDiff > 0) {
            timeText = `${daysDiff}d ${hoursDiff}h`;
        } else if (hoursDiff > 0) {
            timeText = `${hoursDiff}h ${minutesDiff}m`;
        } else {
            timeText = `${minutesDiff}m`;
        }
        
        const direction = priceDiff >= 0 ? 'Alta' : 'Baixa';
        const directionColor = priceDiff >= 0 ? '#10b981' : '#ef4444';
        
        // Create draggable info box
        createDraggableInfoBox(startPrice, endPrice, priceDiff, percentChange, timeText, direction, directionColor, startTime, endTime);
        
        console.log('Ruler measurement calculated successfully:', {
            startPrice,
            endPrice,
            priceDiff,
            percentChange,
            timeText
        });
        
    } catch (error) {
        console.error('Error in ruler calculation:', error);
        showRulerInfo('❌ Erro no cálculo da medição. Tente novamente.');
    }
}

/**
 * Creates a draggable info box for the ruler measurement.
 * @param {number} startPrice The starting price.
 * @param {number} endPrice The ending price.
 * @param {number} priceDiff The difference between the start and end prices.
 * @param {string} percentChange The percentage change between the start and end prices.
 * @param {string} timeText The time difference between the start and end points.
 * @param {string} direction The direction of the price movement ('Alta' or 'Baixa').
 * @param {string} directionColor The color representing the direction of the price movement.
 * @param {Date} startTime The start time of the measurement.
 * @param {Date} endTime The end time of the measurement.
 */
export function createDraggableInfoBox(startPrice, endPrice, priceDiff, percentChange, timeText, direction, directionColor, startTime, endTime) {
    try {
        // Remove existing info box
        if (state.ruler.infoBox) {
            state.ruler.infoBox.remove();
        }
        
        // Create info box element
        const infoBox = document.createElement('div');
        infoBox.id = 'ruler-info-box';
        infoBox.className = 'ruler-info-box draggable';
        infoBox.style.cssText = `
            position: absolute;
            background: rgba(45, 55, 72, 0.95);
            border: 2px solid #4a5568;
            border-radius: 8px;
            padding: 12px;
            color: white;
            font-size: 12px;
            min-width: 280px;
            z-index: 1000;
            cursor: move;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            backdrop-filter: blur(10px);
        `;
        
        // NOVA FUNCIONALIDADE: botão × limpa TODA a seleção da régua
        infoBox.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <div style="font-weight: bold; color: #63b3ed;">📏 Medição da Régua</div>
                <button id="ruler-close-btn" style="background: #e53e3e; border: none; color: white; width: 20px; height: 20px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center;">×</button>
            </div>
            <div style="display: grid; gap: 4px;">
                <div><strong>Preço Inicial:</strong> ${formatCurrency(startPrice)}</div>
                <div><strong>Preço Final:</strong> ${formatCurrency(endPrice)}</div>
                <div style="color: ${directionColor}"><strong>Movimento:</strong> ${direction} de ${formatCurrency(Math.abs(priceDiff))} (${percentChange}%)</div>
                <div><strong>Período:</strong> ${timeText}</div>
                <div style="font-size: 10px; opacity: 0.8; margin-top: 4px;">
                    ${startTime.toLocaleDateString('pt-BR')} ${startTime.toLocaleTimeString('pt-BR')} → ${endTime.toLocaleDateString('pt-BR')} ${endTime.toLocaleTimeString('pt-BR')}
                </div>
                <div style="font-size: 10px; opacity: 0.6; margin-top: 4px; text-align: center;">
                    💡 Arraste para reposicionar
                </div>
            </div>
        `;
        
        // Position above start point (default position)
        const chartContainer = document.getElementById('chart-container');
        if (chartContainer) {
            const rect = chartContainer.getBoundingClientRect();
            infoBox.style.left = `${rect.left + 20}px`;
            infoBox.style.top = `${rect.top + 20}px`;
        }
        
        // Add to document
        document.body.appendChild(infoBox);
        state.ruler.infoBox = infoBox;

        // Add event listener to the new close button
        const closeButton = document.getElementById('ruler-close-btn');
        if (closeButton) {
            closeButton.addEventListener('click', () => clearRuler('deactivate'));
        }
        
        // Make draggable
        makeDraggable(infoBox);
        
        console.log('Draggable info box created successfully');
        
    } catch (error) {
        console.error('Error creating draggable info box:', error);
    }
}

/**
 * Makes an HTML element draggable.
 * @param {HTMLElement} element The element to make draggable.
 */
export function makeDraggable(element) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    
    element.onmousedown = dragMouseDown;
    
    function dragMouseDown(e) {
        e = e || window.event;
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
        state.ruler.isDragging = true;
    }
    
    function elementDrag(e) {
        e = e || window.event;
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        element.style.top = (element.offsetTop - pos2) + "px";
        element.style.left = (element.offsetLeft - pos1) + "px";
    }
    
    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
        state.ruler.isDragging = false;
    }
}

/**
 * Shows a message related to the ruler tool.
 * @param {string} content The message to display.
 */
export function showRulerInfo(content) {
    console.log('🎯 showRulerInfo chamado com conteúdo:', content);
    try {
        let rulerInfo = document.getElementById('ruler-info');
        console.log('🎯 Elemento ruler-info existente:', !!rulerInfo);
        
        if (!rulerInfo) {
            console.log('🎯 Criando novo elemento ruler-info');
            rulerInfo = document.createElement('div');
            rulerInfo.id = 'ruler-info';
            rulerInfo.className = 'ruler-info';
            rulerInfo.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(45, 55, 72, 0.95);
                border: 2px solid #4a5568;
                border-radius: 8px;
                padding: 16px;
                color: white;
                font-size: 14px;
                z-index: 1000;
                max-width: 300px;
                text-align: center;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            `;
            document.body.appendChild(rulerInfo);
            console.log('🎯 Elemento ruler-info criado e adicionado ao body');
        }
        
        rulerInfo.innerHTML = content;
        rulerInfo.style.display = 'block';
        console.log('🎯 Conteúdo definido e display definido como block');
        
        // Auto-hide simple messages after 3 seconds
        if (!content.includes('button') && !content.includes('Medição da Régua')) {
            setTimeout(() => {
                if (rulerInfo && rulerInfo.style.display === 'block') {
                    rulerInfo.style.display = 'none';
                    console.log('🎯 Mensagem auto-ocultada após 3 segundos');
                }
            }, 3000);
        }
    } catch (error) {
        console.error('🎯 Error showing ruler info:', error);
    }
}

/**
 * Navigates to the home dashboard.
 * Stops chart auto-update and clears ruler when returning to dashboard.
 */
export function home_dashboard() {
    stopChartAutoUpdate();
    clearRuler('deactivate'); // Clear and deactivate ruler when returning to dashboard
    showPage('dashboard');
}

/**
 * Changes the timeframe for the chart.
 * @param {string} timeframe The new timeframe (e.g., '1h', '4h', '1d').
 */
export function changeTimeframe(timeframe) {
    state.settings.timeframe = timeframe;
    
    // Update active button
    document.querySelectorAll('[data-timeframe]').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-timeframe="${timeframe}"]`)?.classList.add('active');
    
    // Reload chart with new timeframe
    if (state.currentCrypto) {
        loadLightweightChart(state.currentCrypto);
    }
}

/**
 * Changes the current cryptocurrency.
 * @param {string} cryptoId The ID of the cryptocurrency to display.
 */
export function changeCrypto(cryptoId) {
    console.log('changeCrypto chamado com cryptoId:', cryptoId);
    
    // Clear ruler when changing crypto
    clearRuler('deactivate');
    
    const config = CONFIG.cryptos.find(c => c.id === cryptoId);
    if (!config) {
        console.error('Config não encontrada para cryptoId:', cryptoId);
        return;
    }

    state.currentCrypto = cryptoId;
    
    // Update UI
    document.getElementById('crypto-title').textContent = config.name;
    document.getElementById('crypto-name').textContent = config.name;
    document.getElementById('crypto-symbol').textContent = config.symbol.toUpperCase();
    
    loadCryptoRecommendation(cryptoId);
    loadCryptoSentiment(cryptoId);

    // Load new chart
    loadLightweightChart(cryptoId);
}

/**
 * Opens the settings modal.
 */
export function openSettings() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
        modal.style.display = 'flex';
        loadSettingsValues();
    }
}

/**
 * Loads current settings into the settings modal.
 */
function loadSettingsValues() {
    const elements = {
        'settings-model': state.settings.model,
        'settings-timeframe': state.settings.timeframe,
        'settings-candles': state.settings.candles,
        'settings-update-interval': state.settings.updateInterval,
        'settings-profile': state.settings.profile,
        'settings-sound': state.settings.soundNotifications,
        'settings-confidence-threshold': state.settings.confidenceThreshold
    };
    
    Object.entries(elements).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) {
            if (element.type === 'checkbox') {
                element.checked = value;
            } else {
                element.value = value;
            }
        }
    });
}

/**
 * Saves settings from the modal.
 */
export async function saveSettings() {
    const newSettings = {
        model: document.getElementById('settings-model')?.value || state.settings.model,
        timeframe: document.getElementById('settings-timeframe')?.value || state.settings.timeframe,
        candles: parseInt(document.getElementById('settings-candles')?.value) || state.settings.candles,
        updateInterval: normalizeUpdateIntervalMs(document.getElementById('settings-update-interval')?.value || state.settings.updateInterval),
        profile: document.getElementById('settings-profile')?.value || state.settings.profile,
        soundNotifications: document.getElementById('settings-sound')?.checked || state.settings.soundNotifications,
        confidenceThreshold: parseInt(document.getElementById('settings-confidence-threshold')?.value) || state.settings.confidenceThreshold
    };
    
    // Update state
    Object.assign(state.settings, newSettings);
    
    // Save to localStorage
    localStorage.setItem('cryptoDashboardSettings', JSON.stringify(state.settings));
    window.dispatchEvent(new CustomEvent('settings:changed'));

    let backendOk = true;
    let backendError = null;
    try {
        await saveUserSettings(state.settings);
    } catch (error) {
        backendOk = false;
        backendError = error;
        console.error('Falha ao salvar configurações no backend:', error);
    }
    
    // Update active timeframe button
    document.querySelectorAll('[data-timeframe]').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-timeframe="${newSettings.timeframe}"]`)?.classList.add('active');
    
    // Close modal
    closeSettings();
    
    if (backendOk) {
        showNotification('Configurações salvas com sucesso!', 'success');
    } else {
        const msg = backendError?.code === 'PGRST205'
            ? 'Configurações salvas localmente. No Supabase, execute supabase/schema.sql (tabela user_settings) e recarregue.'
            : 'Configurações salvas localmente. Falha ao sincronizar com o Supabase.';
        showNotification(msg, 'info');
    }
    
    // Reload chart if crypto is selected
    if (state.currentCrypto) {
        loadLightweightChart(state.currentCrypto);
    }
}

/**
 * Closes the settings modal.
 */
function closeSettings() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Resets settings to default values.
 */
export async function resetSettings() {
    const defaultSettings = {
        model: 'CNN',
        timeframe: '4h',
        candles: 200,
        updateInterval: 30000,
        profile: 'moderate',
        soundNotifications: false,
        confidenceThreshold: 70
    };
    
    Object.assign(state.settings, defaultSettings);
    localStorage.setItem('cryptoDashboardSettings', JSON.stringify(state.settings));
    window.dispatchEvent(new CustomEvent('settings:changed'));
    let backendOk = true;
    let backendError = null;
    try {
        await saveUserSettings(state.settings);
    } catch (error) {
        backendOk = false;
        backendError = error;
        console.error('Falha ao salvar configurações no backend:', error);
    }
    loadSettingsValues();
    if (backendOk) {
        showNotification('Configurações resetadas para os valores padrão!', 'info');
    } else {
        const msg = backendError?.code === 'PGRST205'
            ? 'Configurações resetadas localmente. No Supabase, execute supabase/schema.sql (tabela user_settings) e recarregue.'
            : 'Configurações resetadas localmente. Falha ao sincronizar com o Supabase.';
        showNotification(msg, 'info');
    }
}
