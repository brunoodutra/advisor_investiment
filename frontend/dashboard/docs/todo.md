# CryptoDash Pro - Market Exit Indicator

## Visão Geral

Dashboard avançado de criptomoedas com **Market Exit Indicator** - um sistema inovador que agrega 8 indicadores técnicos para identificar potenciais topos de mercado e momentos ideais de saída.

## ✨ Funcionalidades Implementadas

### 🎯 Market Exit Indicator
- **Score Composto 0-100** calculado pela média ponderada de 8 indicadores técnicos
- **Sistema de Cores:**
  - 🟢 Verde (0-33): Baixo risco de saída
  - 🟡 Amarelo (34-66): Risco moderado
  - 🔴 Vermelho (67-100): Alto risco de saída
- **Indicador de Tendência:** Mostra se o score está subindo/descendo
- **Análise de Sentimento IA:** Planejado (a implementar)

### 📊 8 Indicadores Técnicos

1. **Bitcoin Dominance** (15%)
   - Dominância do Bitcoin no mercado total
   - Fonte: CoinGecko API

2. **MVRV Z-Score** (20%)
   - Relação entre valor de mercado e valor realizado
   - Calculado a partir de dados públicos; pode ficar indisponível se APIs falharem

3. **Fear & Greed Index** (10%)
   - Índice de medo e ganância do mercado
   - Fonte: Alternative.me API

4. **Pi Cycle Top Indicator** (15%)
   - Cruzamento de médias móveis 111 e 350
   - Calculado a partir de dados públicos; pode ficar indisponível se APIs falharem

5. **Puell Multiple** (10%)
   - Múltiplo de receita de mineração
   - Calculado por aproximação a partir de dados públicos; pode ficar indisponível se APIs falharem

6. **NUPL - Net Unrealized P&L** (10%)
   - Lucro/prejuízo não realizado da rede
   - Calculado por aproximação a partir de dados públicos; pode ficar indisponível se APIs falharem

7. **RSI 22-Day** (10%)
   - Índice de força relativa de 22 dias
   - Calculado com dados reais da Binance

8. **Rainbow Chart** (10%)
   - Posição nas bandas logarítmicas de preço
   - Calculado a partir de dados públicos; pode ficar indisponível se APIs falharem

dicas de aplicação :

## 1. 📡 **APIs Gratuitas com Dados On-Chain Reais**

### APIs Integradas
- **Bitbo API** (`bitbo.io/api/v1`)
  - MVRV Z-Score em tempo real
  - NUPL (Net Unrealized Profit/Loss) real
  - Puell Multiple com dados de mineração reais

- **BGeometrics API** (`api.bgeometrics.com/v1`)
  - Pi Cycle Top Indicator
  - Dados de Rainbow Chart
  - Métricas on-chain gratuitas

- **CoinGecko API** (já existente, aprimorado)
  - Dominância Bitcoin
  - Dados globais de mercado

- **Alternative.me API** (já existente)
  - Fear & Greed Index real

### Sistema de Fallback Inteligente
```javascript
// Exemplo de implementação
async calculateMVRVZScore() {
    try {
        // Tenta API real primeiro
        const response = await fetch(`${CONFIG.apis.bitbo}/mvrv-z-score?latest=true`);
        if (response.ok) {
            const data = await response.json();
            return {
                value: data.mvrv_z_score,
                score: this.calculateScore(data.mvrv_z_score),
                source: 'Bitbo API (Real)'
            };
        }
    } catch (error) {
        console.error('Error fetching real MVRV:', error);
    }
    
    // Se falhar, marque como indisponível
    return { value: null, score: null, source: 'Indisponível' };
}
```
