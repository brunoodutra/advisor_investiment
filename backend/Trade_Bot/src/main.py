import time
from datetime import datetime, timezone

from .config import Config
from .logger import setup_logger
from .exchange_client import ExchangeClient
from .state_manager import StateManager
from .signal_reader import SignalReader
from .trade_manager import TradeManager


def main():
    logger = setup_logger()
    logger.info("------------------------------------------------")
    logger.info("   Starting Trade Bot - " + Config.TRADING_MODE)
    logger.info("------------------------------------------------")

    try:
        Config.validate()
    except Exception as e:
        logger.error(f"Configuration Error: {e}")
        return

    try:
        exchange = ExchangeClient()
        if not exchange.validate_connection():
            logger.error("Falha na validacao da conexao com a Binance. Encerrando o bot para evitar operacao inconsistente.")
            return
        state = StateManager()
        signals = SignalReader()
        manager = TradeManager(exchange, state)

        logger.info("Bot initialized. Monitoring: %s", Config.SYMBOLS)

        cycle_count = 0
        last_bot_status = None
        while True:
            current_config = state.load_config()
            current_status = current_config.get("status", "running")
            if current_status != last_bot_status:
                logger.info("Status do Trade Bot alterado para: %s", str(current_status).upper())
                last_bot_status = current_status

            state.patch_config({"last_loop_at": datetime.now(timezone.utc).isoformat()})

            try:
                manager.process_pending_commands()
            except Exception as e:
                logger.error("Erro ao processar fila de comandos: %s", e, exc_info=True)

            if current_status != "running":
                time.sleep(2)
                continue

            for symbol in Config.SYMBOLS:
                try:
                    manager.sync_state(symbol)
                    latest_signal = signals.get_latest_signal(symbol, profile=state.get_risk_profile())
                    if latest_signal:
                        manager.process_signal(symbol, latest_signal)
                except Exception as e:
                    logger.error("Error processing %s: %s", symbol, e, exc_info=True)

            cycle_count += 1
            if Config.PNL_LOG_INTERVAL > 0 and cycle_count % Config.PNL_LOG_INTERVAL == 0:
                total_pnl = manager.calculate_total_pnl()
                if total_pnl["trade_count"] > 0:
                    logger.info(
                        "Total P&L: $%.2f (%.2f%%) on %s trade(s). Total Position: $%.2f",
                        total_pnl["total_pnl_usd"],
                        total_pnl["pnl_percent"],
                        total_pnl["trade_count"],
                        total_pnl["total_position_value_usd"],
                    )

            time.sleep(30)

    except KeyboardInterrupt:
        logger.info("Bot stopping...")
    except Exception as e:
        logger.critical("Fatal error: %s", e, exc_info=True)


if __name__ == "__main__":
    main()
