import { state } from './state.js?v=20260828a';

/**
 * Toggle Moving Averages Panel visibility
 */
function toggleMAPanel() {
    const panel = document.getElementById('ma-panel');
    const toggleBtn = document.getElementById('ma-toggle-btn');
    const arrow = toggleBtn.querySelector('.dropdown-arrow');
    
    if (panel.style.display === 'none' || panel.style.display === '') {
        panel.style.display = 'block';
        arrow.style.transform = 'rotate(180deg)';
    } else {
        panel.style.display = 'none';
        arrow.style.transform = 'rotate(0deg)';
    }
}

/**
 * Aplica as configuraÃ§Ãµes de mÃ©dias mÃ³veis selecionadas
 */
function applyMASettings() {
    console.log('ðŸ”§ Applying MA settings...');
    
    // Check if indicatorsManager is available
    if (!state.indicatorsManager) {
        console.error('âŒ IndicatorsManager not initialized');
        alert('Erro: Sistema de indicadores nÃ£o inicializado. Tente recarregar a pÃ¡gina.');
        return;
    }
    
    // Check if candlestick data is available
    if (!state.candlestickData || state.candlestickData.length === 0) {
        console.error('âŒ No candlestick data available');
        alert('Erro: Dados do grÃ¡fico nÃ£o disponÃ­veis. Selecione uma criptomoeda primeiro.');
        return;
    }
    
    // Get selected MA type
    const maTypeRadio = document.querySelector('input[name="ma-type"]:checked');
    if (!maTypeRadio) {
        console.warn('âš ï¸ No MA type selected');
        alert('Por favor, selecione o tipo de mÃ©dia mÃ³vel (SMA ou EMA)');
        return;
    }
    const maType = maTypeRadio.value;
    
    // Prevenir duplicatas: remover quaisquer MAs existentes do tipo selecionado
    try { state.indicatorsManager.removeMovingAverages(maType); } catch (_) {}
    try {
        Object.keys(state.indicatorsManager.indicators).forEach(key => {
            if (key.startsWith(maType) && /^\d+$/.test(key.slice(maType.length))) {
                try { state.indicatorsManager.removeIndicator(key); } catch (_) {}
            }
        });
    } catch (_) {}
    
    // Get selected periods
    const selectedPeriods = [];
    const checkboxes = document.querySelectorAll('.period-checkbox input[type="checkbox"]:checked');
    checkboxes.forEach(checkbox => {
        selectedPeriods.push(parseInt(checkbox.value));
    });
    
    if (selectedPeriods.length === 0) {
        console.warn('âš ï¸ No periods selected');
        alert('Por favor, selecione pelo menos um perÃ­odo para a mÃ©dia mÃ³vel');
        return;
    }
    
    console.log(`ðŸ“Š Applying ${maType.toUpperCase()} for periods:`, selectedPeriods);
    
    // Apply moving averages
    selectedPeriods.forEach(period => {
        const id = `${maType}${period}`;
        try {
            state.indicatorsManager.addMovingAverage(id, state.candlestickData, period, maType);
            console.log(`âœ… Applied ${maType.toUpperCase()}(${period})`);
        } catch (error) {
            console.error(`âŒ Error applying ${maType.toUpperCase()}(${period}):`, error);
        }
    });
    
    // Update button state
    updateMAToggleButtonState();
    
    console.log('âœ… MA settings applied successfully');
}

/**
 * Manipula mudanças nos checkboxes de período sem aplicar imediatamente.
 * Apenas atualiza o estado visual; a aplicação ocorre ao clicar em "Aplicar".
 */
function handlePeriodCheckboxChange(event) {
    // Não adiciona nem remove indicadores aqui
    updateMAToggleButtonState();
}

/**
 * Atualiza o estado do botÃ£o principal de MA baseado nos checkboxes ativos
 */
