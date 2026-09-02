# CryptoDash Pro 📈

Dashboard profissional de criptomoedas com análise técnica avançada, gráficos interativos e recomendações de IA.

## Description

This project is a single-page application that provides a comprehensive overview of the cryptocurrency market. It fetches data from various APIs, including Binance, CoinGecko, and a custom recommendation engine, to display real-time information. The dashboard features a responsive and interactive interface with detailed charting capabilities.

## Features

*   **Real-time Data:** Fetches and displays up-to-the-minute cryptocurrency prices and market data.
*   **Multiple Cryptocurrencies:** Supports a configurable list of cryptocurrencies.
*   **Global Market Overview:** Shows global market capitalization, trading volume, and Bitcoin dominance.
*   **Fear & Greed Index:** Displays the current Fear & Greed Index to gauge market sentiment.
*   **Trading Recommendations:** Integrates with a custom API to provide buy/sell/hold recommendations.
*   **Interactive Charts:** Uses Lightweight Charts to display candlestick and volume data, with support for different timeframes.
*   **Ruler Tool:** A tool to measure price changes and time duration directly on the chart. After measuring, it displays a draggable info box with detailed results, which can be closed to deactivate the tool.
*   **Customizable Settings:** Allows users to configure the model, timeframe, and other parameters.
*   **Responsive Design:** The interface is designed to work on different screen sizes.

## Getting Started

To run this project locally, you need a web server to serve the `index.html`, `script.js`, and `styles.css` files. You can use any simple web server, such as Python's `http.server` or the Live Server extension in Visual Studio Code.

1.  Clone this repository or download the files.
2.  Open the `index.html` file in your web browser through a web server.

## Usage

The dashboard is divided into two main views: the main dashboard and the detailed crypto view.

*   **Dashboard View:** This is the main view, which displays a list of cryptocurrencies in either a card or list format. It also shows the global market data and the Fear & Greed Index.
*   **Crypto Detail View:** Clicking on a cryptocurrency in the dashboard will take you to the detail view. This view shows a detailed chart for the selected cryptocurrency, along with its current price, volume, and trading recommendations.

## Functions

### Data Fetching

*   `fetchData(url, cacheKey, cacheDuration)`: A generic function to fetch data from a URL with caching support.
*   `fetchGlobalData()`: Fetches global market data from the CoinGecko API.
*   `fetchFearGreedIndex()`: Fetches the Fear & Greed Index.
*   `fetchCryptoData()`: Fetches data for all configured cryptocurrencies.
*   `fetchRecommendation(crypto)`: Fetches the latest trading recommendation for a cryptocurrency.
*   `fetchRecommendationHistory(crypto)`: Fetches the historical trading recommendations for a cryptocurrency.
*   `fetchCandlestickData(crypto, interval, limit)`: Fetches candlestick data for a cryptocurrency.
*   `fetchTargetStop(crypto, recommendation)`: Fetches target and stop-loss prices for a recommendation.

### Rendering

*   `renderCryptoCards(cryptoData)`: Renders the main dashboard view with cryptocurrency cards.
*   `renderCryptoList(cryptoData)`: Renders the main dashboard view with a list of cryptocurrencies.
*   `loadRecommendationForCard(crypto)`: Loads and displays the recommendation for a crypto card.
*   `loadRecommendationForList(crypto)`: Loads and displays the recommendation for a crypto in the list view.
*   `showPage(page)`: Switches between the main dashboard and the crypto detail view.
*   `showCryptoDetail(cryptoId)`: Displays the detailed view for a specific cryptocurrency.
*   `loadCryptoRecommendation(cryptoId)`: Loads and displays the recommendation for the detailed view.

### Charting

*   `initializeLightweightChart()`: Initializes the Lightweight Chart.
*   `loadLightweightChart(cryptoId)`: Loads the chart with data for a specific cryptocurrency.
*   `updateLightweightChart()`: Updates the chart with new data.
*   `createRecommendationMarkers(recommendationHistory, candlestickData)`: Creates markers on the chart for trading recommendations.
*   `toggleRuler()`: Toggles the ruler tool on the chart.
*   `handleChartClick(param)`: Handles clicks on the chart for the ruler functionality.

### Settings

*   `openSettings()`: Opens the settings modal.
*   `closeSettings()`: Closes the settings modal.
*   `loadSettingsValues()`: Loads the current settings into the modal.
*   `saveSettings()`: Saves the settings from the modal.
*   `resetSettings()`: Resets the settings to their default values.
*   `loadSettingsFromStorage()`: Loads settings from local storage on startup.

## Configuration Details

The application can be configured by modifying the `CONFIG` object and the `state.settings` object in the `script.js` file.

### Main Configuration (`CONFIG`)

```javascript
const CONFIG = {
    cryptos: [
        { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', binanceSymbol: 'BTCUSDT', color: '#f7931a' },
        // ... other cryptos
    ],
    apis: {
        binance: 'https://api.binance.com/api/v3',
        coingecko: 'https://api.coingecko.com/api/v3',
        fearGreed: 'https://api.alternative.me/fng/',
        recommendations: '/api/reco'
    },
    updateIntervals: {
        prices: 30000, // 30s
        fearGreed: 300000, // 5min
        global: 60000, //1 min
        chart : 60000,
    }
};
```

Para desenvolvimento local, você pode apontar o dashboard para sua API diretamente usando:

- querystring: `?recommendationsBase=http://127.0.0.1:8000`
- ou `localStorage.setItem('recommendationsBase', 'http://127.0.0.1:8000')`

*   `cryptos`: An array of objects, where each object represents a cryptocurrency to be displayed on the dashboard.
    *   `id`: A unique identifier for the cryptocurrency (e.g., 'bitcoin').
    *   `symbol`: The cryptocurrency symbol (e.g., 'BTC').
    *   `name`: The display name of the cryptocurrency (e.g., 'Bitcoin').
    *   `binanceSymbol`: The symbol used for the Binance API (e.g., 'BTCUSDT').
    *   `color`: The color used for the cryptocurrency in the UI.
*   `apis`: An object containing the base URLs for the APIs used in the application.
*   `updateIntervals`: An object that defines the update intervals (in milliseconds) for different data points.

### User Settings (`state.settings`)

These settings can be changed by the user through the settings modal.

```javascript
let state = {
    // ... other state properties
    settings: {
        model: 'CNN',
        timeframe: '4h',
        candles: 200,
        updateInterval: 30000,
        profile: 'moderate',
        soundNotifications: false
    },
    // ... other state properties
};
```

*   `model`: The machine learning model to use for trading recommendations (e.g., 'CNN').
*   `timeframe`: The chart timeframe (e.g., '1h', '4h', '1d').
*   `candles`: The number of candles to display on the chart.
*   `updateInterval`: The interval at which to update the cryptocurrency prices.
*   `profile`: The user's investment profile (e.g., 'conservative', 'moderate', 'aggressive').
*   `soundNotifications`: Whether to enable sound notifications for alerts.
