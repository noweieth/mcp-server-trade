# MCP Server Trade

A comprehensive MCP (Model Context Protocol) server for cryptocurrency trading on **Hyperliquid DEX**. Provides 55 tools covering market data, order execution, risk management, analytics, sentiment analysis, and technical signal detection.

Built for AI agents (Claude, Gemini, etc.) to autonomously analyze markets and execute trades.

## Features

### 🏦 Hyperliquid Exchange (35 tools)
- **Market Data** — Tickers, candles, orderbook, all mid prices
- **Account** — Positions, orders, fills, funding, fees, subaccounts
- **Trading** — Place/cancel/modify orders, TWAP, leverage, margin
- **Computed** — Portfolio summary, position sizing, trade stats, fee analysis

### 📡 AIXBT Sentiment (3 tools)
- Market signals aggregated from Twitter/X clusters
- Filter by category (whale activity, liquidations, regulatory)
- Filter by project (bitcoin, ethereum, solana, etc.)

### 🛡️ Risk Management (5 tools)
- Real-time risk dashboard (risk level, margin utilization, liquidation distance)
- Pre-trade risk validation
- Drawdown tracking, exposure analysis, funding impact

### 📊 Advanced Analytics (6 tools)
- Performance attribution by coin (PnL, win rate, Sharpe ratio)
- Win/loss streak analysis (profit factor, expectancy, R:R)
- Time-based analysis (best session, day, hour)
- Volatility scanner (top movers across all perps)
- Correlation matrix (portfolio diversification score)
- Order flow analysis (bid/ask imbalance, walls, sentiment)

### 📈 Signal Detection (6 tools)
- **RSI** — Overbought/oversold, bullish/bearish cross (Wilder smoothing)
- **RSI Divergence** — Bullish/bearish divergence via swing point comparison
- **MACD** — Crossover, momentum, histogram trend, zero-line cross
- **ICT** — Fair Value Gaps, Order Blocks, Liquidity Sweeps
- **Smart Money Concept** — Market structure (HH/HL/LH/LL), BOS, CHoCH, Supply/Demand zones, Liquidity Pools
- **Support & Resistance** — Swing clustering, strength rating, psychological levels

## Quick Start

### Prerequisites
- Node.js 18+
- npm

### Installation

```bash
git clone git@github.com:noweieth/mcp-server-trade.git
cd mcp-server-trade
npm install
```

### Running

Two transport modes available:

```bash
# Mode 1: stdio (for MCP clients — Claude, Gemini CLI, Cursor)
npm run dev

# Mode 2: HTTP/SSE (for browser, curl, remote clients)
npm run dev:http            # default port 3000
npx tsx src/http_server.ts 8080  # custom port
```

### Production Build

```bash
npm run build   # TypeScript → dist/
npm start       # node dist/index.js (stdio mode)
```

## MCP Client Configuration

> **Private key is optional.** All read-only tools (market data, signals, analytics, risk) work without credentials. Trading tools accept `privateKey` as a per-request parameter — no need to configure keys in MCP config.

### Gemini CLI

Add to `.gemini/settings.json` (project or global):

```json
{
  "mcpServers": {
    "trading": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/mcp-server-trade/src/index.ts"]
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "trading": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/mcp-server-trade/src/index.ts"]
    }
  }
}
```