function updateMAToggleButtonState() {
    const toggleBtn = document.getElementById('ma-toggle-btn');
    const checkedBoxes = document.querySelectorAll('.period-checkbox input[type="checkbox"]:checked');
    
    if (checkedBoxes.length > 0) {
        toggleBtn.classList.add('active');
    } else {
        toggleBtn.classList.remove('active');
    }
}

/**
 * Limpa todas as médias móveis do gráfico e reseta o painel.
 * Remove MAs adicionadas pelos dois modos: aninhadas (toggle) e por ID (ex.: 'sma20').
 */
function clearAllMA() {
    console.log('🧹 Clearing all Moving Averages');

    if (!state.indicatorsManager) {
        console.error('❌ IndicatorsManager not initialized');
        return;
    }

    const manager = state.indicatorsManager;

    // 1) Remover MAs aninhadas (armazenadas em indicators.sma/indicators.ema)
    try { manager.removeMovingAverages('sma'); } catch (_) {}
    try { manager.removeMovingAverages('ema'); } catch (_) {}

    // 2) Remover MAs adicionadas por ID (ex.: 'sma20', 'ema50')
    try {
        Object.keys(manager.indicators).forEach(key => {
            if (/^(sma|ema)\d+$/.test(key)) {
                try { manager.removeIndicator(key); } catch (_) {}
            }
        });
    } catch (_) {}

    // 3) Resetar estado visual do botão e checkboxes
    const toggleBtn = document.getElementById('ma-toggle-btn');
    if (toggleBtn) toggleBtn.classList.remove('active');

    const checkboxes = document.querySelectorAll('.period-checkbox input[type="checkbox"]');
    checkboxes.forEach(checkbox => { checkbox.checked = false; });

    console.log('✅ All Moving Averages cleared');
}

/**
 * Legacy function for backward compatibility
 */
function toggleMovingAverages() {
    console.log('âš ï¸ Using legacy toggleMovingAverages - consider using new MA panel');
    
    const button = document.getElementById('ma-btn');
    if (!button) {
        console.warn('âš ï¸ Legacy MA button not found');
        return;
    }
    
    const isActive = button.classList.contains('active');
    
    if (!state.indicatorsManager) {
        console.error('âŒ IndicatorsManager not initialized');
        return;
    }
    
    if (isActive) {
        // Remove moving averages
        state.indicatorsManager.removeIndicator('sma20');
        state.indicatorsManager.removeIndicator('sma50');
        button.classList.remove('active');
        console.log('ðŸ”´ Moving Averages disabled');
    } else {
        // Add moving averages
        if (state.candlestickData && state.candlestickData.length > 0) {
            state.indicatorsManager.addMovingAverage('sma20', state.candlestickData, 20, 'sma');
            state.indicatorsManager.addMovingAverage('sma50', state.candlestickData, 50, 'sma');
            button.classList.add('active');
            console.log('ðŸŸ¢ Moving Averages enabled');
        } else {
            console.warn('âš ï¸ No candlestick data available for Moving Averages');
        }
    }
}

/**
 * Toggle do Fibonacci
 */
function toggleFibonacci() {
    console.log('ðŸ”„ Toggling Fibonacci');
    
    const button = document.getElementById('fib-btn');
    const isActive = button.classList.contains('active');
    
    if (!state.indicatorsManager) {
        console.error('âŒ IndicatorsManager not initialized');
        return;
    }
    
    if (isActive) {
        // Remover Fibonacci
        state.indicatorsManager.removeIndicator('fibonacci');
        button.classList.remove('active');
        console.log('ðŸ”´ Fibonacci disabled');
    } else {
        // Adicionar Fibonacci
        if (state.candlestickData && state.candlestickData.length > 0) {
            state.indicatorsManager.addFibonacci('fibonacci', state.candlestickData);
            button.classList.add('active');
            console.log('ðŸŸ¢ Fibonacci enabled');
        } else {
            console.warn('âš ï¸ No candlestick data available for Fibonacci');
        }
    }
}

