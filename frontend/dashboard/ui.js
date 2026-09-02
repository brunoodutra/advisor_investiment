import { CONFIG } from './config.js?v=20260828a';
import { state } from './state.js?v=20260828a';
import { fetchRecommendation, fetchTargetStop, fetchData, fetchCryptoData, fetchSpecificRecommendation, fetchSentimentAnalysis, fetchCryptoNews } from './api.js?v=20260828a';
import { loadLightweightChart} from './chart.js?v=20260828a';
import { formatCurrency, formatLargeNumber, getIconUrls, setImageWithFallback } from './utils.js?v=20260828a';

function isCryptoLocked(cryptoId) {
    if (state.auth?.user) return false;
    return cryptoId !== 'bitcoin';
}

function goToAuthForUnlock() {
    state.auth.redirectTo = 'dashboard';
    showPage('auth');
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getSentimentMeta(sentiment) {
    const normalized = String(sentiment || '').trim().toLowerCase();

    switch (normalized) {
        case 'positive':
        case 'bullish':
        case 'high':
            return { label: 'Positivo', badgeClass: 'sentiment-positive', textClass: 'text-green-400' };
        case 'negative':
        case 'bearish':
        case 'low':
            return { label: 'Negativo', badgeClass: 'sentiment-negative', textClass: 'text-red-400' };
        case 'middle':
        case 'neutral':
        case 'mixed':
            return { label: 'Neutro', badgeClass: 'sentiment-neutral', textClass: 'text-yellow-400' };
        default:
            return {
                label: normalized ? normalized.toUpperCase() : 'Indisponível',
                badgeClass: 'sentiment-neutral',
                textClass: 'text-gray-300'
            };
    }
}

function createSentimentBadgeHtml(sentimentData, compact = false) {
    const meta = getSentimentMeta(sentimentData?.sentiment);
    const extraClass = compact ? ' sentiment-badge-sm' : '';
    return `<span class="sentiment-badge ${meta.badgeClass}${extraClass}">${meta.label}</span>`;
}

function createSentimentNewsHtml(newsItems = [], topNews = []) {
    if (Array.isArray(newsItems) && newsItems.length > 0) {
        return `
            <div class="mt-3">
                <div class="text-sm font-medium mb-2">Top not&iacute;cias</div>
                <ul class="sentiment-news-list text-sm text-gray-300">
                    ${newsItems.slice(0, 5).map(item => {
                        const title = escapeHtml(item?.title || 'Sem título');
                        const url = String(item?.url || '').trim();
                        const source = escapeHtml(item?.source || '');
                        const meta = source ? `<span class="text-xs text-gray-500"> · ${source}</span>` : '';
                        if (url) {
                            return `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="hover:text-white underline decoration-gray-600">${title}</a>${meta}</li>`;
                        }
                        return `<li>${title}${meta}</li>`;
                    }).join('')}
                </ul>
            </div>
        `;
    }

    if (!Array.isArray(topNews) || topNews.length === 0) {
        return '<div class="text-sm text-gray-400">Nenhuma manchete retornada pela API.</div>';
    }

    return `
        <div class="mt-3">
            <div class="text-sm font-medium mb-2">Top not&iacute;cias</div>
            <ul class="sentiment-news-list text-sm text-gray-300">
                ${topNews.slice(0, 5).map(item => `<li>${escapeHtml(item)}</li>`).join('')}
            </ul>
        </div>
    `;
}



function tryPatchCryptoPrices(container, cryptoData) {
    const nodes = container.querySelectorAll('[data-crypto-id]');
    if (!nodes.length || nodes.length < cryptoData.length) return false;
    for (const crypto of cryptoData) {
        const el = container.querySelector(`[data-crypto-id="${CSS.escape(crypto.id)}"]`);
        if (!el) return false;
        const priceEl = el.querySelector('.js-crypto-price');
        const changeEl = el.querySelector('.js-crypto-change');
        if (!priceEl || !changeEl) return false;
        const up = Number(crypto.price_change_percentage_24h) >= 0;
        priceEl.textContent = formatCurrency(crypto.current_price);
        changeEl.classList.remove('price-positive', 'price-negative');
        changeEl.classList.add(up ? 'price-positive' : 'price-negative');
        changeEl.textContent = `${up ? '+' : ''}${Number(crypto.price_change_percentage_24h || 0).toFixed(2)}%`;
        const mcap = el.querySelector('.js-crypto-mcap');
        const vol = el.querySelector('.js-crypto-vol');
        if (mcap) mcap.textContent = `$${formatLargeNumber(crypto.market_cap)}`;
        if (vol) vol.textContent = `$${formatLargeNumber(crypto.total_volume)}`;
    }
    return true;
}

/**
 * Renders the cryptocurrency data as cards or a list, depending on the current view mode.
 * @param {any[]} cryptoData An array of cryptocurrency data objects.
 */
export function renderCryptoCards(cryptoData) {
    const container = document.getElementById('crypto-cards');
    if (!container || !Array.isArray(cryptoData)) return;

    if (state.viewMode === 'list') {
        if (tryPatchCryptoPrices(container, cryptoData)) return;
        renderCryptoList(cryptoData);
        return;
    }

    if (tryPatchCryptoPrices(container, cryptoData)) return;

    container.innerHTML = '';

    cryptoData.forEach(crypto => {
        const config = CONFIG.cryptos.find(c => c.id === crypto.id);
        if (!config) return;

        const locked = isCryptoLocked(crypto.id);
        
        const changeClass = crypto.price_change_percentage_24h >= 0 ? 'price-positive' : 'price-negative';
        
        const card = document.createElement('div');
        card.className = `crypto-card p-6 relative${locked ? ' locked' : ''}`;
        card.dataset.cryptoId = crypto.id;
        card.onclick = () => locked ? goToAuthForUnlock() : showCryptoDetail(crypto.id);

        const recommendationBlock = locked
            ? `<div class="mt-4 text-sm text-gray-300">Faça login/cadastro para ver recomendação, target e stop.</div>`
            : `
                <div class="mt-4" id="recommendation-${crypto.id}">
                    <div class="flex items-center space-x-2">
                        <span class="loading"></span>
                        <span class="text-sm text-gray-400">Carregando recomendação...</span>
                    </div>
                </div>
            `;

        const sentimentBlock = locked
            ? ''
            : `
                <div class="mt-3" id="sentiment-${crypto.id}">
                    <div class="flex items-center space-x-2">
                        <span class="loading-small"></span>
                        <span class="text-sm text-gray-400">Carregando sentimento...</span>
                    </div>
                </div>
            `;
        
        const cardContent = `
            <div class="flex items-center justify-between mb-4">
                <div class="flex items-center space-x-3">
                    <img data-src="${getIconUrls(crypto.symbol).local}" data-fallback="${getIconUrls(crypto.symbol).remote}" alt="${crypto.name}" class="lazy w-12 h-12 rounded-full">
                    <div>
                        <h3 class="text-lg font-bold">${crypto.name}</h3>
                        <p class="text-gray-400">${crypto.symbol.toUpperCase()}</p>
                    </div>
                </div>
                <div class="text-right">
                    <p class="text-2xl font-bold js-crypto-price">${formatCurrency(crypto.current_price)}</p>
                    <p class="text-sm js-crypto-change ${changeClass}">
                        ${crypto.price_change_percentage_24h >= 0 ? '+' : ''}${crypto.price_change_percentage_24h.toFixed(2)}%
                    </p>
                </div>
            </div>
            
            <div class="space-y-2 text-sm">
                <div class="flex justify-between">
                    <span class="text-gray-400">Market Cap:</span>
                    <span class="js-crypto-mcap">$${formatLargeNumber(crypto.market_cap)}</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-gray-400">Volume 24h:</span>
                    <span class="js-crypto-vol">$${formatLargeNumber(crypto.total_volume)}</span>
                </div>
            </div>
            ${recommendationBlock}
            ${sentimentBlock}
        `;

        card.innerHTML = locked
            ? `
                <div class="locked-blur">${cardContent}</div>
                <div class="locked-overlay">
                    <div>
                        <div class="locked-title">Conteúdo bloqueado</div>
                        <div class="locked-subtitle">Cadastre-se para liberar todas as criptos.</div>
                    </div>
                </div>
            `
            : cardContent;
        
        container.appendChild(card);
        
        // Load recommendation and sentiment
        if (!locked) {
            loadRecommendationForCard(crypto);
            loadSentimentForCard(crypto);
        }
    });

    lazyLoadImages();
}

/**
 * Renders the cryptocurrency data as a list.
 * @param {any[]} cryptoData An array of cryptocurrency data objects.
 */
export function renderCryptoList(cryptoData) {
    const container = document.getElementById('crypto-cards');

    // 1. Create the main table structure (shell)
    const tableShell = `
        <div class="crypto-list-container">
            <div class="crypto-list-table">
                <div class="crypto-list-header">
                    <div class="crypto-col-crypto">Crypto</div>
                    <div class="crypto-col-price">Preço</div>
                    <div class="crypto-col-change">Variação 24h</div>
                    <div class="crypto-col-volume">Volume</div>
                    <div class="crypto-col-target">Target</div>
                    <div class="crypto-col-stop">Stop Loss</div>
                    <div class="crypto-col-recommendation">Recomendação</div>
                    <div class="crypto-col-sentiment">Sentimento</div>
                    <div class="crypto-col-actions">Ações</div>
                </div>
                <div class="crypto-list-body" id="crypto-list-body"></div>
            </div>
        </div>
    `;
    container.innerHTML = tableShell;

    // 2. Render rows asynchronously in chunks
    const tbody = document.getElementById('crypto-list-body');
    renderListInChunks(cryptoData, tbody);
}

/**
 * Renders a list of data into a container asynchronously, in chunks, to avoid
 * blocking the main UI thread.
 * @param {any[]} data The array of data to render.
 * @param {HTMLElement} container The container element to render the chunks into.
 */
function renderListInChunks(data, container) {
    const chunkSize = 20; // Process 20 items per frame
    let index = 0;

    function renderChunk() {
        const fragment = document.createDocumentFragment();
        const endIndex = Math.min(index + chunkSize, data.length);

        for (let i = index; i < endIndex; i++) {
            const crypto = data[i];
            const config = CONFIG.cryptos.find(c => c.id === crypto.id);
            if (!config) continue;

            const locked = isCryptoLocked(crypto.id);
            const changeClass = crypto.price_change_percentage_24h >= 0 ? 'price-positive' : 'price-negative';
            
            const row = document.createElement('div');
            row.className = `crypto-list-row${locked ? ' locked' : ''}`;
            row.dataset.cryptoId = crypto.id;
            row.onclick = () => locked ? goToAuthForUnlock() : showCryptoDetail(crypto.id);

            const rowContent = `
                <div class="crypto-col-crypto">
                    <div class="flex items-center space-x-3">
                        <img data-src="${getIconUrls(crypto.symbol).local}" data-fallback="${getIconUrls(crypto.symbol).remote}" alt="${crypto.name}" class="lazy w-8 h-8 rounded-full">
                        <div>
                            <div class="font-bold">${crypto.name}</div>
                            <div class="text-sm text-gray-400">${crypto.symbol.toUpperCase()}</div>
                        </div>
                    </div>
                </div>
                <div class="crypto-col-price">
                    <div class="font-bold js-crypto-price">${formatCurrency(crypto.current_price)}</div>
                </div>
                <div class="crypto-col-change">
                    <span class="js-crypto-change ${changeClass}">
                        ${crypto.price_change_percentage_24h >= 0 ? '+' : ''}${crypto.price_change_percentage_24h.toFixed(2)}%
                    </span>
                </div>
                <div class="crypto-col-volume js-crypto-vol">
                    $${formatLargeNumber(crypto.total_volume)}
                </div>
                <div class="crypto-col-target"${locked ? '' : ` id="target-${crypto.id}"`}>--</div>
                <div class="crypto-col-stop"${locked ? '' : ` id="stop-${crypto.id}"`}>--</div>
                <div class="crypto-col-recommendation"${locked ? '' : ` id="rec-${crypto.id}"`}>${locked ? '<span class="text-gray-400">Login para ver</span>' : '<span class="loading-small"></span>'}</div>
                <div class="crypto-col-sentiment"${locked ? '' : ` id="sentiment-${crypto.id}"`}>${locked ? '<span class="text-gray-400">Login para ver</span>' : '<span class="loading-small"></span>'}</div>
                <div class="crypto-col-actions">
                    <button class="btn-details">
                        Ver Detalhes
                    </button>
                </div>
            `;

            row.innerHTML = locked
                ? `
                    <div class="locked-blur">${rowContent}</div>
                    <div class="locked-overlay">
                        <div>
                            <div class="locked-title">Bloqueado</div>
                            <div class="locked-subtitle">Faça cadastro para liberar.</div>
                        </div>
                    </div>
                `
                : rowContent;
            fragment.appendChild(row);
        }

        container.appendChild(fragment);
        index += chunkSize;

        if (index < data.length) {
            // Schedule the next chunk
            requestAnimationFrame(renderChunk);
        } else {
            // All chunks rendered, now trigger secondary loads
            data.forEach(crypto => {
                if (CONFIG.cryptos.some(c => c.id === crypto.id) && !isCryptoLocked(crypto.id)) {
                    loadRecommendationForListOptimized(crypto);
                    loadSentimentForList(crypto);
                }
            });
            lazyLoadImages();
        }
    }

    // Start the rendering process
    requestAnimationFrame(renderChunk);
}

/**
 * Loads and displays the trading recommendation for a cryptocurrency list row (optimized version).
 * @param {any} crypto The cryptocurrency data object.
 */
export async function loadRecommendationForListOptimized(crypto) {
    console.log('loadRecommendationForListOptimized para', crypto.id);
    const config = CONFIG.cryptos.find(c => c.id === crypto.id);
    if (!config) return;
    
    const recElement = document.getElementById(`rec-${crypto.id}`);
    const targetElement = document.getElementById(`target-${crypto.id}`);
    const stopElement = document.getElementById(`stop-${crypto.id}`);
    
    if (!recElement || !targetElement || !stopElement) {
        console.log('Elementos não encontrados para', crypto.id);
        return;
    }
    
    // Use cached recommendation if available
    const cacheKey = `recommendation_${config.symbol}_${state.settings.model}`;
    let recommendation = state.cache[cacheKey]?.data;
    
    console.log('Cache key:', cacheKey, 'Recomendação em cache:', recommendation ? 'Sim' : 'Não');
    console.log('Cache completo:', state.cache);
    
    // Fetch only if not cached or cache expired
    if (!recommendation) {
        console.log('Buscando recomendação para', config.symbol);
        try {
            recommendation = await fetchRecommendation(config.symbol);
            console.log('Recomendação recebida:', recommendation);
            
            // Cache the recommendation
            state.cache[cacheKey] = {
                data: recommendation,
                timestamp: Date.now()
            };
            console.log('Recomendação armazenada em cache');
        } catch (error) {
            console.error('Erro ao buscar recomendação:', error);
            recommendation = null;
        }
    }
    
    if (recommendation && recommendation.recommendation) {
        const rec = recommendation.recommendation.toLowerCase();
        const confidence = recommendation.percentage.toFixed(2) || 'N/A';
        
        recElement.innerHTML = `
            <span class="px-2 py-1 rounded text-xs font-bold ${
                rec === 'buy' ? 'bg-green-600' : 
                rec === 'sell' ? 'bg-red-600' : 
                'bg-gray-600'
            }">${rec.toUpperCase()}</span>
            <div class="text-xs text-gray-400">${confidence * 100}%</div>
        `;
        
        // Load target/stop only for buy/sell recommendations
        if (rec === 'buy' || rec === 'sell') {
            const targetStop = await fetchTargetStop(config.symbol, rec);
            if (targetStop) {
                targetElement.textContent = `$${targetStop.target}`;
                stopElement.textContent = `$${targetStop.stop_loss}`;
            } else {
                targetElement.textContent = '--';
                stopElement.textContent = '--';
            }
        } else {
            targetElement.textContent = '--';
            stopElement.textContent = '--';
        }
    } else {
        recElement.innerHTML = '<span class="text-gray-400">--</span>';
        targetElement.textContent = '--';
        stopElement.textContent = '--';
    }
}

/**
 * Loads and displays the trading recommendation for a cryptocurrency card.
 * @param {any} crypto The cryptocurrency data object.
 */
export async function loadRecommendationForCard(crypto) {
    const config = CONFIG.cryptos.find(c => c.id === crypto.id);
    if (!config) return;
    
    const container = document.getElementById(`recommendation-${crypto.id}`);
    if (!container) return;
    
    // Use cached recommendation if available
    const cacheKey = `recommendation_${config.symbol}_${state.settings.model}`;
    let recommendation = state.cache[cacheKey]?.data;
    
    // Fetch only if not cached or cache expired
    if (!recommendation) {
        recommendation = await fetchRecommendation(config.symbol);
    }
    
    if (recommendation && recommendation.recommendation) {
        const rec = recommendation.recommendation.toLowerCase();
        const isAction = rec === 'buy' || rec === 'sell';
        
        const confidence = recommendation.percentage.toFixed(2)|| 'N/A' ; // Default to 70-100% if not available

        let content = `
            <div class="flex items-center justify-between">
                <span class="text-sm font-medium">Recomendação:</span>
                <span class="px-2 py-1 rounded text-xs font-bold ${
                    rec === 'buy' ? 'bg-green-600' : 
                    rec === 'sell' ? 'bg-red-600' : 
                    'bg-gray-600'
                }">${rec.toUpperCase()}</span>
            </div>
            <div class="confidence-container mt-1 w-full">
                <div class="confidence-progress-bar" style="width: ${confidence * 100}%; background-color: ${
                    rec === 'buy' ? '#10b981' : 
                    rec === 'sell' ? '#ef4444' : 
                    '#6b7280'
                };"></div>
            </div>
            <div class="text-xs text-right">Confiança: ${confidence * 100}%</div>
        `;
        
        if (isAction) {
            const targetStop = await fetchTargetStop(config.symbol, rec);
            if (targetStop) {
                content += `
                    <div class="target-stop-card ${rec === 'sell' ? 'sell' : ''} mt-2">
                        <div class="flex justify-between text-sm">
                            <div>
                                <div class="font-medium">Target:</div>
                                <div class="text-lg font-bold">$${targetStop.target}</div>
                            </div>
                            <div class="text-right">
                                <div class="font-medium">Stop Loss:</div>
                                <div class="text-lg font-bold">$${targetStop.stop_loss}</div>
                            </div>
                        </div>
                        <div class="text-xs opacity-75 mt-2">
                            Perfil: ${state.settings.profile} | Modelo: ${state.settings.model}
                        </div>
                    </div>
                `;
            }
        }
        
        container.innerHTML = content;
    } else {
        container.innerHTML = `
            <div class="flex items-center justify-between">
                <span class="text-sm font-medium">Recomendação:</span>
                <span class="px-2 py-1 rounded text-xs bg-gray-600">N/A</span>
            </div>
        `;
    }
}

export async function loadSentimentForCard(crypto) {
    const config = CONFIG.cryptos.find(c => c.id === crypto.id);
    if (!config) return;

    const container = document.getElementById(`sentiment-${crypto.id}`);
    if (!container) return;

    const sentimentData = await fetchSentimentAnalysis(config.symbol);
    if (sentimentData?.sentiment) {
        container.innerHTML = `
            <div class="flex items-center justify-between">
                <span class="text-sm font-medium">Sentimento IA:</span>
                ${createSentimentBadgeHtml(sentimentData)}
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="flex items-center justify-between">
                <span class="text-sm font-medium">Sentimento IA:</span>
                <span class="text-xs text-gray-400">Indisponível</span>
            </div>
        `;
    }
}

export async function loadSentimentForList(crypto) {
    const config = CONFIG.cryptos.find(c => c.id === crypto.id);
    if (!config) return;

    const container = document.getElementById(`sentiment-${crypto.id}`);
    if (!container) return;

    const sentimentData = await fetchSentimentAnalysis(config.symbol);
    if (sentimentData?.sentiment) {
        container.innerHTML = createSentimentBadgeHtml(sentimentData, true);
    } else {
        container.innerHTML = '<span class="text-gray-400">--</span>';
    }
}

/**
 * Shows a specific page and hides all others.
 * @param {string} page The ID of the page to show.
 */
export function showPage(page) {
    // Hide all pages
    document.querySelectorAll('.page-view').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    // Show selected page
    const pageElement = document.getElementById(`${page}-page`);
    if (pageElement) {
        pageElement.classList.add('active');
    } else {
        console.error(`Elemento com ID ${page}-page não encontrado`);
    }
    
    // Try to find navigation element with different possible IDs - CORREÇÃO APLICADA
    const possibleNavIds = [`nav-${page}`, `${page}-nav`, `nav_${page}`, `${page}_nav`];
    let navElement = null;
    
    for (const navId of possibleNavIds) {
        navElement = document.getElementById(navId);
        if (navElement) break;
    }
    
    if (navElement) {
        navElement.classList.add('active');
    } else {
        console.warn(`Elemento de navegação para ${page} não encontrado. IDs tentados: ${possibleNavIds.join(', ')}`);
        // Não gerar erro se não encontrar navegação
    }
    
    state.currentPage = page;
}

/**
 * Shows the detailed view for a specific cryptocurrency.
 * @param {string} cryptoId The ID of the cryptocurrency to show.
 */
export async function showCryptoDetail(cryptoId) {
    state.currentCrypto = cryptoId;

    const config = CONFIG.cryptos.find(c => c.id === cryptoId);
    if (!config) {
        console.error('Configuração não encontrada para crypto:', cryptoId);
        return;
    }

    // Update selector
    const selector = document.getElementById('crypto-selector');
    if (selector) selector.value = cryptoId;

    try {
        const binanceBases = [
            CONFIG.apis.binance,
            'https://data-api.binance.vision/api/v3'
        ];
        const urls = binanceBases.map(base => `${base}/ticker/24hr?symbol=${config.binanceSymbol}`);
        const data = await fetchData(urls, config.id, CONFIG.updateIntervals.prices);

        if (data) {
            const current_price = parseFloat(data.lastPrice);
            const volume = parseFloat(data.quoteVolume);
            const change = parseFloat(data.priceChangePercent);

            document.getElementById('crypto-title').textContent = config.name;
            document.getElementById('crypto-name').textContent = config.name;
            document.getElementById('crypto-symbol').textContent = config.symbol.toUpperCase();
            
            // Definir ícone local com fallback remoto
            setImageWithFallback(document.getElementById('crypto-image'), config.symbol);
            document.getElementById('crypto-price').textContent = formatCurrency(current_price);

            const changeElement = document.getElementById('crypto-change');
            changeElement.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
            changeElement.className = `font-bold ${change >= 0 ? 'price-positive' : 'price-negative'}`;

            document.getElementById('crypto-volume').textContent = '$' + formatLargeNumber(volume);
            document.getElementById('crypto-market-cap').textContent = '$' + formatLargeNumber(0); // ou estimativa

            loadCryptoRecommendation(state.currentCrypto);
            loadCryptoSentiment(state.currentCrypto);
        } else {
            const cg = await fetchData(
                `${CONFIG.apis.coingecko}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(config.id)}`,
                `cg_detail_${config.id}`,
                CONFIG.updateIntervals.prices
            );
            const row = Array.isArray(cg) ? cg[0] : null;
            if (row) {
                const current_price = Number(row.current_price) || 0;
                const volume = Number(row.total_volume) || 0;
                const change = Number(row.price_change_percentage_24h) || 0;
                const marketCap = Number(row.market_cap) || 0;

                document.getElementById('crypto-title').textContent = config.name;
                document.getElementById('crypto-name').textContent = config.name;
                document.getElementById('crypto-symbol').textContent = config.symbol.toUpperCase();
                setImageWithFallback(document.getElementById('crypto-image'), config.symbol);
                document.getElementById('crypto-price').textContent = formatCurrency(current_price);

                const changeElement = document.getElementById('crypto-change');
                changeElement.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
                changeElement.className = `font-bold ${change >= 0 ? 'price-positive' : 'price-negative'}`;

                document.getElementById('crypto-volume').textContent = '$' + formatLargeNumber(volume);
                document.getElementById('crypto-market-cap').textContent = '$' + formatLargeNumber(marketCap);

                loadCryptoRecommendation(state.currentCrypto);
                loadCryptoSentiment(state.currentCrypto);
            }
        }

    } catch (error) {
        console.error('Error loading crypto detail from Binance:', error);
    }

    showPage('crypto');
    loadLightweightChart(cryptoId);
}

/**
 * Loads and displays the trading recommendation for the detailed cryptocurrency view.
 * @param {string} cryptoId The ID of the cryptocurrency.
 */
export async function loadCryptoRecommendation(cryptoId) {
    const config = CONFIG.cryptos.find(c => c.id === cryptoId);
    if (!config) return;
    
    const container = document.getElementById('recommendation-content');
    container.innerHTML = '<span class="loading"></span>';
    
    const recommendation = await fetchRecommendation(config.symbol);
    
    if (recommendation && recommendation.recommendation) {
        const rec = recommendation.recommendation.toLowerCase();
        const isAction = rec === 'buy' || rec === 'sell';
        
        const confidence = recommendation.percentage.toFixed(2)|| 'N/A' ; // Default to 70-100% if not available

        let content = `
            <div class="flex items-center justify-between">
                <span class="text-sm font-medium">Recomendação:</span>
                <span class="px-2 py-1 rounded text-xs font-bold ${
                    rec === 'buy' ? 'bg-green-600' : 
                    rec === 'sell' ? 'bg-red-600' : 
                    'bg-gray-600'
                }">${rec.toUpperCase()}</span>
            </div>
            <div class="confidence-container mt-1 w-full"">
                <div class="confidence-progress-bar" style="width: ${confidence * 100}%; background-color: ${
                    rec === 'buy' ? '#10b981' : 
                    rec === 'sell' ? '#ef4444' : 
                    '#6b7280'
                };"></div>
            </div>
            <div class="text-xs text-right">Confiança: ${confidence * 100}%</div>
        `;
        
        if (isAction) {
            const targetStop = await fetchTargetStop(config.symbol, rec);
            if (targetStop) {
                content += `
                    <div class="target-stop-card ${rec === 'sell' ? 'sell' : ''}">
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <div class="text-sm opacity-75">Target Price</div>
                                <div class="text-2xl font-bold">$${targetStop.target}</div>
                            </div>
                            <div>
                                <div class="text-sm opacity-75">Stop Loss</div>
                                <div class="text-2xl font-bold">$${targetStop.stop_loss}</div>
                            </div>
                        </div>
                        <div class="text-xs opacity-75 mt-3">
                            Baseado no perfil: ${state.settings.profile} | Modelo: ${state.settings.model}
                        </div>
                    </div>
                `;
            }
        }
        
        container.innerHTML = content;
    } else {
        container.innerHTML = `
            <div class="text-center py-4">
                <span class="px-3 py-2 rounded text-sm bg-gray-600">Recomendação não disponível</span>
            </div>
        `;
    }
}

export async function loadCryptoSentiment(cryptoId) {
    const config = CONFIG.cryptos.find(c => c.id === cryptoId);
    if (!config) return;

    const container = document.getElementById('sentiment-content');
    if (!container) return;

    container.innerHTML = '<span class="loading"></span>';

    const [sentimentData, newsData] = await Promise.all([
        fetchSentimentAnalysis(config.symbol),
        fetchCryptoNews(config.symbol)
    ]);

    if (sentimentData?.sentiment) {
        const meta = getSentimentMeta(sentimentData.sentiment);
        const sourcesUsed = Array.isArray(newsData?.sourcesUsed) && newsData.sourcesUsed.length > 0
            ? newsData.sourcesUsed
            : (Array.isArray(sentimentData?.sourcesUsed) ? sentimentData.sourcesUsed : []);
        const newsItems = Array.isArray(newsData?.newsItems) ? newsData.newsItems : [];
        const confidenceLine = Number.isFinite(Number(sentimentData.confidence))
            ? `<div class="text-xs text-gray-400 mt-2">Confiança: ${Math.round(Number(sentimentData.confidence))}%</div>`
            : '';
        const methodLine = sentimentData.sentimentMethod
            ? `<div class="text-xs text-gray-500 mt-1">Método: ${escapeHtml(String(sentimentData.sentimentMethod))}</div>`
            : '';
        const rationaleLine = sentimentData.rationale
            ? `<div class="text-xs text-gray-400 mt-2 leading-relaxed">${escapeHtml(String(sentimentData.rationale))}</div>`
            : '';
        const drivers = Array.isArray(sentimentData.keyDrivers) ? sentimentData.keyDrivers.filter(Boolean) : [];
        const driversLine = drivers.length
            ? `<ul class="sentiment-news-list text-xs text-gray-400 mt-2">${drivers.slice(0, 4).map(d => `<li>${escapeHtml(String(d))}</li>`).join('')}</ul>`
            : '';
        container.innerHTML = `
            <div class="flex items-center justify-between gap-3">
                <span class="text-sm font-medium">Status atual</span>
                ${createSentimentBadgeHtml(sentimentData)}
            </div>
            <div class="text-sm ${meta.textClass} mt-3">
                Leitura da IA para ${config.symbol}: ${meta.label}
            </div>
            ${confidenceLine}
            ${methodLine}
            ${rationaleLine}
            ${driversLine}
            ${sourcesUsed.length ? `<div class="text-xs text-gray-500 mt-2">Fontes: ${sourcesUsed.map(escapeHtml).join(', ')}</div>` : ''}
            ${createSentimentNewsHtml(newsItems, sentimentData.topNews)}
        `;
    } else {
        container.innerHTML = `
            <div class="text-center py-4">
                <span class="px-3 py-2 rounded text-sm bg-gray-600">Análise de sentimento não disponível</span>
            </div>
        `;
    }
}

/**
 * Shows a tooltip with details about a specific recommendation on the chart.
 * @param {object} recommendation The recommendation object from the history.
 * @param {number} x The x-coordinate for the tooltip.
 * @param {number} y The y-coordinate for the tooltip.
 */
export async function showRecommendationTooltip(recommendation, x, y) {
    // Remove any existing tooltip
    const existingTooltip = document.getElementById('recommendation-tooltip');
    if (existingTooltip) {
        existingTooltip.remove();
    }

    // Create tooltip element
    const tooltip = document.createElement('div');
    tooltip.id = 'recommendation-tooltip';
    tooltip.style.cssText = `
        position: fixed;
        left: ${x + 15}px;
        top: ${y + 15}px;
        background: rgba(45, 55, 72, 0.95);
        border: 1px solid #4a5568;
        border-radius: 8px;
        padding: 12px;
        color: white;
        font-size: 12px;
        min-width: 250px;
        z-index: 1001;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        backdrop-filter: blur(10px);
        pointer-events: all;
    `;

    tooltip.innerHTML = '<div style="text-align: center;">Carregando detalhes...</div>';
    document.body.appendChild(tooltip);

    const cryptoSymbol = CONFIG.cryptos.find(c => c.id === state.currentCrypto)?.symbol;
    if (!cryptoSymbol) {
        tooltip.innerHTML = 'Erro: Cripto não encontrada.';
        return;
    }

    // Fetch the specific historical recommendation details
    const specificData = await fetchSpecificRecommendation(cryptoSymbol, recommendation.Date, recommendation.Time);

    const recType = recommendation.recommendation.toLowerCase();
    const isAction = recType.includes('buy') || recType.includes('sell') || recType.includes('compra') || recType.includes('venda');
    const recDate = new Date(`${recommendation.Date}T${recommendation.Time}Z`).toLocaleString('pt-BR');

    let content = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div style="font-weight: bold; color: #63b3ed;">Detalhes do Sinal Histórico</div>
            <button id="close-tooltip-btn" style="background: #e53e3e; border: none; color: white; width: 20px; height: 20px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center;">×</button>
        </div>
        <div><strong>Sinal:</strong> <span style="color: ${isAction && (recType.includes('buy') || recType.includes('compra')) ? '#10b981' : '#ef4444'};">${recommendation.recommendation}</span></div>
        <div><strong>Data:</strong> ${recDate}</div>
    `;

    if (specificData) {
        const confidence = (specificData.percentage * 100).toFixed(2);
        content += `
            <hr style="border-color: #4a5568; margin: 8px 0;">
            <div><strong>Confiança:</strong> ${confidence}%</div>
            <div><strong>Target:</strong> ${formatCurrency(specificData.target)}</div>
            <div><strong>Stop Loss:</strong> ${formatCurrency(specificData.stop_loss)}</div>
        `;
    } else {
        content += '<div style="margin-top: 8px; color: #f85149;">Não foi possível carregar os detalhes históricos.</div>';
    }

    tooltip.innerHTML = content;

    // Add close functionality
    document.getElementById('close-tooltip-btn').onclick = () => {
        tooltip.remove();
    };
    
    // Reposition if it goes off-screen
    const rect = tooltip.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        tooltip.style.left = `${window.innerWidth - rect.width - 15}px`;
    }
    if (rect.bottom > window.innerHeight) {
        tooltip.style.top = `${window.innerHeight - rect.height - 15}px`;
    }
}


/**
 * Updates the Market Exit card with new data.
 * @param {Object} marketExitData The market exit indicator data.
 */
export function updateMarketExitCard(marketExitData) {
    const marketExitCard = document.getElementById('market-exit-card');
    if (!marketExitCard || !marketExitData) return;
    
    // Update score
    const scoreElement = marketExitCard.querySelector('.market-exit-score');
    if (scoreElement) {
        scoreElement.textContent = marketExitData.score;
    }
    
    // Update risk level and styling
    const statusElement = marketExitCard.querySelector('.market-exit-status');
    if (statusElement) {
        statusElement.textContent = marketExitData.riskLevel;
        
        // Update colors based on risk level
        let colorClass = '';
        switch (marketExitData.riskLevel) {
            case 'Low Risk':
                colorClass = 'text-green-400';
                break;
            case 'Moderate Risk':
                colorClass = 'text-yellow-400';
                break;
            case 'High Risk':
                colorClass = 'text-red-400 high-risk-pulse';
                break;
            default:
                colorClass = 'text-gray-400';
        }
        
        statusElement.className = `market-exit-status text-lg font-bold ${colorClass}`;
    }
    
    // Hide loading
    const loadingElement = marketExitCard.querySelector('.market-exit-loading');
    if (loadingElement) {
        loadingElement.style.display = 'none';
    }
    
    // Update last updated time
    const timeElement = marketExitCard.querySelector('.market-exit-time');
    if (timeElement && marketExitData.timestamp) {
        const date = new Date(marketExitData.timestamp);
        timeElement.textContent = `Updated: ${date.toLocaleTimeString()}`;
    }
}

/**
 * Shows a notification message.
 * @param {string} message The message to display.
 * @param {string} type The type of notification ('info', 'success', or 'error').
 */
export function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `fixed top-4 right-4 p-4 rounded-lg text-white z-50 ${
        type === 'success' ? 'bg-green-600' : 
        type === 'error' ? 'bg-red-600' : 
        'bg-blue-600'
    }`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

/**
 * Toggles the color theme of the dashboard.
 */
export function toggleTheme() {
    const body = document.body;
    const icon = document.getElementById('theme-icon');
    
    if (body.classList.contains('light-theme')) {
        body.classList.remove('light-theme');
        icon.className = 'fas fa-moon';
    } else {
        body.classList.add('light-theme');
        icon.className = 'fas fa-sun';
    }
}

/**
 * Toggles the view mode between cards and list.
 */
export function toggleViewMode() {
    console.log('🔄 Toggle view mode chamado, modo atual:', state.viewMode);
    
    state.viewMode = state.viewMode === 'cards' ? 'list' : 'cards';
    console.log('📊 Novo modo:', state.viewMode);

    const container = document.getElementById('crypto-cards');
    const toggleBtn = document.getElementById('view-toggle-btn');

    if (state.viewMode === 'list') {
        if (toggleBtn) {
            toggleBtn.innerHTML = `<i class="fas fa-th-large mr-2"></i>Cards`;
        }
        if (container) {
            container.classList.remove('grid', 'grid-cols-1', 'md:grid-cols-2', 'xl:grid-cols-3', 'gap-6');
            container.classList.add('list-view-mode');
        }
    } else {
        if (toggleBtn) {
            toggleBtn.innerHTML = `<i class="fas fa-list mr-2"></i>Lista`;
        }
        if (container) {
            container.classList.remove('list-view-mode');
            container.classList.add('grid', 'grid-cols-1', 'md:grid-cols-2', 'xl:grid-cols-3', 'gap-6');
        }
    }
    
    // Re-render with existing data
    const cachedData = state.cache['crypto_data'];
    if (cachedData && cachedData.data) {
        renderCryptoCards(cachedData.data);
    } else {
        fetchCryptoData(); // Fallback
    }
}

/**
 * Pre-loads recommendations for all cryptocurrencies to improve performance.
 * This function should be called after the initial data load.
 */
export async function preloadRecommendations() {
    if (!CONFIG.cryptos || CONFIG.cryptos.length === 0) return;
    
    // Create promises for all recommendation fetches
    const recommendationPromises = CONFIG.cryptos.map(async (crypto) => {
        const cacheKey = `recommendation_${crypto.symbol}_${state.settings.model}`;
        const cached = state.cache[cacheKey];
        
        // Skip if already cached and not expired
        if (cached && Date.now() - cached.timestamp < CONFIG.updateIntervals.prices) {
            return;
        }
        
        try {
            const recommendation = await fetchRecommendation(crypto.symbol);
            if (recommendation) {
                state.cache[cacheKey] = {
                    data: recommendation,
                    timestamp: Date.now()
                };
            }
        } catch (error) {
            console.error(`Failed to preload recommendation for ${crypto.symbol}:`, error);
        }
    });
    
    // Execute all promises in parallel but don't wait for completion
    // This allows the UI to remain responsive
    Promise.all(recommendationPromises).catch(error => {
        console.error('Error preloading recommendations:', error);
    });
}

/**
 * Updates the Fear & Greed Index gauge.
 * @param {number} value The Fear & Greed Index value (0-100).
 */
export function updateGauge(value) {
    const gauge = document.getElementById('gauge-fill');
    const circumference = 220;
    const progress = (value / 100) * circumference;
    
    let color;
    if (value <= 20) color = '#da3633';
    else if (value <= 40) color = '#f85149';
    else if (value <= 60) color = '#bb8009';
    else if (value <= 80) color = '#e3b341';
    else color = '#238636';
    
    gauge.style.stroke = color;
    gauge.style.strokeDasharray = `${progress} ${circumference}`;
}

function lazyLoadImages() {
    const lazyImages = [].slice.call(document.querySelectorAll("img.lazy"));

    if ("IntersectionObserver" in window) {
        let lazyImageObserver = new IntersectionObserver(function(entries, observer) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    let lazyImage = entry.target;
                    // Attach one-time fallback handler if provided
                    if (lazyImage.dataset.fallback) {
                        lazyImage.onerror = function() {
                            lazyImage.onerror = null;
                            lazyImage.src = lazyImage.dataset.fallback;
                        };
                    }
                    lazyImage.src = lazyImage.dataset.src;
                    lazyImage.classList.remove("lazy");
                    lazyImageObserver.unobserve(lazyImage);
                }
            });
        });

        lazyImages.forEach(function(lazyImage) {
            lazyImageObserver.observe(lazyImage);
        });
    } else {
        // Fallback for browsers that don't support IntersectionObserver
        lazyImages.forEach(function(lazyImage) {
            if (lazyImage.dataset.fallback) {
                lazyImage.onerror = function() {
                    lazyImage.onerror = null;
                    lazyImage.src = lazyImage.dataset.fallback;
                };
            }
            lazyImage.src = lazyImage.dataset.src;
        });
    }
}
