def compute_order_quantity(price, sl_price, effective_capital, risk_per_trade, max_notional):
    """Qty such that a fill at sl_price loses ~risk_usd, then cap by max_notional.

    Must divide risk by |price - stop|, never by price. Dividing by price treats
    risk_per_trade as the position fraction and undersizes cheap coins.
    """
    price = float(price or 0)
    sl_price = float(sl_price or 0)
    effective_capital = float(effective_capital or 0)
    risk_per_trade = float(risk_per_trade or 0)
    max_notional = float(max_notional or 0)
    sl_distance = abs(price - sl_price)
    if price <= 0 or sl_distance <= 0 or effective_capital <= 0 or risk_per_trade <= 0:
        return 0.0, 0.0, sl_distance, 0.0
    risk_usd = effective_capital * risk_per_trade
    quantity = risk_usd / sl_distance
    notional = quantity * price
    if max_notional > 0 and notional > max_notional:
        quantity = max_notional / price
        notional = quantity * price
    return quantity, notional, sl_distance, risk_usd