/**
 * Toggle do RSI
 */
function toggleRSI() {
    console.log('ðŸ”„ Toggling RSI');
    
    const button = document.getElementById('rsi-btn');
    const isActive = button.classList.contains('active');
    
    if (!state.indicatorsManager) {
        console.error('âŒ IndicatorsManager not initialized');
        return;
    }
    
    if (isActive) {
        // Remover RSI
        state.indicatorsManager.removeIndicator('rsi');
        button.classList.remove('active');
        console.log('ðŸ”´ RSI disabled');
    } else {
        // Adicionar RSI
        if (state.candlestickData && state.candlestickData.length > 0) {
            state.indicatorsManager.addRSI('rsi', state.candlestickData);
            button.classList.add('active');
            console.log('ðŸŸ¢ RSI enabled');
        } else {
            console.warn('âš ï¸ No candlestick data available for RSI');
        }
    }
}

/**
 * Toggle do MACD
 */
function toggleMACD() {
    console.log('ðŸ”„ Toggling MACD');
    
    const button = document.getElementById('macd-btn');
    const isActive = button.classList.contains('active');
    
    if (!state.indicatorsManager) {
        console.error('âŒ IndicatorsManager not initialized');
        return;
    }
    
    if (isActive) {
        // Remover MACD
        state.indicatorsManager.removeIndicator('macd');
        button.classList.remove('active');
        console.log('ðŸ”´ MACD disabled');
    } else {
        // Adicionar MACD
        if (state.candlestickData && state.candlestickData.length > 0) {
            state.indicatorsManager.addMACD('macd', state.candlestickData);
            button.classList.add('active');
            console.log('ðŸŸ¢ MACD enabled');
        } else {
            console.warn('âš ï¸ No candlestick data available for MACD');
        }
    }
}

/**
 * Atualiza todos os indicadores ativos quando os dados do grÃ¡fico mudam
 */
function updateIndicators() {
    console.log('ðŸ”„ Updating active indicators');
    
    if (!state.indicatorsManager || !state.candlestickData) {
        console.warn('âš ï¸ IndicatorsManager or candlestick data not available');
        return;
    }
    
    // Verificar quais indicadores estÃ£o ativos e atualizÃ¡-los
    const maBtn = document.getElementById('ma-btn');
    const fibBtn = document.getElementById('fib-btn');
    const rsiBtn = document.getElementById('rsi-btn');
    const macdBtn = document.getElementById('macd-btn');
    
    if (maBtn && maBtn.classList.contains('active')) {
        state.indicatorsManager.updateMovingAverage('sma20', state.candlestickData, 20, 'sma');
        state.indicatorsManager.updateMovingAverage('sma50', state.candlestickData, 50, 'sma');
    }
    
    if (fibBtn && fibBtn.classList.contains('active')) {
        state.indicatorsManager.updateFibonacci('fibonacci', state.candlestickData);
    }
    
    if (rsiBtn && rsiBtn.classList.contains('active')) {
        state.indicatorsManager.updateRSI('rsi', state.candlestickData);
    }
    
    if (macdBtn && macdBtn.classList.contains('active')) {
        state.indicatorsManager.updateMACD('macd', state.candlestickData);
    }
    
    console.log('âœ… Indicators updated');
}

// Export functions for global access
// Make functions globally available
window.toggleMAPanel = toggleMAPanel;
window.applyMASettings = applyMASettings;
window.clearAllMA = clearAllMA;
window.toggleFibonacci = toggleFibonacci;
window.toggleRSI = toggleRSI;
window.toggleMACD = toggleMACD;

export { toggleMAPanel, applyMASettings, clearAllMA, handlePeriodCheckboxChange, updateMAToggleButtonState, toggleMovingAverages, toggleFibonacci, toggleRSI, toggleMACD, updateIndicators };