### Cursor / VS Code

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "trading": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/mcp-server-trade/src/index.ts"]
    }
  }
}
```

### HTTP/SSE Mode (MCP Inspector, remote clients)

```bash
npm run dev:http
```

```
GET  http://localhost:3000/sse       → SSE stream (MCP client connects here)
POST http://localhost:3000/messages  → JSON-RPC messages
GET  http://localhost:3000/health    → Health check
```

## Multi-Wallet Support

All 12 trading tools accept an optional `privateKey` parameter per-request. No need to restart the server or configure separate instances.

```json
{
  "name": "place_order",
  "arguments": {
    "symbol": "BTC",
    "isBuy": true,
    "price": "60000",
    "size": "0.01",
    "privateKey": "0xYOUR_PRIVATE_KEY"
  }
}
```

If `privateKey` is not provided, the server falls back to `HL_PRIVATE_KEY` or `HL_API_WALLET_SECRET` from environment variables. If neither exists, an error is returned.

Tools that support `privateKey`:
`place_order` · `cancel_order` · `modify_order` · `cancel_all_orders` · `schedule_cancel` · `twap_order` · `cancel_twap_order` · `update_leverage` · `update_isolated_margin` · `set_referrer` · `approve_builder_fee` · `create_sub_account`

## All 55 Tools

<details>
<summary><strong>Hyperliquid Core (35)</strong></summary>

| Tool | Description |
|---|---|
| `get_markets` | All perpetual token metadata + asset contexts |
| `get_ticker` | Single token ticker (price, volume, funding) |
| `get_candle_snapshot` | OHLCV candle data for any interval |
| `get_l2_book` | L2 orderbook snapshot (20 levels) |
| `get_account_state` | Full clearinghouse state for an address |
| `get_open_positions` | Current open positions |
| `get_open_orders` | Unfilled resting orders |
| `get_all_mids` | Mid prices for all coins |
| `get_frontend_open_orders` | Orders with extra frontend metadata |
| `get_user_fees` | Fee schedule and rates |
| `get_user_fills` | Trade fill history |
| `get_user_fills_by_time` | Fills within a time range |
| `get_user_funding` | Funding payment history |
| `get_user_rate_limit` | API rate limit status |
| `get_referral` | Referral program info |
| `get_max_builder_fee` | Builder fee approval status |
| `get_historical_orders` | Historical order records |
| `get_sub_accounts` | List subaccounts |
| `get_order_status` | Status of a specific order |
| `place_order` | Execute a trade order |
| `cancel_order` | Cancel an order by OID |
| `cancel_all_orders` | Cancel all open orders |
| `modify_order` | Modify an existing order |
| `schedule_cancel` | Dead man's switch (auto-cancel) |
| `twap_order` | Time-weighted average price order |
| `cancel_twap_order` | Cancel a TWAP order |
| `set_referrer` | Set referral code |
| `approve_builder_fee` | Approve builder fee |
| `update_leverage` | Set leverage for a symbol |
| `update_isolated_margin` | Add/remove isolated margin |
| `create_sub_account` | Create a new subaccount |
| `get_portfolio_summary` | Portfolio overview (equity, margin, positions) |
| `calculate_position_size` | Position sizing given risk parameters |
| `get_trade_stats` | Historical trading statistics |
| `get_fee_analysis` | Fee breakdown and savings analysis |

</details>

<details>
<summary><strong>AIXBT Sentiment (3)</strong></summary>

| Tool | Description |
|---|---|
| `get_market_signals` | Hot crypto signals (whale, liquidation, ETF, regulatory) |
| `get_signals_by_category` | Filter by WHALE_ACTIVITY, RISK_ALERT, etc. |
| `get_signals_by_project` | Filter by project name (bitcoin, solana, etc.) |

</details>

<details>
<summary><strong>Risk Management (5)</strong></summary>

| Tool | Description |
|---|---|
| `get_risk_dashboard` | Real-time risk overview (level, margin, liquidation) |
| `check_trade_risk` | Pre-trade risk validation with warnings |
| `get_drawdown_status` | Max drawdown, consecutive losses |
| `get_exposure_analysis` | Long/short ratio, concentration risk |
| `get_funding_impact` | Funding rate cost/income projection |

</details>

<details>
<summary><strong>Analytics (6)</strong></summary>

| Tool | Description |
|---|---|
| `get_performance_attribution` | PnL by coin, Sharpe ratio, best/worst trades |
| `get_streak_analysis` | Win/loss streaks, profit factor, expectancy |
| `get_time_analysis` | Performance by session, day, hour |
| `get_volatility_scanner` | Top volatile coins (24h movers) |
| `get_correlation_matrix` | Pearson correlation + diversification score |
| `get_order_flow` | L2 bid/ask imbalance, walls, sentiment |

</details>

<details>
<summary><strong>Signal Detection (6)</strong></summary>

| Tool | Description |
|---|---|
| `get_rsi_signal` | RSI overbought/oversold/cross detection |
| `get_rsi_divergence` | Bullish/bearish divergence (leading reversal signal) |
| `get_macd_signal` | MACD crossover, momentum, zero-line analysis |
| `get_ict_analysis` | Fair Value Gaps, Order Blocks, Liquidity Sweeps |
| `get_smc_analysis` | Market structure, BOS, CHoCH, Supply/Demand, Liquidity Pools |
| `get_support_resistance` | Key S/R zones with strength rating |

</details>

## Architecture

```
src/
├── index.ts          # Stdio transport (MCP clients)
├── http_server.ts    # HTTP/SSE transport (localhost)
├── mcp_server.ts     # Tool schemas, definitions, handlers
├── hyperliquid.ts    # Hyperliquid API + risk + analytics
├── aixbt.ts          # AIXBT sentiment API
└── signal.ts         # Technical analysis signals
```

## License

ISC

