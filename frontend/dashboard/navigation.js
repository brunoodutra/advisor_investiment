import { CONFIG } from './config.js?v=20260828a';
import { state } from './state.js?v=20260828a';
import { fetchData } from './api.js?v=20260828a';
import { loadLightweightChart } from './chart.js?v=20260828a';
import { loadCryptoRecommendation, showPage } from './ui.js?v=20260905hard';
import { formatCurrency, formatLargeNumber, setImageWithFallback } from './utils.js?v=20260828a';

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
        const url = `${CONFIG.apis.binance}/ticker/24hr?symbol=${config.binanceSymbol}`;
        const data = await fetchData(url, config.id, CONFIG.updateIntervals.prices);

        if (data) {
            const current_price = parseFloat(data.lastPrice);
            const volume = parseFloat(data.quoteVolume);
            const change = parseFloat(data.priceChangePercent);

            document.getElementById('crypto-title').textContent = config.name;
            document.getElementById('crypto-name').textContent = config.name;
            document.getElementById('crypto-symbol').textContent = config.symbol.toUpperCase();
            
            // Ícone local com fallback remoto
            setImageWithFallback(document.getElementById('crypto-image'), config.symbol);
            document.getElementById('crypto-price').textContent = formatCurrency(current_price);

            const changeElement = document.getElementById('crypto-change');
            changeElement.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
            changeElement.className = `font-bold ${change >= 0 ? 'price-positive' : 'price-negative'}`;

            document.getElementById('crypto-volume').textContent = '$' + formatLargeNumber(volume);
            document.getElementById('crypto-market-cap').textContent = '$' + formatLargeNumber(0); // ou estimativa

            loadCryptoRecommendation(state.currentCrypto);
        }

    } catch (error) {
        console.error('Error loading crypto detail from Binance:', error);
        showNotification('Error loading crypto detail. Please try again.', 'error');
    }

    showPage('crypto');
    loadLightweightChart(cryptoId);
}