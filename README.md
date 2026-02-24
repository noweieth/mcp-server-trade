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

### Configuration

```bash
cp .env.example .env
```

Edit `.env` and add your Hyperliquid credentials:

```env
# Option 1: Direct private key
HL_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE

# Option 2: API wallet (recommended for production)
HL_API_WALLET_SECRET=0xYOUR_API_WALLET_SECRET_HERE
```

> **Note:** Read-only tools (market data, signals, analytics) work without credentials. Trading tools require one of the above.

### Build & Run

```bash
# Build TypeScript
npm run build

# Run server
npm start
```

### Development

```bash
# Run directly without building
npx tsx src/index.ts
```

## MCP Client Configuration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "trading": {
      "command": "node",
      "args": ["/path/to/mcp-server-trade/dist/index.js"],
      "env": {
        "HL_PRIVATE_KEY": "0xYOUR_KEY"
      }
    }
  }
}
```

### Cursor / VS Code

Add to `.cursor/mcp.json` or equivalent:

```json
{
  "mcpServers": {
    "trading": {
      "command": "npx",
      "args": ["tsx", "/path/to/mcp-server-trade/src/index.ts"],
      "env": {
        "HL_PRIVATE_KEY": "0xYOUR_KEY"
      }
    }
  }
}
```

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
├── index.ts          # Entry point (stdio transport)
├── mcp_server.ts     # MCP server: schemas, tool definitions, handlers
├── hyperliquid.ts    # Hyperliquid API client + risk/analytics tools
├── aixbt.ts          # AIXBT sentiment API client
└── signal.ts         # Technical analysis signal detection
```

## License

ISC
