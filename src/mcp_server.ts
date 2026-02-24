import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as hl from "./hyperliquid.js";
import * as aixbt from "./aixbt.js";
import * as sig from "./signal.js";

// Initialize Server instance
export const server = new Server(
    {
        name: "trading-mcp-server",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

// Define Data Parsing Schema (Validation)
const ToolInputSchemas = {
    get_markets: z.object({}),
    get_ticker: z.object({ symbol: z.string().describe("Token name, e.g., BTC, ETH") }),
    get_candle_snapshot: z.object({
        symbol: z.string(),
        interval: z.enum(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d", "3d", "1w", "1M"]),
        startTime: z.number().describe("Start timestamp in milliseconds"),
        endTime: z.number().describe("End timestamp in milliseconds")
    }),
    get_l2_book: z.object({
        symbol: z.string(),
        nSigFigs: z.number().optional().describe("Aggregate liquidity by significant figures (e.g., 2, 3, 4, 5)")
    }),
    get_account_state: z.object({
        userAddress: z.string().describe("42-character ETH wallet address of the target account")
    }),
    get_open_positions: z.object({
        userAddress: z.string()
    }),
    get_open_orders: z.object({
        userAddress: z.string()
    }),
    place_order: z.object({
        symbol: z.string(),
        isBuy: z.boolean().describe("true for LONG/BUY, false for SHORT/SELL"),
        price: z.string().describe("Order price (Limit or Trigger) as a string (e.g., '50000.5')"),
        size: z.string().describe("Position size in base asset (e.g., '0.01')"),
        type: z.enum(["Market", "Limit", "Stop Loss", "Take Profit"]).default("Limit"),
        reduceOnly: z.boolean().default(false).describe("true if only closing a position"),
        vaultAddress: z.string().optional().describe("Optional 42-character Vault/Subaccount address if trading via API Wallet"),
        privateKey: z.string().optional().describe("Optional private key for signing. Falls back to HL_PRIVATE_KEY env var")
    }),
    cancel_order: z.object({
        symbol: z.string(),
        oid: z.number().describe("Order ID to cancel"),
        vaultAddress: z.string().optional().describe("Optional Vault/Subaccount address"),
        privateKey: z.string().optional().describe("Optional private key for signing")
    }),
    get_all_mids: z.object({}),
    get_frontend_open_orders: z.object({ userAddress: z.string() }),
    get_user_fees: z.object({ userAddress: z.string() }),
    get_user_fills: z.object({
        userAddress: z.string(),
        aggregateByTime: z.boolean().default(false).describe("Combine partial fills")
    }),
    get_user_fills_by_time: z.object({
        userAddress: z.string(),
        startTime: z.number().describe("Start timestamp ms"),
        endTime: z.number().optional().describe("End timestamp ms"),
        aggregateByTime: z.boolean().default(false)
    }),
    get_user_funding: z.object({
        userAddress: z.string(),
        startTime: z.number().describe("Start timestamp ms"),
        endTime: z.number().optional().describe("End timestamp ms")
    }),
    get_user_rate_limit: z.object({ userAddress: z.string() }),
    get_referral: z.object({ userAddress: z.string() }),
    get_max_builder_fee: z.object({
        userAddress: z.string(),
        builder: z.string().describe("Builder address (42 hex)")
    }),
    get_historical_orders: z.object({ userAddress: z.string() }),
    get_sub_accounts: z.object({ userAddress: z.string() }),
    get_order_status: z.object({
        userAddress: z.string(),
        oid: z.number().describe("Order ID to query")
    }),
    set_referrer: z.object({
        code: z.string().describe("Referral code to apply"),
        privateKey: z.string().optional().describe("Optional private key for signing")
    }),
    approve_builder_fee: z.object({
        builder: z.string().describe("Builder address (42 hex)"),
        maxFeeRate: z.string().describe("Max fee rate as percent string, e.g. '0.01%'"),
        privateKey: z.string().optional().describe("Optional private key for signing")
    }),
    update_leverage: z.object({
        symbol: z.string(),
        leverage: z.number().describe("Leverage multiplier (1-100)"),
        isCross: z.boolean().default(true).describe("true for cross margin, false for isolated"),
        vaultAddress: z.string().optional(),
        privateKey: z.string().optional().describe("Optional private key for signing")
    }),
    update_isolated_margin: z.object({
        symbol: z.string(),
        amount: z.number().describe("USDC amount to add (positive) or remove (negative)"),
        vaultAddress: z.string().optional(),
        privateKey: z.string().optional().describe("Optional private key for signing")
    }),
    modify_order: z.object({
        symbol: z.string(),
        oid: z.number().describe("Order ID to modify"),
        isBuy: z.boolean(),
        price: z.string(),
        size: z.string(),
        type: z.enum(["Market", "Limit", "Stop Loss", "Take Profit"]).default("Limit"),
        reduceOnly: z.boolean().default(false),
        vaultAddress: z.string().optional(),
        privateKey: z.string().optional().describe("Optional private key for signing")
    }),
    cancel_all_orders: z.object({
        vaultAddress: z.string().optional(),
        privateKey: z.string().optional().describe("Optional private key for signing")
    }),
    schedule_cancel: z.object({
        time: z.number().nullable().describe("UTC ms timestamp to cancel all orders, or null to unset"),
        privateKey: z.string().optional().describe("Optional private key for signing")
    }),
    twap_order: z.object({
        symbol: z.string(),
        isBuy: z.boolean(),
        size: z.string(),
        reduceOnly: z.boolean().default(false),
        minutes: z.number().describe("TWAP duration in minutes"),
        randomize: z.boolean().default(true),
        vaultAddress: z.string().optional(),
        privateKey: z.string().optional().describe("Optional private key for signing")
    }),
    cancel_twap_order: z.object({
        symbol: z.string(),
        twapId: z.number().describe("TWAP order ID to cancel"),
        vaultAddress: z.string().optional(),
        privateKey: z.string().optional().describe("Optional private key for signing")
    }),
    create_sub_account: z.object({
        name: z.string().describe("Subaccount name"),
        privateKey: z.string().optional().describe("Optional private key for signing")
    }),
    get_portfolio_summary: z.object({
        userAddress: z.string()
    }),
    calculate_position_size: z.object({
        accountEquity: z.number().describe("Total account value in USDC"),
        riskPercent: z.number().describe("Max risk per trade (1 = 1%)"),
        entryPrice: z.number().describe("Planned entry price"),
        stopLossPrice: z.number().describe("Planned stop loss price")
    }),
    get_trade_stats: z.object({
        userAddress: z.string(),
        startTime: z.number().optional().describe("Start timestamp ms, default 30 days ago")
    }),
    get_fee_analysis: z.object({
        userAddress: z.string(),
        startTime: z.number().optional().describe("Start timestamp ms, default 30 days ago")
    }),
    // AIXBT Sentiment
    get_market_signals: z.object({
        limit: z.number().default(30).describe("Max signals to return (default 30)")
    }),
    get_signals_by_category: z.object({
        categories: z.array(z.string()).describe("Categories: WHALE_ACTIVITY, MARKET_ACTIVITY, TOKEN_ECONOMICS, RISK_ALERT, REGULATORY, PARTNERSHIP, TECH_EVENT, TEAM_UPDATE, ONCHAIN_METRICS, FINANCIAL_EVENT, VISIBILITY_EVENT, OPINION_SPECULATION"),
        limit: z.number().default(20).describe("Max signals to return")
    }),
    get_signals_by_project: z.object({
        projectName: z.string().describe("Project name, e.g. bitcoin, ethereum, solana"),
        limit: z.number().default(20).describe("Max signals to return")
    }),
    // Risk Management
    get_risk_dashboard: z.object({
        userAddress: z.string()
    }),
    check_trade_risk: z.object({
        userAddress: z.string(),
        symbol: z.string(),
        size: z.number().describe("Trade size in base currency"),
        leverage: z.number().describe("Leverage multiplier"),
        isBuy: z.boolean().describe("true=LONG, false=SHORT"),
        stopLossPrice: z.number().optional().describe("Stop loss price for max loss calculation")
    }),
    get_drawdown_status: z.object({
        userAddress: z.string(),
        days: z.number().default(30).describe("Lookback period in days")
    }),
    get_exposure_analysis: z.object({
        userAddress: z.string()
    }),
    get_funding_impact: z.object({
        userAddress: z.string()
    }),
    // Analytics
    get_performance_attribution: z.object({
        userAddress: z.string(),
        days: z.number().default(30).describe("Lookback period in days")
    }),
    get_streak_analysis: z.object({
        userAddress: z.string(),
        days: z.number().default(30).describe("Lookback period in days")
    }),
    get_time_analysis: z.object({
        userAddress: z.string(),
        days: z.number().default(30).describe("Lookback period in days")
    }),
    get_volatility_scanner: z.object({
        limit: z.number().default(10).describe("Number of top movers to return")
    }),
    get_correlation_matrix: z.object({
        symbols: z.array(z.string()).describe("Coin symbols to correlate, e.g. [BTC, ETH, SOL]"),
        interval: z.string().default("1h").describe("Candle interval"),
        periods: z.number().default(48).describe("Number of candles to use")
    }),
    get_order_flow: z.object({
        symbol: z.string().describe("Coin symbol, e.g. BTC")
    }),
    // Signal Detection
    get_rsi_signal: z.object({
        symbol: z.string(),
        interval: z.string().default("15m"),
        period: z.number().default(14),
        overbought: z.number().default(70),
        oversold: z.number().default(30)
    }),
    get_rsi_divergence: z.object({
        symbol: z.string(),
        interval: z.string().default("15m"),
        period: z.number().default(14),
        lookback: z.number().default(30).describe("Number of candles to scan for divergences")
    }),
    get_macd_signal: z.object({
        symbol: z.string(),
        interval: z.string().default("15m"),
        fastPeriod: z.number().default(12),
        slowPeriod: z.number().default(26),
        signalPeriod: z.number().default(9)
    }),
    get_ict_analysis: z.object({
        symbol: z.string(),
        interval: z.string().default("15m"),
        lookback: z.number().default(50)
    }),
    get_smc_analysis: z.object({
        symbol: z.string(),
        interval: z.string().default("15m"),
        lookback: z.number().default(60)
    }),
    get_support_resistance: z.object({
        symbol: z.string(),
        interval: z.string().default("1h").describe("Higher TF recommended: 1h, 4h"),
        lookback: z.number().default(100).describe("Number of candles to scan"),
        tolerance: z.number().default(0.003).describe("Cluster tolerance (0.003 = 0.3%)")
    })
};

// Tool definitions: single source of truth for ListTools metadata
const ToolDefinitions: Array<{ name: string; description: string; inputSchema: Record<string, any> }> = [
    {
        name: "get_markets",
        description: "Get metadata and asset context for all perpetual tokens on Hyperliquid",
        inputSchema: { type: "object", properties: {} }
    },
    {
        name: "get_ticker",
        description: "Get the current mark and oracle prices of a token (e.g., BTC)",
        inputSchema: { type: "object", properties: { symbol: { type: "string", description: "Token name, e.g., BTC, ETH" } }, required: ["symbol"] }
    },
    {
        name: "get_candle_snapshot",
        description: "Get up to 5000 historical OHLCV candles for technical analysis",
        inputSchema: {
            type: "object",
            properties: {
                symbol: { type: "string" },
                interval: { type: "string", enum: ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d", "3d", "1w", "1M"] },
                startTime: { type: "number", description: "Start timestamp in milliseconds" },
                endTime: { type: "number", description: "End timestamp in milliseconds" }
            },
            required: ["symbol", "interval", "startTime", "endTime"]
        }
    },
    {
        name: "get_l2_book",
        description: "Get L2 Orderbook snapshot (Top 20 bids, 20 asks)",
        inputSchema: {
            type: "object",
            properties: {
                symbol: { type: "string" },
                nSigFigs: { type: "number", description: "Aggregate liquidity by significant figures (e.g., 2, 3, 4, 5)" }
            },
            required: ["symbol"]
        }
    },
    {
        name: "get_account_state",
        description: "Read current Margin state and Account Value of a wallet address",
        inputSchema: { type: "object", properties: { userAddress: { type: "string", description: "42-character ETH wallet address" } }, required: ["userAddress"] }
    },
    {
        name: "get_open_positions",
        description: "Read currently held positions (Perps) of a wallet address",
        inputSchema: { type: "object", properties: { userAddress: { type: "string" } }, required: ["userAddress"] }
    },
    {
        name: "get_open_orders",
        description: "Read a list of unfilled resting orders (Limit, TP, SL) of a wallet address",
        inputSchema: { type: "object", properties: { userAddress: { type: "string" } }, required: ["userAddress"] }
    },
    {
        name: "place_order",
        description: "Execute a new Trade Order (Requires 'HL_PRIVATE_KEY' or 'HL_API_WALLET_SECRET' env var)",
        inputSchema: {
            type: "object",
            properties: {
                symbol: { type: "string" },
                isBuy: { type: "boolean", description: "true for LONG/BUY, false for SHORT/SELL" },
                price: { type: "string", description: "Order price as string (e.g., '50000.5')" },
                size: { type: "string", description: "Position size in base asset (e.g., '0.01')" },
                type: { type: "string", enum: ["Market", "Limit", "Stop Loss", "Take Profit"], default: "Limit" },
                reduceOnly: { type: "boolean", default: false, description: "true if only closing a position" },
                vaultAddress: { type: "string", description: "Optional Vault/Subaccount address" }
            },
            required: ["symbol", "isBuy", "price", "size"]
        }
    },
    {
        name: "cancel_order",
        description: "Cancel an active trade order",
        inputSchema: {
            type: "object",
            properties: {
                symbol: { type: "string" },
                oid: { type: "number", description: "Order ID to cancel" },
                vaultAddress: { type: "string", description: "Optional Vault/Subaccount address" }
            },
            required: ["symbol", "oid"]
        }
    },
    {
        name: "get_all_mids",
        description: "Get mid prices for ALL coins on Hyperliquid",
        inputSchema: { type: "object", properties: {} }
    },
    {
        name: "get_frontend_open_orders",
        description: "Get open orders with extra info (margin used, trigger conditions)",
        inputSchema: { type: "object", properties: { userAddress: { type: "string" } }, required: ["userAddress"] }
    },
    {
        name: "get_user_fees",
        description: "Get user fee schedule (maker/taker rates, VIP tier, discounts)",
        inputSchema: { type: "object", properties: { userAddress: { type: "string" } }, required: ["userAddress"] }
    },
    {
        name: "get_user_fills",
        description: "Get user trade fills — last 2000 (price, size, fee, PnL)",
        inputSchema: { type: "object", properties: { userAddress: { type: "string" }, aggregateByTime: { type: "boolean", default: false, description: "Combine partial fills" } }, required: ["userAddress"] }
    },
    {
        name: "get_user_fills_by_time",
        description: "Get user trade fills filtered by time range",
        inputSchema: {
            type: "object",
            properties: {
                userAddress: { type: "string" },
                startTime: { type: "number", description: "Start timestamp ms" },
                endTime: { type: "number", description: "End timestamp ms" },
                aggregateByTime: { type: "boolean", default: false }
            },
            required: ["userAddress", "startTime"]
        }
    },
    {
        name: "get_user_funding",
        description: "Get user funding payment history for perpetual positions",
        inputSchema: {
            type: "object",
            properties: {
                userAddress: { type: "string" },
                startTime: { type: "number", description: "Start timestamp ms" },
                endTime: { type: "number", description: "End timestamp ms" }
            },
            required: ["userAddress", "startTime"]
        }
    },
    {
        name: "get_user_rate_limit",
        description: "Get user API rate limit status",
        inputSchema: { type: "object", properties: { userAddress: { type: "string" } }, required: ["userAddress"] }
    },
    {
        name: "get_referral",
        description: "Get user referral program info and rewards",
        inputSchema: { type: "object", properties: { userAddress: { type: "string" } }, required: ["userAddress"] }
    },
    {
        name: "get_max_builder_fee",
        description: "Check builder fee approval between user and builder address",
        inputSchema: {
            type: "object",
            properties: {
                userAddress: { type: "string" },
                builder: { type: "string", description: "Builder address (42 hex)" }
            },
            required: ["userAddress", "builder"]
        }
    },
    {
        name: "get_historical_orders",
        description: "Get user historical orders — last 2000 (filled, cancelled, expired)",
        inputSchema: { type: "object", properties: { userAddress: { type: "string" } }, required: ["userAddress"] }
    },
    {
        name: "get_sub_accounts",
        description: "Get user subaccounts list",
        inputSchema: { type: "object", properties: { userAddress: { type: "string" } }, required: ["userAddress"] }
    },
    {
        name: "get_order_status",
        description: "Query specific order status by order ID",
        inputSchema: {
            type: "object",
            properties: {
                userAddress: { type: "string" },
                oid: { type: "number", description: "Order ID to query" }
            },
            required: ["userAddress", "oid"]
        }
    },
    {
        name: "set_referrer",
        description: "Set a referral code for the account (one-time, requires HL_PRIVATE_KEY)",
        inputSchema: {
            type: "object",
            properties: { code: { type: "string", description: "Referral code" } },
            required: ["code"]
        }
    },
    {
        name: "approve_builder_fee",
        description: "Approve max builder fee rate for a builder address (requires HL_PRIVATE_KEY)",
        inputSchema: {
            type: "object",
            properties: {
                builder: { type: "string", description: "Builder address (42 hex)" },
                maxFeeRate: { type: "string", description: "Max fee rate as percent string, e.g. '0.01%'" }
            },
            required: ["builder", "maxFeeRate"]
        }
    },
    {
        name: "update_leverage",
        description: "Update leverage for a symbol (cross or isolated)",
        inputSchema: {
            type: "object",
            properties: {
                symbol: { type: "string" },
                leverage: { type: "number", description: "Leverage multiplier (1-100)" },
                isCross: { type: "boolean", default: true, description: "true for cross, false for isolated" },
                vaultAddress: { type: "string", description: "Optional vault address" }
            },
            required: ["symbol", "leverage"]
        }
    },
    {
        name: "update_isolated_margin",
        description: "Add or remove isolated margin for a position",
        inputSchema: {
            type: "object",
            properties: {
                symbol: { type: "string" },
                amount: { type: "number", description: "USDC to add (positive) or remove (negative)" },
                vaultAddress: { type: "string", description: "Optional vault address" }
            },
            required: ["symbol", "amount"]
        }
    },
    {
        name: "modify_order",
        description: "Modify an existing order (change price/size without cancel+replace, keeps queue priority)",
        inputSchema: {
            type: "object",
            properties: {
                symbol: { type: "string" },
                oid: { type: "number", description: "Order ID to modify" },
                isBuy: { type: "boolean" },
                price: { type: "string" },
                size: { type: "string" },
                type: { type: "string", enum: ["Market", "Limit", "Stop Loss", "Take Profit"], default: "Limit" },
                reduceOnly: { type: "boolean", default: false },
                vaultAddress: { type: "string" }
            },
            required: ["symbol", "oid", "isBuy", "price", "size"]
        }
    },
    {
        name: "cancel_all_orders",
        description: "Emergency kill switch — cancel ALL open orders immediately",
        inputSchema: {
            type: "object",
            properties: { vaultAddress: { type: "string" } }
        }
    },
    {
        name: "schedule_cancel",
        description: "Dead man's switch — schedule auto-cancel of all orders at a future time",
        inputSchema: {
            type: "object",
            properties: { time: { type: "number", description: "UTC ms to cancel, or null to unset" } },
            required: ["time"]
        }
    },
    {
        name: "twap_order",
        description: "Place a TWAP order for gradual execution over time",
        inputSchema: {
            type: "object",
            properties: {
                symbol: { type: "string" },
                isBuy: { type: "boolean" },
                size: { type: "string" },
                reduceOnly: { type: "boolean", default: false },
                minutes: { type: "number", description: "TWAP duration in minutes" },
                randomize: { type: "boolean", default: true },
                vaultAddress: { type: "string" }
            },
            required: ["symbol", "isBuy", "size", "minutes"]
        }
    },
    {
        name: "cancel_twap_order",
        description: "Cancel an active TWAP order",
        inputSchema: {
            type: "object",
            properties: {
                symbol: { type: "string" },
                twapId: { type: "number", description: "TWAP order ID" },
                vaultAddress: { type: "string" }
            },
            required: ["symbol", "twapId"]
        }
    },
    {
        name: "create_sub_account",
        description: "Create a new subaccount for risk isolation",
        inputSchema: {
            type: "object",
            properties: { name: { type: "string", description: "Subaccount name" } },
            required: ["name"]
        }
    },
    {
        name: "get_portfolio_summary",
        description: "Comprehensive portfolio overview: equity, PnL, margin usage, all positions with liq prices",
        inputSchema: { type: "object", properties: { userAddress: { type: "string" } }, required: ["userAddress"] }
    },
    {
        name: "calculate_position_size",
        description: "Risk-based position size calculator (Kelly-style). Input: equity, risk%, entry, SL → output: optimal size",
        inputSchema: {
            type: "object",
            properties: {
                accountEquity: { type: "number", description: "Total USDC equity" },
                riskPercent: { type: "number", description: "Max risk per trade (1 = 1%)" },
                entryPrice: { type: "number", description: "Entry price" },
                stopLossPrice: { type: "number", description: "Stop loss price" }
            },
            required: ["accountEquity", "riskPercent", "entryPrice", "stopLossPrice"]
        }
    },
    {
        name: "get_trade_stats",
        description: "Trading performance stats: win rate, profit factor, avg win/loss, total PnL, volume",
        inputSchema: {
            type: "object",
            properties: {
                userAddress: { type: "string" },
                startTime: { type: "number", description: "Start ms, default 30 days ago" }
            },
            required: ["userAddress"]
        }
    },
    {
        name: "get_fee_analysis",
        description: "Fee breakdown: maker vs taker, rebates, effective fee rate, fees by coin",
        inputSchema: {
            type: "object",
            properties: {
                userAddress: { type: "string" },
                startTime: { type: "number", description: "Start ms, default 30 days ago" }
            },
            required: ["userAddress"]
        }
    },
    // ── AIXBT Sentiment ───────────────────────
    {
        name: "get_market_signals",
        description: "Get hot crypto market signals from AIXBT: whale activity, liquidations, ETF flows, regulatory news, token unlocks, risk alerts — aggregated from Twitter/X clusters",
        inputSchema: {
            type: "object",
            properties: { limit: { type: "number", default: 30, description: "Max signals" } }
        }
    },
    {
        name: "get_signals_by_category",
        description: "Filter AIXBT signals by category: WHALE_ACTIVITY, MARKET_ACTIVITY, TOKEN_ECONOMICS, RISK_ALERT, REGULATORY, etc.",
        inputSchema: {
            type: "object",
            properties: {
                categories: { type: "array", items: { type: "string" }, description: "Signal categories" },
                limit: { type: "number", default: 20 }
            },
            required: ["categories"]
        }
    },
    {
        name: "get_signals_by_project",
        description: "Get all signals for a specific project/token (e.g. bitcoin, ethereum, solana, aave)",
        inputSchema: {
            type: "object",
            properties: {
                projectName: { type: "string", description: "Project name" },
                limit: { type: "number", default: 20 }
            },
            required: ["projectName"]
        }
    },
    // ── Risk Management ──────────────────────────
    {
        name: "get_risk_dashboard",
        description: "Real-time risk overview: risk level (LOW/MEDIUM/HIGH/CRITICAL), margin utilization, liquidation distances, unrealized PnL, leverage ratio, all positions with risk metrics",
        inputSchema: {
            type: "object",
            properties: { userAddress: { type: "string" } },
            required: ["userAddress"]
        }
    },
    {
        name: "check_trade_risk",
        description: "Pre-trade risk validation: checks proposed trade against portfolio (margin usage, liquidation distance, max loss vs 5% rule, existing exposure). Returns PASS/CAUTION/REJECT verdict with warnings",
        inputSchema: {
            type: "object",
            properties: {
                userAddress: { type: "string" },
                symbol: { type: "string" },
                size: { type: "number", description: "Trade size in base currency" },
                leverage: { type: "number", description: "Leverage multiplier" },
                isBuy: { type: "boolean", description: "true=LONG, false=SHORT" },
                stopLossPrice: { type: "number", description: "Optional: SL price for max loss calc" }
            },
            required: ["userAddress", "symbol", "size", "leverage", "isBuy"]
        }
    },
    {
        name: "get_drawdown_status",
        description: "Drawdown tracking: current/max drawdown, peak equity, consecutive losses, recovery target — computed from trade fill history",
        inputSchema: {
            type: "object",
            properties: {
                userAddress: { type: "string" },
                days: { type: "number", default: 30, description: "Lookback period" }
            },
            required: ["userAddress"]
        }
    },
    {
        name: "get_exposure_analysis",
        description: "Portfolio exposure breakdown: long/short ratio, directional bias (STRONGLY_LONG/BALANCED/etc), concentration risk, gross leverage, per-asset notional",
        inputSchema: {
            type: "object",
            properties: { userAddress: { type: "string" } },
            required: ["userAddress"]
        }
    },
    {
        name: "get_funding_impact",
        description: "Funding rate cost/income projection: daily, monthly, annual impact on open positions. Shows which positions earn vs pay funding",
        inputSchema: {
            type: "object",
            properties: { userAddress: { type: "string" } },
            required: ["userAddress"]
        }
    },
    // ── Advanced Analytics ───────────────────────
    {
        name: "get_performance_attribution",
        description: "PnL breakdown by coin: win rate, avg PnL, best/worst trades, Sharpe ratio estimate. Identifies which assets contribute most to performance",
        inputSchema: {
            type: "object",
            properties: { userAddress: { type: "string" }, days: { type: "number", default: 30 } },
            required: ["userAddress"]
        }
    },
    {
        name: "get_streak_analysis",
        description: "Win/loss streak analysis: current streak, longest streaks, profit factor, expectancy per trade, risk:reward ratio, gross profit/loss",
        inputSchema: {
            type: "object",
            properties: { userAddress: { type: "string" }, days: { type: "number", default: 30 } },
            required: ["userAddress"]
        }
    },
    {
        name: "get_time_analysis",
        description: "Performance by time: best/worst trading session (Asia/Europe/US), best day of week, most active hour, most profitable hour",
        inputSchema: {
            type: "object",
            properties: { userAddress: { type: "string" }, days: { type: "number", default: 30 } },
            required: ["userAddress"]
        }
    },
    {
        name: "get_volatility_scanner",
        description: "Scan all Hyperliquid perpetuals for top 24h movers and least volatile coins. Returns price change %, direction, and average market volatility",
        inputSchema: {
            type: "object",
            properties: { limit: { type: "number", default: 10, description: "Top N movers" } }
        }
    },
    {
        name: "get_correlation_matrix",
        description: "Pearson correlation matrix between coins using candle data. Includes diversification score (0-10). Use to assess portfolio diversification",
        inputSchema: {
            type: "object",
            properties: {
                symbols: { type: "array", items: { type: "string" }, description: "Coins to correlate" },
                interval: { type: "string", default: "1h" },
                periods: { type: "number", default: 48 }
            },
            required: ["symbols"]
        }
    },
    {
        name: "get_order_flow",
        description: "L2 orderbook analysis: bid/ask ratio, book imbalance, spread, bid/ask walls (large orders), sentiment (BULLISH/BEARISH/NEUTRAL)",
        inputSchema: {
            type: "object",
            properties: { symbol: { type: "string" } },
            required: ["symbol"]
        }
    },
    // ── Signal Detection ──────────────────────────
    {
        name: "get_rsi_signal",
        description: "RSI indicator: overbought/oversold detection, bullish/bearish cross, RSI trend. Uses Wilder smoothing",
        inputSchema: {
            type: "object",
            properties: {
                symbol: { type: "string" },
                interval: { type: "string", default: "15m" },
                period: { type: "number", default: 14 },
                overbought: { type: "number", default: 70 },
                oversold: { type: "number", default: 30 }
            },
            required: ["symbol"]
        }
    },
    {
        name: "get_rsi_divergence",
        description: "RSI divergence detection: bullish divergence (price lower low + RSI higher low) and bearish divergence (price higher high + RSI lower high). Leading reversal signal",
        inputSchema: {
            type: "object",
            properties: {
                symbol: { type: "string" },
                interval: { type: "string", default: "15m" },
                period: { type: "number", default: 14 },
                lookback: { type: "number", default: 30 }
            },
            required: ["symbol"]
        }
    },
    {
        name: "get_macd_signal",
        description: "MACD crossover analysis: bullish/bearish cross, momentum strength (expanding/contracting histogram), zero-line cross",
        inputSchema: {
            type: "object",
            properties: {
                symbol: { type: "string" },
                interval: { type: "string", default: "15m" },
                fastPeriod: { type: "number", default: 12 },
                slowPeriod: { type: "number", default: 26 },
                signalPeriod: { type: "number", default: 9 }
            },
            required: ["symbol"]
        }
    },
    {
        name: "get_ict_analysis",
        description: "ICT (Inner Circle Trader) concepts: Fair Value Gaps (unfilled imbalances), Order Blocks (institutional entry zones), Liquidity Sweeps (stop hunts)",
        inputSchema: {
            type: "object",
            properties: {
                symbol: { type: "string" },
                interval: { type: "string", default: "15m" },
                lookback: { type: "number", default: 50 }
            },
            required: ["symbol"]
        }
    },
    {
        name: "get_smc_analysis",
        description: "Smart Money Concept: market structure (HH/HL/LH/LL), Break of Structure (BOS), Change of Character (CHoCH), Supply/Demand zones, Liquidity Pools (equal highs/lows)",
        inputSchema: {
            type: "object",
            properties: {
                symbol: { type: "string" },
                interval: { type: "string", default: "15m" },
                lookback: { type: "number", default: 60 }
            },
            required: ["symbol"]
        }
    },
    {
        name: "get_support_resistance",
        description: "Support & Resistance zones: detects key price levels from swing highs/lows clustering, strength rating (WEAK → VERY_STRONG by touches), proximity (AT_SUPPORT/AT_RESISTANCE/NEAR/BETWEEN), psychological round-number levels",
        inputSchema: {
            type: "object",
            properties: {
                symbol: { type: "string" },
                interval: { type: "string", default: "1h", description: "Higher TF for stronger levels" },
                lookback: { type: "number", default: 100 },
                tolerance: { type: "number", default: 0.003, description: "Cluster tolerance 0.3%" }
            },
            required: ["symbol"]
        }
    }
];

// Register Tools Metadata
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: ToolDefinitions };
});


// Handle Call Tool Event from Agent
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    
    try {
        let result: any;
        switch (name) {
            case "get_markets":
                result = await hl.getMarkets();
                break;
            case "get_ticker": {
                const parsed = ToolInputSchemas.get_ticker.parse(args);
                result = await hl.getTicker(parsed.symbol);
                break;
            }
            case "get_candle_snapshot": {
                const parsed = ToolInputSchemas.get_candle_snapshot.parse(args);
                result = await hl.getCandleSnapshot(parsed.symbol, parsed.interval, parsed.startTime, parsed.endTime);
                break;
            }
            case "get_l2_book": {
                const parsed = ToolInputSchemas.get_l2_book.parse(args);
                result = await hl.getL2Book(parsed.symbol, parsed.nSigFigs);
                break;
            }
            case "get_account_state": {
                const parsed = ToolInputSchemas.get_account_state.parse(args);
                result = await hl.getAccountState(parsed.userAddress);
                break;
            }
            case "get_open_positions": {
                const parsed = ToolInputSchemas.get_open_positions.parse(args);
                result = await hl.getOpenPositions(parsed.userAddress);
                break;
            }
            case "get_open_orders": {
                const parsed = ToolInputSchemas.get_open_orders.parse(args);
                result = await hl.getOpenOrders(parsed.userAddress);
                break;
            }
            case "place_order": {
                const parsed = ToolInputSchemas.place_order.parse(args);
                result = await hl.placeOrder(parsed.symbol, parsed.isBuy, parsed.price, parsed.size, parsed.type as any, parsed.reduceOnly, parsed.vaultAddress, parsed.privateKey);
                break;
            }
            case "cancel_order": {
                const parsed = ToolInputSchemas.cancel_order.parse(args);
                result = await hl.cancelOrder(parsed.symbol, parsed.oid, parsed.vaultAddress, parsed.privateKey);
                break;
            }
            case "get_all_mids":
                result = await hl.getAllMids();
                break;
            case "get_frontend_open_orders": {
                const parsed = ToolInputSchemas.get_frontend_open_orders.parse(args);
                result = await hl.getFrontendOpenOrders(parsed.userAddress);
                break;
            }
            case "get_user_fees": {
                const parsed = ToolInputSchemas.get_user_fees.parse(args);
                result = await hl.getUserFees(parsed.userAddress);
                break;
            }
            case "get_user_fills": {
                const parsed = ToolInputSchemas.get_user_fills.parse(args);
                result = await hl.getUserFills(parsed.userAddress, parsed.aggregateByTime);
                break;
            }
            case "get_user_fills_by_time": {
                const parsed = ToolInputSchemas.get_user_fills_by_time.parse(args);
                result = await hl.getUserFillsByTime(parsed.userAddress, parsed.startTime, parsed.endTime, parsed.aggregateByTime);
                break;
            }
            case "get_user_funding": {
                const parsed = ToolInputSchemas.get_user_funding.parse(args);
                result = await hl.getUserFunding(parsed.userAddress, parsed.startTime, parsed.endTime);
                break;
            }
            case "get_user_rate_limit": {
                const parsed = ToolInputSchemas.get_user_rate_limit.parse(args);
                result = await hl.getUserRateLimit(parsed.userAddress);
                break;
            }
            case "get_referral": {
                const parsed = ToolInputSchemas.get_referral.parse(args);
                result = await hl.getReferral(parsed.userAddress);
                break;
            }
            case "get_max_builder_fee": {
                const parsed = ToolInputSchemas.get_max_builder_fee.parse(args);
                result = await hl.getMaxBuilderFee(parsed.userAddress, parsed.builder);
                break;
            }
            case "get_historical_orders": {
                const parsed = ToolInputSchemas.get_historical_orders.parse(args);
                result = await hl.getHistoricalOrders(parsed.userAddress);
                break;
            }
            case "get_sub_accounts": {
                const parsed = ToolInputSchemas.get_sub_accounts.parse(args);
                result = await hl.getSubAccounts(parsed.userAddress);
                break;
            }
            case "get_order_status": {
                const parsed = ToolInputSchemas.get_order_status.parse(args);
                result = await hl.getOrderStatus(parsed.userAddress, parsed.oid);
                break;
            }
            case "set_referrer": {
                const parsed = ToolInputSchemas.set_referrer.parse(args);
                result = await hl.setReferrer(parsed.code, parsed.privateKey);
                break;
            }
            case "approve_builder_fee": {
                const parsed = ToolInputSchemas.approve_builder_fee.parse(args);
                result = await hl.approveBuilderFee(parsed.builder, parsed.maxFeeRate, parsed.privateKey);
                break;
            }
            case "update_leverage": {
                const parsed = ToolInputSchemas.update_leverage.parse(args);
                result = await hl.updateLeverage(parsed.symbol, parsed.leverage, parsed.isCross, parsed.vaultAddress, parsed.privateKey);
                break;
            }
            case "update_isolated_margin": {
                const parsed = ToolInputSchemas.update_isolated_margin.parse(args);
                result = await hl.updateIsolatedMargin(parsed.symbol, parsed.amount, parsed.vaultAddress, parsed.privateKey);
                break;
            }
            case "modify_order": {
                const parsed = ToolInputSchemas.modify_order.parse(args);
                result = await hl.modifyOrder(parsed.symbol, parsed.oid, parsed.isBuy, parsed.price, parsed.size, parsed.type as any, parsed.reduceOnly, parsed.vaultAddress, parsed.privateKey);
                break;
            }
            case "cancel_all_orders": {
                const parsed = ToolInputSchemas.cancel_all_orders.parse(args);
                result = await hl.cancelAllOrders(parsed.vaultAddress, parsed.privateKey);
                break;
            }
            case "schedule_cancel": {
                const parsed = ToolInputSchemas.schedule_cancel.parse(args);
                result = await hl.scheduleCancel(parsed.time, undefined, parsed.privateKey);
                break;
            }
            case "twap_order": {
                const parsed = ToolInputSchemas.twap_order.parse(args);
                result = await hl.twapOrder(parsed.symbol, parsed.isBuy, parsed.size, parsed.reduceOnly, parsed.minutes, parsed.randomize, parsed.vaultAddress, parsed.privateKey);
                break;
            }
            case "cancel_twap_order": {
                const parsed = ToolInputSchemas.cancel_twap_order.parse(args);
                result = await hl.cancelTwapOrder(parsed.symbol, parsed.twapId, parsed.vaultAddress, parsed.privateKey);
                break;
            }
            case "create_sub_account": {
                const parsed = ToolInputSchemas.create_sub_account.parse(args);
                result = await hl.createSubAccount(parsed.name, parsed.privateKey);
                break;
            }
            case "get_portfolio_summary": {
                const parsed = ToolInputSchemas.get_portfolio_summary.parse(args);
                result = await hl.getPortfolioSummary(parsed.userAddress);
                break;
            }
            case "calculate_position_size": {
                const parsed = ToolInputSchemas.calculate_position_size.parse(args);
                result = hl.calculatePositionSize(parsed.accountEquity, parsed.riskPercent, parsed.entryPrice, parsed.stopLossPrice);
                break;
            }
            case "get_trade_stats": {
                const parsed = ToolInputSchemas.get_trade_stats.parse(args);
                result = await hl.getTradeStats(parsed.userAddress, parsed.startTime);
                break;
            }
            case "get_fee_analysis": {
                const parsed = ToolInputSchemas.get_fee_analysis.parse(args);
                result = await hl.getFeeAnalysis(parsed.userAddress, parsed.startTime);
                break;
            }
            // ── AIXBT Sentiment ───────────────────────
            case "get_market_signals": {
                const parsed = ToolInputSchemas.get_market_signals.parse(args);
                result = await aixbt.getMarketSignals(parsed.limit);
                break;
            }
            case "get_signals_by_category": {
                const parsed = ToolInputSchemas.get_signals_by_category.parse(args);
                result = await aixbt.getSignalsByCategory(parsed.categories, parsed.limit);
                break;
            }
            case "get_signals_by_project": {
                const parsed = ToolInputSchemas.get_signals_by_project.parse(args);
                result = await aixbt.getSignalsByProject(parsed.projectName, parsed.limit);
                break;
            }
            // ── Risk Management ──────────────────────────
            case "get_risk_dashboard": {
                const parsed = ToolInputSchemas.get_risk_dashboard.parse(args);
                result = await hl.getRiskDashboard(parsed.userAddress);
                break;
            }
            case "check_trade_risk": {
                const parsed = ToolInputSchemas.check_trade_risk.parse(args);
                result = await hl.checkTradeRisk(parsed.userAddress, parsed.symbol, parsed.size, parsed.leverage, parsed.isBuy, parsed.stopLossPrice);
                break;
            }
            case "get_drawdown_status": {
                const parsed = ToolInputSchemas.get_drawdown_status.parse(args);
                result = await hl.getDrawdownStatus(parsed.userAddress, parsed.days);
                break;
            }
            case "get_exposure_analysis": {
                const parsed = ToolInputSchemas.get_exposure_analysis.parse(args);
                result = await hl.getExposureAnalysis(parsed.userAddress);
                break;
            }
            case "get_funding_impact": {
                const parsed = ToolInputSchemas.get_funding_impact.parse(args);
                result = await hl.getFundingImpact(parsed.userAddress);
                break;
            }
            // ── Advanced Analytics ───────────────────────
            case "get_performance_attribution": {
                const parsed = ToolInputSchemas.get_performance_attribution.parse(args);
                result = await hl.getPerformanceAttribution(parsed.userAddress, parsed.days);
                break;
            }
            case "get_streak_analysis": {
                const parsed = ToolInputSchemas.get_streak_analysis.parse(args);
                result = await hl.getStreakAnalysis(parsed.userAddress, parsed.days);
                break;
            }
            case "get_time_analysis": {
                const parsed = ToolInputSchemas.get_time_analysis.parse(args);
                result = await hl.getTimeAnalysis(parsed.userAddress, parsed.days);
                break;
            }
            case "get_volatility_scanner": {
                const parsed = ToolInputSchemas.get_volatility_scanner.parse(args);
                result = await hl.getVolatilityScanner(parsed.limit);
                break;
            }
            case "get_correlation_matrix": {
                const parsed = ToolInputSchemas.get_correlation_matrix.parse(args);
                result = await hl.getCorrelationMatrix(parsed.symbols, parsed.interval, parsed.periods);
                break;
            }
            case "get_order_flow": {
                const parsed = ToolInputSchemas.get_order_flow.parse(args);
                result = await hl.getOrderFlow(parsed.symbol);
                break;
            }
            // ── Signal Detection ──────────────────────────
            case "get_rsi_signal": {
                const parsed = ToolInputSchemas.get_rsi_signal.parse(args);
                result = await sig.getRSISignal(parsed.symbol, parsed.interval, parsed.period, parsed.overbought, parsed.oversold);
                break;
            }
            case "get_rsi_divergence": {
                const parsed = ToolInputSchemas.get_rsi_divergence.parse(args);
                result = await sig.getRSIDivergence(parsed.symbol, parsed.interval, parsed.period, parsed.lookback);
                break;
            }
            case "get_macd_signal": {
                const parsed = ToolInputSchemas.get_macd_signal.parse(args);
                result = await sig.getMACDSignal(parsed.symbol, parsed.interval, parsed.fastPeriod, parsed.slowPeriod, parsed.signalPeriod);
                break;
            }
            case "get_ict_analysis": {
                const parsed = ToolInputSchemas.get_ict_analysis.parse(args);
                result = await sig.getICTAnalysis(parsed.symbol, parsed.interval, parsed.lookback);
                break;
            }
            case "get_smc_analysis": {
                const parsed = ToolInputSchemas.get_smc_analysis.parse(args);
                result = await sig.getSMCAnalysis(parsed.symbol, parsed.interval, parsed.lookback);
                break;
            }
            case "get_support_resistance": {
                const parsed = ToolInputSchemas.get_support_resistance.parse(args);
                result = await sig.getSupportResistance(parsed.symbol, parsed.interval, parsed.lookback, parsed.tolerance);
                break;
            }
            default:
                throw new Error("Unknown tool: " + name);
        }

        return {
            content: [{
                type: "text",
                text: JSON.stringify(result, null, 2)
            }]
        };
    } catch (error: any) {
        return {
            content: [{
                type: "text",
                text: `Tool execution error: ${error.message}`
            }],
            isError: true
        };
    }
});
