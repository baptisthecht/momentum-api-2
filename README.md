# Momentum API v2

NestJS trading bot backend. EMA+RSI+ATR momentum strategy on Bitget futures.

## Quick Start

```bash
docker compose up -d        # PostgreSQL + pgAdmin
npm install
npm run start:dev
# Swagger → http://localhost:3000/docs
# pgAdmin → http://localhost:5050 (admin@momentum.local / admin)
```

## Key Features

- **No JSON in DB** — 44 typed columns on strategy, relation tables for TP targets and overrides
- **Signal evaluations** — Every candle, every condition logged with expected vs actual values
- **24/7 candle storage** — All tracked symbols stored regardless of active sessions
- **Real + simulation** — `simulation: false` by default, set `true` to paper trade
- **Swagger UI** — Full typed API docs

## DB: 12 tables

`users` · `strategies` · `strategy_tp_templates` · `strategy_symbol_overrides` · `symbol_override_tp_templates` · `sessions` · `candles` · `positions` · `position_tp_targets` · `trades` · `signal_evaluations` · `signal_condition_checks`
