import { ethers } from "ethers";
import { encode } from "@msgpack/msgpack";

const HL_API_INFO_URL = "https://api.hyperliquid.xyz/info";
const HL_API_EXCHANGE_URL = "https://api.hyperliquid.xyz/exchange";

const IS_TESTNET = false;

// EIP-712 Domain for L1 Phantom Agent signing (order, cancel, etc.)
const PHANTOM_AGENT_DOMAIN = {
    name: "Exchange",
    version: "1",
    chainId: 1337,
    verifyingContract: "0x0000000000000000000000000000000000000000",
};

// EIP-712 Types for Phantom Agent
const PHANTOM_AGENT_TYPES = {
    Agent: [
        { name: "source", type: "string" },
        { name: "connectionId", type: "bytes32" },
    ],
};

// Get signer wallet — accepts optional privateKey, falls back to env
function getSigner(privateKey?: string) {
    const pk = privateKey || process.env.HL_PRIVATE_KEY || process.env.HL_API_WALLET_SECRET;
    if (!pk) {
        throw new Error("No privateKey provided and no HL_PRIVATE_KEY or HL_API_WALLET_SECRET in env");
    }
    return new ethers.Wallet(pk);
}

/**
 * Generic function to call L1 REST API (/info)
 */
async function fetchInfoAPI(payload: any) {
    try {
        const response = await fetch(HL_API_INFO_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Hyperliquid API HTTP Error: ${response.status} - ${response.statusText} - ${errText}`);
        }
        
        return await response.json();
    } catch (error: any) {
        console.error("Error calling Hyperliquid Info API:", error.message);
        throw error;
    }
}

/**
 * Generic function to call L1 REST API via Exchange Action (requires signature)
 */
async function executeExchangeAction(action: any, nonce: number, signature: any, vaultAddress?: string) {
    try {
        const payload: any = {
            action: action,
            nonce: nonce,
            signature: signature
        };
        
        if (vaultAddress) {
            payload.vaultAddress = vaultAddress;
        }

        const response = await fetch(HL_API_EXCHANGE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Hyperliquid Exchange HTTP Error: ${response.status} - ${response.statusText} - ${errText}`);
        }
        
        return await response.json();
    } catch (error: any) {
        console.error("Error calling Hyperliquid Exchange API:", error.message);
        throw error;
    }
}

// ----------------------------------------------------------------------
// GROUP 1: MARKET DATA
// ----------------------------------------------------------------------

/**
 * Get Meta Data and Asset Contexts for all Perpetual Contracts
 */
export async function getMarkets() {
    return await fetchInfoAPI({ type: "metaAndAssetCtxs" });
}

/**
 * Get current Mark/Oracle prices for a specific symbol (e.g. BTC)
 */
export async function getTicker(symbol: string) {
    const data = await getMarkets();
    
    // data[0] contains universe metadata
    const universe = data[0].universe;
    // data[1] contains assetCtxs array
    const assetCtxs = data[1];

    const coinIndex = universe.findIndex((coin: any) => coin.name === symbol);
    if (coinIndex === -1) {
        throw new Error(`Token ${symbol} completely not found`);
    }

    const ctx = assetCtxs[coinIndex];
    return {
        symbol: symbol,
        markPx: ctx.markPx,
        oraclePx: ctx.oraclePx,
        funding: ctx.funding,
        openInterest: ctx.openInterest
    };
}

/**
 * Get Candle Snapshot (OHLCV)
 * Supported intervals: "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d", "3d", "1w", "1M"
 */
export async function getCandleSnapshot(symbol: string, interval: string, startTime: number, endTime: number) {
    return await fetchInfoAPI({
        type: "candleSnapshot",
        req: {
            coin: symbol,
            interval: interval,
            startTime: startTime,
            endTime: endTime
        }
    });
}

/**
 * Get L2 Orderbook for a specific Token
 */
export async function getL2Book(symbol: string, nSigFigs?: number) {
    const payload: any = { type: "l2Book", coin: symbol };
    if (nSigFigs !== undefined) {
        payload.nSigFigs = nSigFigs;
    }
    return await fetchInfoAPI(payload);
}

// ----------------------------------------------------------------------
// GROUP 3: TRADE EXECUTION (Phantom Agent Signing)
// ----------------------------------------------------------------------

/**
 * Hash an action using msgpack + keccak256 (matches Python SDK action_hash)
 */
function actionHash(action: any, vaultAddress: string | undefined, nonce: number): Uint8Array {
    const msgpackData = encode(action);
    const nonceBytes = new Uint8Array(8);
    const view = new DataView(nonceBytes.buffer);
    view.setBigUint64(0, BigInt(nonce));

    let vaultBytes: Uint8Array;
    if (!vaultAddress) {
        vaultBytes = new Uint8Array([0x00]);
    } else {
        const addrBytes = ethers.getBytes(vaultAddress);
        vaultBytes = new Uint8Array(1 + addrBytes.length);
        vaultBytes[0] = 0x01;
        vaultBytes.set(addrBytes, 1);
    }

    const combined = new Uint8Array(msgpackData.length + nonceBytes.length + vaultBytes.length);
    combined.set(msgpackData, 0);
    combined.set(nonceBytes, msgpackData.length);
    combined.set(vaultBytes, msgpackData.length + nonceBytes.length);

    return ethers.getBytes(ethers.keccak256(combined));
}

/**
 * Sign an L1 action using the Phantom Agent pattern
 * This matches the official Hyperliquid Python SDK sign_l1_action
 */
async function signL1Action(wallet: ethers.Wallet, action: any, nonce: number, vaultAddress?: string) {
    const hash = actionHash(action, vaultAddress, nonce);
    
    const phantomAgent = {
        source: IS_TESTNET ? "b" : "a",
        connectionId: hash,
    };

    const signature = await wallet.signTypedData(
        PHANTOM_AGENT_DOMAIN,
        PHANTOM_AGENT_TYPES,
        phantomAgent
    );
    
    const sig = ethers.Signature.from(signature);
    return {
        r: sig.r,
        s: sig.s,
        v: sig.v
    };
}

/**
 * Place Order
 * @param symbol Examples "BTC"
 * @param isBuy true (Long/Buy) / false (Short/Sell)
 * @param price Order price (Limit) or null if Market (or apply slippage to limit)
 * @param size Order size in base currency
 * @param type "Market", "Limit", "Stop Loss", "Take Profit"
 * @param reduceOnly true/false
 * @param vaultAddress optional, for trading as a vault subaccount
 */
export async function placeOrder(
    symbol: string, 
    isBuy: boolean, 
    price: string, 
    size: string, 
    type: "Market" | "Limit" | "Stop Loss" | "Take Profit" = "Limit",
    reduceOnly: boolean = false,
    vaultAddress?: string,
    privateKey?: string
) {
    const wallet = getSigner(privateKey);
    
    // Get Asset ID from metadata (mapping Symbol to integer ID)
    const meta: any = await getMarkets();
    const universe = meta[0].universe;
    const assetIndex = universe.findIndex((c: any) => c.name === symbol);
    if (assetIndex === -1) throw new Error(`Symbol ${symbol} is not supported`);

    // Build the Type block for the order
    let orderTypeBlock: any = {};
    if (type === "Limit") {
        orderTypeBlock = { limit: { tif: "Gtc" } };
    } else if (type === "Market") {
        // Market order on HL is practically an IOC limit order (with high slippage offset)
        orderTypeBlock = { limit: { tif: "Ioc" } }; 
    } else if (type === "Stop Loss") {
        orderTypeBlock = { trigger: { isMarket: true, triggerPx: price, tpsl: "sl" } };
    } else if (type === "Take Profit") {
        orderTypeBlock = { trigger: { isMarket: true, triggerPx: price, tpsl: "tp" } };
    }

    const action = {
        type: "order",
        orders: [{
            a: assetIndex,
            b: isBuy,
            p: price,
            s: size,
            r: reduceOnly,
            t: orderTypeBlock
        }],
        grouping: "na"
    };

    const nonce = Date.now();
    const effectiveVault = vaultAddress || process.env.HL_VAULT_ADDRESS;
    const signature = await signL1Action(wallet, action, nonce, effectiveVault);
    return await executeExchangeAction(action, nonce, signature, effectiveVault);
}

/**
 * Cancel an Order by its internal Order ID
 * @param symbol e.g., "BTC"
 * @param oid Order ID as string or number
 * @param vaultAddress optional vault address
 */
export async function cancelOrder(symbol: string, oid: number, vaultAddress?: string, privateKey?: string) {
    const wallet = getSigner(privateKey);
    
    // Get Asset ID
    const meta: any = await getMarkets();
    const universe = meta[0].universe;
    const assetIndex = universe.findIndex((c: any) => c.name === symbol);
    if (assetIndex === -1) throw new Error(`Symbol ${symbol} is not supported`);

    const action = {
        type: "cancel",
        cancels: [{
            a: assetIndex,
            o: oid
        }]
    };

    const nonce = Date.now();
    const effectiveVault = vaultAddress || process.env.HL_VAULT_ADDRESS;
    const signature = await signL1Action(wallet, action, nonce, effectiveVault);
    return await executeExchangeAction(action, nonce, signature, effectiveVault);
}

/**
 * Get Margin Account State (Clearinghouse State) including balance and funding rates
 * @param userAddress The target Ethereum address (42 hex characters)
 */
export async function getAccountState(userAddress: string) {
    return await fetchInfoAPI({
        type: "clearinghouseState",
        user: userAddress
    });
}

/**
 * Extract the list of Open Positions for a specific address
 */
export async function getOpenPositions(userAddress: string) {
    const state = await getAccountState(userAddress);
    return state.assetPositions || [];
}

/**
 * List active resting orders
 */
export async function getOpenOrders(userAddress: string) {
    return await fetchInfoAPI({
        type: "openOrders",
        user: userAddress
    });
}

/**
 * Get open orders with additional frontend info (margin, triggerCondition, etc.)
 */
export async function getFrontendOpenOrders(userAddress: string) {
    return await fetchInfoAPI({
        type: "frontendOpenOrders",
        user: userAddress
    });
}

/**
 * Get mid prices for ALL coins
 */
export async function getAllMids() {
    return await fetchInfoAPI({ type: "allMids" });
}

/**
 * Get user fee schedule (maker/taker rates, VIP tier, discounts)
 */
export async function getUserFees(userAddress: string) {
    return await fetchInfoAPI({
        type: "userFees",
        user: userAddress
    });
}

/**
 * Get user's trade fills (last 2000)
 */
export async function getUserFills(userAddress: string, aggregateByTime: boolean = false) {
    return await fetchInfoAPI({
        type: "userFills",
        user: userAddress,
        aggregateByTime
    });
}

/**
 * Get user's trade fills filtered by time range
 */
export async function getUserFillsByTime(userAddress: string, startTime: number, endTime?: number, aggregateByTime: boolean = false) {
    const payload: any = {
        type: "userFillsByTime",
        user: userAddress,
        startTime,
        aggregateByTime
    };
    if (endTime !== undefined) payload.endTime = endTime;
    return await fetchInfoAPI(payload);
}

/**
 * Get user's funding payment history
 */
export async function getUserFunding(userAddress: string, startTime: number, endTime?: number) {
    const payload: any = {
        type: "userFunding",
        user: userAddress,
        startTime
    };
    if (endTime !== undefined) payload.endTime = endTime;
    return await fetchInfoAPI(payload);
}

/**
 * Get user's API rate limit status
 */
export async function getUserRateLimit(userAddress: string) {
    return await fetchInfoAPI({
        type: "userRateLimit",
        user: userAddress
    });
}

/**
 * Get user's referral program info
 */
export async function getReferral(userAddress: string) {
    return await fetchInfoAPI({
        type: "referral",
        user: userAddress
    });
}

/**
 * Check builder fee approval between user and builder
 */
export async function getMaxBuilderFee(userAddress: string, builder: string) {
    return await fetchInfoAPI({
        type: "maxBuilderFee",
        user: userAddress,
        builder
    });
}

/**
 * Get user's historical orders (last 2000)
 */
export async function getHistoricalOrders(userAddress: string) {
    return await fetchInfoAPI({
        type: "historicalOrders",
        user: userAddress
    });
}

/**
 * Get user's subaccounts
 */
export async function getSubAccounts(userAddress: string) {
    return await fetchInfoAPI({
        type: "subAccounts",
        user: userAddress
    });
}

/**
 * Query order status by oid or cloid
 */
export async function getOrderStatus(userAddress: string, oid: number) {
    return await fetchInfoAPI({
        type: "orderStatus",
        user: userAddress,
        oid
    });
}

// ----------------------------------------------------------------------
// GROUP 4: USER-SIGNED ACTIONS (EIP-712 HyperliquidSignTransaction)
// ----------------------------------------------------------------------

const USER_SIGNED_DOMAIN = {
    name: "HyperliquidSignTransaction",
    version: "1",
    chainId: 0x66eee, // 421614
    verifyingContract: "0x0000000000000000000000000000000000000000",
};

/**
 * Sign a user-signed action (approveBuilderFee, etc.)
 * Uses HyperliquidSignTransaction domain (chainId 0x66eee)
 */
async function signUserSignedAction(
    wallet: ethers.Wallet,
    action: any,
    payloadTypes: Array<{ name: string; type: string }>,
    primaryType: string
) {
    action.signatureChainId = "0x66eee";
    action.hyperliquidChain = IS_TESTNET ? "Testnet" : "Mainnet";

    const types: Record<string, Array<{ name: string; type: string }>> = {
        [primaryType]: payloadTypes,
    };

    const signature = await wallet.signTypedData(USER_SIGNED_DOMAIN, types, action);
    const sig = ethers.Signature.from(signature);
    return { r: sig.r, s: sig.s, v: sig.v };
}

// ----------------------------------------------------------------------
// GROUP 5: ADDITIONAL EXCHANGE ACTIONS
// ----------------------------------------------------------------------

/**
 * Set referral code for the account
 * Uses phantom agent signing (vault_address = None per SDK)
 */
export async function setReferrer(code: string, privateKey?: string) {
    const wallet = getSigner(privateKey);
    const action = { type: "setReferrer", code };
    const nonce = Date.now();
    const signature = await signL1Action(wallet, action, nonce, undefined);
    return await executeExchangeAction(action, nonce, signature);
}

/**
 * Approve a builder fee rate for a builder address
 * Uses user-signed EIP-712 (HyperliquidSignTransaction domain)
 */
export async function approveBuilderFee(builder: string, maxFeeRate: string, privateKey?: string) {
    const wallet = getSigner(privateKey);
    const nonce = Date.now();
    const action: any = {
        type: "approveBuilderFee",
        maxFeeRate,
        builder,
        nonce,
    };
    const signature = await signUserSignedAction(
        wallet,
        action,
        [
            { name: "hyperliquidChain", type: "string" },
            { name: "maxFeeRate", type: "string" },
            { name: "builder", type: "address" },
            { name: "nonce", type: "uint64" },
        ],
        "HyperliquidTransaction:ApproveBuilderFee"
    );
    return await executeExchangeAction(action, nonce, signature);
}

/**
 * Update leverage for a specific symbol
 * @param symbol e.g., "BTC"
 * @param leverage integer (1-100)
 * @param isCross true for cross, false for isolated
 */
export async function updateLeverage(symbol: string, leverage: number, isCross: boolean = true, vaultAddress?: string, privateKey?: string) {
    const wallet = getSigner(privateKey);
    const meta: any = await getMarkets();
    const universe = meta[0].universe;
    const assetIndex = universe.findIndex((c: any) => c.name === symbol);
    if (assetIndex === -1) throw new Error(`Symbol ${symbol} is not supported`);

    const action = {
        type: "updateLeverage",
        asset: assetIndex,
        isCross,
        leverage,
    };
    const nonce = Date.now();
    const effectiveVault = vaultAddress || process.env.HL_VAULT_ADDRESS;
    const signature = await signL1Action(wallet, action, nonce, effectiveVault);
    return await executeExchangeAction(action, nonce, signature, effectiveVault);
}

/**
 * Update isolated margin for a position
 * @param symbol e.g., "BTC"
 * @param amount USDC amount to add (positive) or remove (negative)
 */
export async function updateIsolatedMargin(symbol: string, amount: number, vaultAddress?: string, privateKey?: string) {
    const wallet = getSigner(privateKey);
    const meta: any = await getMarkets();
    const universe = meta[0].universe;
    const assetIndex = universe.findIndex((c: any) => c.name === symbol);
    if (assetIndex === -1) throw new Error(`Symbol ${symbol} is not supported`);

    // Convert to usd int (multiply by 1e6 per Hyperliquid convention — raw USD * 1e6)
    const ntli = Math.round(amount * 1e6);

    const action = {
        type: "updateIsolatedMargin",
        asset: assetIndex,
        isBuy: true,
        ntli,
    };
    const nonce = Date.now();
    const effectiveVault = vaultAddress || process.env.HL_VAULT_ADDRESS;
    const signature = await signL1Action(wallet, action, nonce, effectiveVault);
    return await executeExchangeAction(action, nonce, signature, effectiveVault);
}

/**
 * Modify an existing order (change price/size without cancel+replace)
 */
export async function modifyOrder(
    symbol: string,
    oid: number,
    isBuy: boolean,
    price: string,
    size: string,
    type: "Market" | "Limit" | "Stop Loss" | "Take Profit" = "Limit",
    reduceOnly: boolean = false,
    vaultAddress?: string,
    privateKey?: string
) {
    const wallet = getSigner(privateKey);
    const meta: any = await getMarkets();
    const universe = meta[0].universe;
    const assetIndex = universe.findIndex((c: any) => c.name === symbol);
    if (assetIndex === -1) throw new Error(`Symbol ${symbol} is not supported`);

    let orderTypeBlock: any = {};
    if (type === "Limit") orderTypeBlock = { limit: { tif: "Gtc" } };
    else if (type === "Market") orderTypeBlock = { limit: { tif: "Ioc" } };
    else if (type === "Stop Loss") orderTypeBlock = { trigger: { isMarket: true, triggerPx: price, tpsl: "sl" } };
    else if (type === "Take Profit") orderTypeBlock = { trigger: { isMarket: true, triggerPx: price, tpsl: "tp" } };

    const action = {
        type: "batchModify",
        modifies: [{
            oid,
            order: {
                a: assetIndex,
                b: isBuy,
                p: price,
                s: size,
                r: reduceOnly,
                t: orderTypeBlock
            }
        }]
    };

    const nonce = Date.now();
    const effectiveVault = vaultAddress || process.env.HL_VAULT_ADDRESS;
    const signature = await signL1Action(wallet, action, nonce, effectiveVault);
    return await executeExchangeAction(action, nonce, signature, effectiveVault);
}

/**
 * Cancel ALL open orders for the signer's address (emergency kill switch)
 */
export async function cancelAllOrders(vaultAddress?: string, privateKey?: string) {
    const wallet = getSigner(privateKey);
    const userAddress = wallet.address;
    const orders: any[] = await getOpenOrders(userAddress);
    if (orders.length === 0) return { status: "ok", message: "No open orders to cancel" };

    const meta: any = await getMarkets();
    const universe = meta[0].universe;

    const cancels = orders.map((o: any) => {
        const assetIndex = universe.findIndex((c: any) => c.name === o.coin);
        return { a: assetIndex, o: o.oid };
    });

    const action = { type: "cancel", cancels };
    const nonce = Date.now();
    const effectiveVault = vaultAddress || process.env.HL_VAULT_ADDRESS;
    const signature = await signL1Action(wallet, action, nonce, effectiveVault);
    return await executeExchangeAction(action, nonce, signature, effectiveVault);
}

/**
 * Schedule cancel (dead man's switch)
 * @param time UTC timestamp in ms to cancel all orders. null to unset.
 */
export async function scheduleCancel(time: number | null, vaultAddress?: string, privateKey?: string) {
    const wallet = getSigner(privateKey);
    const action: any = { type: "scheduleCancel" };
    if (time !== null) action.time = time;
    const nonce = Date.now();
    const effectiveVault = vaultAddress || process.env.HL_VAULT_ADDRESS;
    const signature = await signL1Action(wallet, action, nonce, effectiveVault);
    return await executeExchangeAction(action, nonce, signature, effectiveVault);
}

/**
 * Place a TWAP order
 * @param symbol e.g. "BTC"
 * @param isBuy true/false
 * @param size total size
 * @param reduceOnly
 * @param minutes duration in minutes
 * @param randomize whether to randomize execution
 */
export async function twapOrder(
    symbol: string,
    isBuy: boolean,
    size: string,
    reduceOnly: boolean,
    minutes: number,
    randomize: boolean = true,
    vaultAddress?: string,
    privateKey?: string
) {
    const wallet = getSigner(privateKey);
    const meta: any = await getMarkets();
    const universe = meta[0].universe;
    const assetIndex = universe.findIndex((c: any) => c.name === symbol);
    if (assetIndex === -1) throw new Error(`Symbol ${symbol} is not supported`);

    const action = {
        type: "twapOrder",
        twap: {
            a: assetIndex,
            b: isBuy,
            s: size,
            r: reduceOnly,
            m: minutes,
            t: randomize,
        }
    };

    const nonce = Date.now();
    const effectiveVault = vaultAddress || process.env.HL_VAULT_ADDRESS;
    const signature = await signL1Action(wallet, action, nonce, effectiveVault);
    return await executeExchangeAction(action, nonce, signature, effectiveVault);
}

/**
 * Cancel a TWAP order
 */
export async function cancelTwapOrder(symbol: string, twapId: number, vaultAddress?: string, privateKey?: string) {
    const wallet = getSigner(privateKey);
    const meta: any = await getMarkets();
    const universe = meta[0].universe;
    const assetIndex = universe.findIndex((c: any) => c.name === symbol);
    if (assetIndex === -1) throw new Error(`Symbol ${symbol} is not supported`);

    const action = {
        type: "twapCancel",
        a: assetIndex,
        t: twapId,
    };
    const nonce = Date.now();
    const effectiveVault = vaultAddress || process.env.HL_VAULT_ADDRESS;
    const signature = await signL1Action(wallet, action, nonce, effectiveVault);
    return await executeExchangeAction(action, nonce, signature, effectiveVault);
}

/**
 * Create a subaccount
 */
export async function createSubAccount(name: string, privateKey?: string) {
    const wallet = getSigner(privateKey);
    const action = { type: "createSubAccount", name };
    const nonce = Date.now();
    const signature = await signL1Action(wallet, action, nonce, undefined);
    return await executeExchangeAction(action, nonce, signature);
}

// ----------------------------------------------------------------------
// GROUP 6: COMPUTED ANALYTICS TOOLS (local computation)
// ----------------------------------------------------------------------

/**
 * Portfolio summary: account equity, PnL, margin usage, positions overview
 */
export async function getPortfolioSummary(userAddress: string) {
    const state: any = await getAccountState(userAddress);
    const positions = (state.assetPositions || []).filter(
        (p: any) => parseFloat(p.position?.szi) !== 0
    );

    const margin = state.marginSummary || state.crossMarginSummary;
    const accountValue = parseFloat(margin?.accountValue || "0");
    const totalMarginUsed = parseFloat(margin?.totalMarginUsed || "0");
    const totalNtlPos = parseFloat(margin?.totalNtlPos || "0");
    const withdrawable = parseFloat(state.withdrawable || "0");

    let totalUnrealizedPnl = 0;
    const positionSummaries = positions.map((p: any) => {
        const pos = p.position;
        const unrealizedPnl = parseFloat(pos.unrealizedPnl || "0");
        totalUnrealizedPnl += unrealizedPnl;
        return {
            coin: pos.coin,
            size: pos.szi,
            entryPx: pos.entryPx,
            markPx: pos.positionValue ? (Math.abs(parseFloat(pos.positionValue)) / Math.abs(parseFloat(pos.szi))).toFixed(2) : "N/A",
            unrealizedPnl: unrealizedPnl.toFixed(2),
            leverage: pos.leverage?.value || "N/A",
            marginType: pos.leverage?.type || "N/A",
            liquidationPx: pos.liquidationPx || "N/A",
        };
    });

    return {
        accountValue: accountValue.toFixed(2),
        totalMarginUsed: totalMarginUsed.toFixed(2),
        availableBalance: withdrawable.toFixed(2),
        totalNotionalPosition: totalNtlPos.toFixed(2),
        totalUnrealizedPnl: totalUnrealizedPnl.toFixed(2),
        marginUtilization: totalMarginUsed > 0 ? ((totalMarginUsed / accountValue) * 100).toFixed(1) + "%" : "0%",
        openPositionCount: positions.length,
        positions: positionSummaries,
    };
}

/**
 * Calculate optimal position size based on risk management
 * @param accountEquity total account value in USDC
 * @param riskPercent max risk per trade as percentage (e.g. 1 = 1%)
 * @param entryPrice planned entry price
 * @param stopLossPrice planned stop loss price
 * @returns position size and risk metrics
 */
export function calculatePositionSize(
    accountEquity: number,
    riskPercent: number,
    entryPrice: number,
    stopLossPrice: number
) {
    const riskAmount = accountEquity * (riskPercent / 100);
    const priceDiff = Math.abs(entryPrice - stopLossPrice);
    const riskPerUnit = priceDiff;
    const positionSize = riskPerUnit > 0 ? riskAmount / riskPerUnit : 0;
    const notionalValue = positionSize * entryPrice;
    const effectiveLeverage = accountEquity > 0 ? notionalValue / accountEquity : 0;

    return {
        positionSize: positionSize.toFixed(6),
        notionalValue: notionalValue.toFixed(2),
        riskAmount: riskAmount.toFixed(2),
        riskRewardInfo: {
            stopLossDistance: priceDiff.toFixed(2),
            stopLossPercent: ((priceDiff / entryPrice) * 100).toFixed(2) + "%",
        },
        effectiveLeverage: effectiveLeverage.toFixed(1) + "x",
        maxLoss: riskAmount.toFixed(2),
    };
}

/**
 * Trade statistics computed from fill history
 */
export async function getTradeStats(userAddress: string, startTime?: number) {
    const st = startTime || Date.now() - 30 * 86400000; // default 30 days
    const fills: any[] = await getUserFillsByTime(userAddress, st, undefined, true);
    if (fills.length === 0) return { message: "No fills in the specified period", totalTrades: 0 };

    let totalPnl = 0, totalFees = 0;
    let wins = 0, losses = 0;
    let totalWinPnl = 0, totalLossPnl = 0;
    let totalVolume = 0;

    for (const fill of fills) {
        const pnl = parseFloat(fill.closedPnl || "0");
        const fee = parseFloat(fill.fee || "0");
        const notional = parseFloat(fill.px || "0") * parseFloat(fill.sz || "0");
        totalPnl += pnl;
        totalFees += fee;
        totalVolume += notional;
        if (pnl > 0) { wins++; totalWinPnl += pnl; }
        else if (pnl < 0) { losses++; totalLossPnl += Math.abs(pnl); }
    }

    const winRate = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;
    const avgWin = wins > 0 ? totalWinPnl / wins : 0;
    const avgLoss = losses > 0 ? totalLossPnl / losses : 0;
    const profitFactor = totalLossPnl > 0 ? totalWinPnl / totalLossPnl : totalWinPnl > 0 ? Infinity : 0;

    return {
        period: { startTime: new Date(st).toISOString(), endTime: new Date().toISOString() },
        totalTrades: fills.length,
        wins,
        losses,
        winRate: winRate.toFixed(1) + "%",
        totalPnl: totalPnl.toFixed(2),
        totalFees: totalFees.toFixed(2),
        netPnl: (totalPnl - totalFees).toFixed(2),
        avgWin: avgWin.toFixed(2),
        avgLoss: avgLoss.toFixed(2),
        profitFactor: profitFactor === Infinity ? "∞" : profitFactor.toFixed(2),
        totalVolume: totalVolume.toFixed(2),
    };
}

/**
 * Fee analysis from fill history
 */
export async function getFeeAnalysis(userAddress: string, startTime?: number) {
    const st = startTime || Date.now() - 30 * 86400000;
    const fills: any[] = await getUserFillsByTime(userAddress, st, undefined, false);
    if (fills.length === 0) return { message: "No fills", totalFees: "0" };

    let makerFees = 0, takerFees = 0, totalFees = 0;
    let makerCount = 0, takerCount = 0;
    let totalVolume = 0;
    const byCoin: Record<string, number> = {};

    for (const fill of fills) {
        const fee = parseFloat(fill.fee || "0");
        const notional = parseFloat(fill.px || "0") * parseFloat(fill.sz || "0");
        totalFees += fee;
        totalVolume += notional;

        if (fill.liquidation) continue;
        // Negative fee = rebate (maker), positive = taker
        if (fee < 0) { makerFees += fee; makerCount++; }
        else { takerFees += fee; takerCount++; }

        const coin = fill.coin || "unknown";
        byCoin[coin] = (byCoin[coin] || 0) + fee;
    }

    return {
        period: { startTime: new Date(st).toISOString() },
        totalFees: totalFees.toFixed(4),
        makerFees: makerFees.toFixed(4),
        takerFees: takerFees.toFixed(4),
        makerRebate: (makerFees < 0 ? Math.abs(makerFees) : 0).toFixed(4),
        makerCount,
        takerCount,
        totalVolume: totalVolume.toFixed(2),
        effectiveFeeRate: totalVolume > 0 ? ((totalFees / totalVolume) * 100).toFixed(4) + "%" : "0%",
        byCoin,
    };
}

// ----------------------------------------------------------------------
// GROUP 7: RISK MANAGEMENT TOOLS (computed from HL data)
// ----------------------------------------------------------------------

/**
 * Real-time risk dashboard combining equity, positions, liquidation distances,
 * margin utilization, and daily PnL into a single risk overview.
 */
export async function getRiskDashboard(userAddress: string) {
    const state: any = await getAccountState(userAddress);
    const positions = (state.assetPositions || []).filter(
        (p: any) => parseFloat(p.position?.szi) !== 0
    );

    const margin = state.marginSummary || state.crossMarginSummary;
    const accountValue = parseFloat(margin?.accountValue || "0");
    const totalMarginUsed = parseFloat(margin?.totalMarginUsed || "0");
    const totalNtlPos = parseFloat(margin?.totalNtlPos || "0");

    let totalUnrealizedPnl = 0;
    let nearestLiqPercent = Infinity;
    let nearestLiqCoin = "";

    const positionRisks = positions.map((p: any) => {
        const pos = p.position;
        const size = parseFloat(pos.szi || "0");
        const entryPx = parseFloat(pos.entryPx || "0");
        const posValue = Math.abs(parseFloat(pos.positionValue || "0"));
        const markPx = size !== 0 ? posValue / Math.abs(size) : 0;
        const liqPx = parseFloat(pos.liquidationPx || "0");
        const unrealizedPnl = parseFloat(pos.unrealizedPnl || "0");
        totalUnrealizedPnl += unrealizedPnl;

        const liqDistance = liqPx > 0 && markPx > 0
            ? Math.abs((markPx - liqPx) / markPx * 100)
            : null;

        if (liqDistance !== null && liqDistance < nearestLiqPercent) {
            nearestLiqPercent = liqDistance;
            nearestLiqCoin = pos.coin;
        }

        return {
            coin: pos.coin,
            side: size > 0 ? "LONG" : "SHORT",
            size: Math.abs(size).toString(),
            notional: posValue.toFixed(2),
            entryPx: entryPx.toFixed(2),
            markPx: markPx.toFixed(2),
            unrealizedPnl: unrealizedPnl.toFixed(2),
            liquidationPx: liqPx > 0 ? liqPx.toFixed(2) : "N/A",
            liquidationDistance: liqDistance !== null ? liqDistance.toFixed(1) + "%" : "N/A",
            leverage: pos.leverage?.value || "N/A",
        };
    });

    const marginUtil = accountValue > 0 ? (totalMarginUsed / accountValue * 100) : 0;
    const leverageRatio = accountValue > 0 ? totalNtlPos / accountValue : 0;

    let riskLevel: string;
    if (marginUtil > 80 || nearestLiqPercent < 5) riskLevel = "CRITICAL";
    else if (marginUtil > 60 || nearestLiqPercent < 10) riskLevel = "HIGH";
    else if (marginUtil > 40 || nearestLiqPercent < 20) riskLevel = "MEDIUM";
    else riskLevel = "LOW";

    return {
        riskLevel,
        accountValue: accountValue.toFixed(2),
        totalMarginUsed: totalMarginUsed.toFixed(2),
        marginUtilization: marginUtil.toFixed(1) + "%",
        totalNotional: totalNtlPos.toFixed(2),
        leverageRatio: leverageRatio.toFixed(1) + "x",
        unrealizedPnl: totalUnrealizedPnl.toFixed(2),
        nearestLiquidation: nearestLiqPercent < Infinity
            ? { coin: nearestLiqCoin, distance: nearestLiqPercent.toFixed(1) + "%" }
            : null,
        openPositionCount: positions.length,
        positions: positionRisks,
    };
}

/**
 * Pre-trade risk check: validates a proposed trade against current portfolio state.
 * Returns risk assessment with pass/fail verdict.
 */
export async function checkTradeRisk(
    userAddress: string,
    symbol: string,
    size: number,
    leverage: number,
    isBuy: boolean,
    stopLossPrice?: number
) {
    const state: any = await getAccountState(userAddress);
    const margin = state.marginSummary || state.crossMarginSummary;
    const accountValue = parseFloat(margin?.accountValue || "0");
    const totalMarginUsed = parseFloat(margin?.totalMarginUsed || "0");
    const withdrawable = parseFloat(state.withdrawable || "0");

    const positions = (state.assetPositions || []).filter(
        (p: any) => parseFloat(p.position?.szi) !== 0
    );

    // Get current price
    const ticker: any = await getTicker(symbol);
    const markPrice = parseFloat(ticker.markPx || "0");
    const notionalValue = size * markPrice;
    const marginRequired = notionalValue / leverage;
    const marginAfterTrade = totalMarginUsed + marginRequired;
    const marginUtilAfterTrade = accountValue > 0 ? (marginAfterTrade / accountValue * 100) : 100;

    // Check existing exposure to same coin
    const existingPosition = positions.find((p: any) => p.position?.coin === symbol);
    const existingSize = existingPosition ? parseFloat(existingPosition.position.szi) : 0;
    const sameDirection = (existingSize > 0 && isBuy) || (existingSize < 0 && !isBuy);

    // Calculate max loss
    let maxLossPercent: number | null = null;
    if (stopLossPrice && markPrice > 0) {
        const lossPerUnit = Math.abs(markPrice - stopLossPrice);
        const maxLoss = lossPerUnit * size;
        maxLossPercent = accountValue > 0 ? (maxLoss / accountValue * 100) : 100;
    }

    // Estimated liquidation price
    const liqDistance = 1 / leverage;
    const estLiqPrice = isBuy
        ? markPrice * (1 - liqDistance * 0.9)
        : markPrice * (1 + liqDistance * 0.9);

    // Build warnings
    const warnings: string[] = [];
    if (marginUtilAfterTrade > 80) warnings.push("Margin utilization will exceed 80%");
    if (marginRequired > withdrawable) warnings.push("Insufficient available margin");
    if (leverage > 20) warnings.push("High leverage (>20x)");
    if (maxLossPercent !== null && maxLossPercent > 5) warnings.push(`Max loss ${maxLossPercent.toFixed(1)}% exceeds 5% rule`);
    if (sameDirection && existingSize !== 0) warnings.push(`Adding to existing ${existingSize > 0 ? "LONG" : "SHORT"} position`);
    if (notionalValue > accountValue * 2) warnings.push("Notional exceeds 2x account value");

    const verdict = warnings.length === 0 ? "PASS" : warnings.length <= 2 ? "CAUTION" : "REJECT";

    return {
        verdict,
        symbol,
        side: isBuy ? "LONG" : "SHORT",
        size: size.toString(),
        leverage: leverage + "x",
        markPrice: markPrice.toFixed(2),
        notionalValue: notionalValue.toFixed(2),
        marginRequired: marginRequired.toFixed(2),
        availableMargin: withdrawable.toFixed(2),
        marginUtilAfterTrade: marginUtilAfterTrade.toFixed(1) + "%",
        estimatedLiqPrice: estLiqPrice.toFixed(2),
        liqDistance: (liqDistance * 90).toFixed(1) + "%",
        maxLossPercent: maxLossPercent !== null ? maxLossPercent.toFixed(1) + "%" : "N/A (no SL)",
        existingPosition: existingSize !== 0 ? { size: existingSize.toString(), side: existingSize > 0 ? "LONG" : "SHORT" } : null,
        warnings,
    };
}

/**
 * Drawdown status computed from trade fill history.
 * Tracks current drawdown, max drawdown, and recovery target.
 */
export async function getDrawdownStatus(userAddress: string, days: number = 30) {
    const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
    const fills: any[] = await getUserFillsByTime(userAddress, startTime);
    const state: any = await getAccountState(userAddress);
    const margin = state.marginSummary || state.crossMarginSummary;
    const currentEquity = parseFloat(margin?.accountValue || "0");

    if (fills.length === 0) {
        return {
            currentEquity: currentEquity.toFixed(2),
            periodDays: days,
            totalTrades: 0,
            totalPnl: "0.00",
            maxDrawdown: "0%",
            currentDrawdown: "0%",
            peakEquity: currentEquity.toFixed(2),
            troughEquity: currentEquity.toFixed(2),
            recoveryTarget: "N/A",
            consecutiveLosses: 0,
        };
    }

    // Compute cumulative PnL curve
    let cumulativePnl = 0;
    let peakPnl = 0;
    let maxDrawdown = 0;
    let consecutiveLosses = 0;
    let currentStreak = 0;
    let lastPnlSign = 0;

    // Group fills by closedPnl
    const filledPnls: number[] = [];
    for (const fill of fills) {
        const pnl = parseFloat(fill.closedPnl || "0");
        if (pnl !== 0) filledPnls.push(pnl);
    }

    for (const pnl of filledPnls) {
        cumulativePnl += pnl;
        if (cumulativePnl > peakPnl) peakPnl = cumulativePnl;
        const dd = peakPnl > 0 ? ((peakPnl - cumulativePnl) / peakPnl * 100) : 0;
        if (dd > maxDrawdown) maxDrawdown = dd;

        if (pnl < 0) {
            if (lastPnlSign <= 0) currentStreak++;
            else currentStreak = 1;
            lastPnlSign = -1;
        } else {
            if (lastPnlSign > 0) currentStreak++;
            else currentStreak = 1;
            lastPnlSign = 1;
        }
        if (lastPnlSign < 0 && currentStreak > consecutiveLosses) {
            consecutiveLosses = currentStreak;
        }
    }

    const peakEquity = currentEquity + (peakPnl - cumulativePnl);
    const currentDrawdown = peakEquity > 0 ? ((peakEquity - currentEquity) / peakEquity * 100) : 0;

    return {
        currentEquity: currentEquity.toFixed(2),
        periodDays: days,
        totalTrades: filledPnls.length,
        totalPnl: cumulativePnl.toFixed(2),
        maxDrawdown: maxDrawdown.toFixed(1) + "%",
        currentDrawdown: currentDrawdown.toFixed(1) + "%",
        peakEquity: peakEquity.toFixed(2),
        recoveryTarget: currentDrawdown > 0 ? peakEquity.toFixed(2) : "N/A (at peak)",
        recoveryNeeded: currentDrawdown > 0 ? ((peakEquity / currentEquity - 1) * 100).toFixed(1) + "%" : "0%",
        consecutiveLosses,
    };
}

/**
 * Exposure analysis: breakdown by direction, asset, and concentration metrics.
 */
export async function getExposureAnalysis(userAddress: string) {
    const state: any = await getAccountState(userAddress);
    const positions = (state.assetPositions || []).filter(
        (p: any) => parseFloat(p.position?.szi) !== 0
    );

    const margin = state.marginSummary || state.crossMarginSummary;
    const accountValue = parseFloat(margin?.accountValue || "0");

    if (positions.length === 0) {
        return {
            accountValue: accountValue.toFixed(2),
            positionCount: 0,
            grossExposure: "0.00",
            netExposure: "0.00",
            longExposure: "0.00",
            shortExposure: "0.00",
            directionalBias: "NEUTRAL",
            concentrationRisk: "NONE",
            byAsset: [],
        };
    }

    let longNotional = 0;
    let shortNotional = 0;
    const assetExposures: Array<{ coin: string; side: string; notional: number; pctOfEquity: number }> = [];

    for (const p of positions) {
        const pos = p.position;
        const size = parseFloat(pos.szi || "0");
        const posValue = Math.abs(parseFloat(pos.positionValue || "0"));

        if (size > 0) longNotional += posValue;
        else shortNotional += posValue;

        assetExposures.push({
            coin: pos.coin,
            side: size > 0 ? "LONG" : "SHORT",
            notional: posValue,
            pctOfEquity: accountValue > 0 ? (posValue / accountValue * 100) : 0,
        });
    }

    const grossExposure = longNotional + shortNotional;
    const netExposure = longNotional - shortNotional;
    const longPct = grossExposure > 0 ? (longNotional / grossExposure * 100) : 0;

    let directionalBias: string;
    if (longPct > 70) directionalBias = "STRONGLY_LONG";
    else if (longPct > 55) directionalBias = "LONG_BIASED";
    else if (longPct < 30) directionalBias = "STRONGLY_SHORT";
    else if (longPct < 45) directionalBias = "SHORT_BIASED";
    else directionalBias = "BALANCED";

    // Concentration: largest position as % of gross
    const sorted = assetExposures.sort((a, b) => b.notional - a.notional);
    const largestPct = grossExposure > 0 && sorted[0] ? (sorted[0].notional / grossExposure * 100) : 0;

    let concentrationRisk: string;
    if (largestPct > 80) concentrationRisk = "CRITICAL";
    else if (largestPct > 60) concentrationRisk = "HIGH";
    else if (largestPct > 40) concentrationRisk = "MEDIUM";
    else concentrationRisk = "LOW";

    return {
        accountValue: accountValue.toFixed(2),
        positionCount: positions.length,
        grossExposure: grossExposure.toFixed(2),
        netExposure: netExposure.toFixed(2),
        longExposure: longNotional.toFixed(2),
        shortExposure: shortNotional.toFixed(2),
        longPercent: longPct.toFixed(1) + "%",
        shortPercent: (100 - longPct).toFixed(1) + "%",
        directionalBias,
        grossLeverage: accountValue > 0 ? (grossExposure / accountValue).toFixed(1) + "x" : "0x",
        concentrationRisk,
        largestPosition: sorted[0] ? { coin: sorted[0].coin, pctOfGross: largestPct.toFixed(1) + "%" } : null,
        byAsset: sorted.map(a => ({
            coin: a.coin,
            side: a.side,
            notional: a.notional.toFixed(2),
            pctOfEquity: a.pctOfEquity.toFixed(1) + "%",
        })),
    };
}

/**
 * Funding rate impact analysis for open positions.
 * Projects daily/monthly funding costs based on current rates.
 */
export async function getFundingImpact(userAddress: string) {
    const state: any = await getAccountState(userAddress);
    const positions = (state.assetPositions || []).filter(
        (p: any) => parseFloat(p.position?.szi) !== 0
    );

    const margin = state.marginSummary || state.crossMarginSummary;
    const accountValue = parseFloat(margin?.accountValue || "0");

    if (positions.length === 0) {
        return {
            accountValue: accountValue.toFixed(2),
            positionCount: 0,
            dailyFundingCost: "0.00",
            monthlyProjection: "0.00",
            annualProjection: "0.00",
            annualImpactPercent: "0%",
            byPosition: [],
        };
    }

    // Funding is received every 8 hours, 3x per day
    let totalDailyFunding = 0;
    const positionFunding: Array<{ coin: string; side: string; notional: string; fundingRate: string; daily: string; monthly: string }> = [];

    for (const p of positions) {
        const pos = p.position;
        const size = parseFloat(pos.szi || "0");
        const posValue = Math.abs(parseFloat(pos.positionValue || "0"));
        const fundingRate = parseFloat(pos.cumFunding?.sinceOpen || "0") !== 0
            ? parseFloat(pos.cumFunding?.sinceChange || "0")
            : 0;

        // Use position's current funding per 8h
        // Funding = position_notional * funding_rate per period, 3 times a day
        // For simplicity, use the last known rate
        const dailyCost = posValue * Math.abs(fundingRate) * 3;
        const isPayingFunding = (size > 0 && fundingRate > 0) || (size < 0 && fundingRate < 0);
        const signedDailyCost = isPayingFunding ? -dailyCost : dailyCost;

        totalDailyFunding += signedDailyCost;

        positionFunding.push({
            coin: pos.coin,
            side: size > 0 ? "LONG" : "SHORT",
            notional: posValue.toFixed(2),
            fundingRate: (fundingRate * 100).toFixed(4) + "%",
            daily: signedDailyCost.toFixed(2),
            monthly: (signedDailyCost * 30).toFixed(2),
        });
    }

    const monthly = totalDailyFunding * 30;
    const annual = totalDailyFunding * 365;

    return {
        accountValue: accountValue.toFixed(2),
        positionCount: positions.length,
        dailyFundingCost: totalDailyFunding.toFixed(2),
        monthlyProjection: monthly.toFixed(2),
        annualProjection: annual.toFixed(2),
        annualImpactPercent: accountValue > 0 ? (annual / accountValue * 100).toFixed(2) + "%" : "0%",
        byPosition: positionFunding,
    };
}

// ----------------------------------------------------------------------
// GROUP 8: ADVANCED ANALYTICS TOOLS (computed from HL data)
// ----------------------------------------------------------------------

/**
 * Performance attribution: PnL breakdown by coin with win rate, avg PnL,
 * best/worst trades, and estimated Sharpe ratio.
 */
export async function getPerformanceAttribution(userAddress: string, days: number = 30) {
    const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
    const fills: any[] = await getUserFillsByTime(userAddress, startTime);

    if (fills.length === 0) {
        return { periodDays: days, totalTrades: 0, totalPnl: "0.00", byCoin: [], bestTrade: null, worstTrade: null, sharpeEstimate: "N/A" };
    }

    // Group by coin
    const coinMap: Record<string, { pnls: number[]; trades: number }> = {};
    let bestTrade = { coin: "", pnl: -Infinity, time: "" };
    let worstTrade = { coin: "", pnl: Infinity, time: "" };
    const allPnls: number[] = [];

    for (const fill of fills) {
        const pnl = parseFloat(fill.closedPnl || "0");
        if (pnl === 0) continue;
        const coin = fill.coin || "UNKNOWN";
        if (!coinMap[coin]) coinMap[coin] = { pnls: [], trades: 0 };
        coinMap[coin].pnls.push(pnl);
        coinMap[coin].trades++;
        allPnls.push(pnl);

        if (pnl > bestTrade.pnl) bestTrade = { coin, pnl, time: fill.time };
        if (pnl < worstTrade.pnl) worstTrade = { coin, pnl, time: fill.time };
    }

    const totalPnl = allPnls.reduce((s, p) => s + p, 0);
    const byCoin = Object.entries(coinMap)
        .map(([coin, data]) => {
            const total = data.pnls.reduce((s, p) => s + p, 0);
            const wins = data.pnls.filter(p => p > 0).length;
            return {
                coin,
                trades: data.trades,
                totalPnl: total.toFixed(2),
                winRate: (wins / data.trades * 100).toFixed(1) + "%",
                avgPnl: (total / data.trades).toFixed(2),
            };
        })
        .sort((a, b) => parseFloat(b.totalPnl) - parseFloat(a.totalPnl));

    // Sharpe estimate: mean(daily returns) / std(daily returns)
    const mean = allPnls.length > 0 ? totalPnl / allPnls.length : 0;
    const variance = allPnls.length > 1
        ? allPnls.reduce((s, p) => s + (p - mean) ** 2, 0) / (allPnls.length - 1)
        : 0;
    const std = Math.sqrt(variance);
    const sharpe = std > 0 ? (mean / std * Math.sqrt(252)).toFixed(2) : "N/A";

    return {
        periodDays: days,
        totalTrades: allPnls.length,
        totalPnl: totalPnl.toFixed(2),
        byCoin,
        bestTrade: bestTrade.pnl > -Infinity ? { coin: bestTrade.coin, pnl: bestTrade.pnl.toFixed(2), time: bestTrade.time } : null,
        worstTrade: worstTrade.pnl < Infinity ? { coin: worstTrade.coin, pnl: worstTrade.pnl.toFixed(2), time: worstTrade.time } : null,
        sharpeEstimate: sharpe,
    };
}

/**
 * Win/loss streak analysis with expectancy and profit factor.
 */
export async function getStreakAnalysis(userAddress: string, days: number = 30) {
    const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
    const fills: any[] = await getUserFillsByTime(userAddress, startTime);

    const pnls: number[] = [];
    for (const fill of fills) {
        const pnl = parseFloat(fill.closedPnl || "0");
        if (pnl !== 0) pnls.push(pnl);
    }

    if (pnls.length === 0) {
        return { periodDays: days, totalTrades: 0, currentStreak: { type: "NONE", length: 0 }, longestWin: 0, longestLoss: 0, profitFactor: "N/A", expectancy: "0.00", avgWin: "0.00", avgLoss: "0.00", riskRewardRatio: "N/A" };
    }

    let longestWin = 0, longestLoss = 0;
    let currentWin = 0, currentLoss = 0;
    let grossProfit = 0, grossLoss = 0;
    let winCount = 0, lossCount = 0;

    for (const pnl of pnls) {
        if (pnl > 0) {
            grossProfit += pnl;
            winCount++;
            currentWin++;
            currentLoss = 0;
            if (currentWin > longestWin) longestWin = currentWin;
        } else {
            grossLoss += Math.abs(pnl);
            lossCount++;
            currentLoss++;
            currentWin = 0;
            if (currentLoss > longestLoss) longestLoss = currentLoss;
        }
    }

    const avgWin = winCount > 0 ? grossProfit / winCount : 0;
    const avgLoss = lossCount > 0 ? grossLoss / lossCount : 0;
    const winRate = pnls.length > 0 ? winCount / pnls.length : 0;
    const expectancy = avgWin * winRate - avgLoss * (1 - winRate);

    return {
        periodDays: days,
        totalTrades: pnls.length,
        wins: winCount,
        losses: lossCount,
        winRate: (winRate * 100).toFixed(1) + "%",
        currentStreak: currentWin > 0
            ? { type: "WIN", length: currentWin }
            : { type: "LOSS", length: currentLoss },
        longestWinStreak: longestWin,
        longestLossStreak: longestLoss,
        grossProfit: grossProfit.toFixed(2),
        grossLoss: grossLoss.toFixed(2),
        profitFactor: grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : "∞",
        expectancy: expectancy.toFixed(2),
        avgWin: avgWin.toFixed(2),
        avgLoss: avgLoss.toFixed(2),
        riskRewardRatio: avgLoss > 0 ? "1:" + (avgWin / avgLoss).toFixed(2) : "N/A",
    };
}

/**
 * Time-based performance: by session (Asia/Europe/US), day of week, and hour.
 */
export async function getTimeAnalysis(userAddress: string, days: number = 30) {
    const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
    const fills: any[] = await getUserFillsByTime(userAddress, startTime);

    const sessions: Record<string, { pnl: number; trades: number }> = {
        "Asia (02-10 UTC)": { pnl: 0, trades: 0 },
        "Europe (10-16 UTC)": { pnl: 0, trades: 0 },
        "US (16-02 UTC)": { pnl: 0, trades: 0 },
    };
    const days_of_week: Record<string, { pnl: number; trades: number }> = {};
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    for (const d of dayNames) days_of_week[d] = { pnl: 0, trades: 0 };

    const hours: Record<number, { pnl: number; trades: number }> = {};
    for (let h = 0; h < 24; h++) hours[h] = { pnl: 0, trades: 0 };

    let totalTrades = 0;

    for (const fill of fills) {
        const pnl = parseFloat(fill.closedPnl || "0");
        if (pnl === 0) continue;
        totalTrades++;

        const dt = new Date(fill.time);
        const hour = dt.getUTCHours();
        const dayName = dayNames[dt.getUTCDay()];

        // Session
        let sessionKey: string;
        if (hour >= 2 && hour < 10) sessionKey = "Asia (02-10 UTC)";
        else if (hour >= 10 && hour < 16) sessionKey = "Europe (10-16 UTC)";
        else sessionKey = "US (16-02 UTC)";

        sessions[sessionKey]!.pnl += pnl;
        sessions[sessionKey]!.trades++;
        days_of_week[dayName!]!.pnl += pnl;
        days_of_week[dayName!]!.trades++;
        hours[hour]!.pnl += pnl;
        hours[hour]!.trades++;
    }

    const sessionResults = Object.entries(sessions).map(([name, data]) => ({
        session: name, pnl: data.pnl.toFixed(2), trades: data.trades,
    }));

    const dayResults = Object.entries(days_of_week)
        .filter(([, data]) => data.trades > 0)
        .map(([day, data]) => ({ day, pnl: data.pnl.toFixed(2), trades: data.trades }));

    const bestHour = Object.entries(hours).reduce((best, [h, data]) =>
        data.pnl > best.pnl ? { hour: parseInt(h), pnl: data.pnl, trades: data.trades } : best,
        { hour: 0, pnl: -Infinity, trades: 0 }
    );
    const mostActiveHour = Object.entries(hours).reduce((best, [h, data]) =>
        data.trades > best.trades ? { hour: parseInt(h), pnl: data.pnl, trades: data.trades } : best,
        { hour: 0, pnl: 0, trades: 0 }
    );

    return {
        periodDays: days,
        totalTrades,
        bySessions: sessionResults,
        byDay: dayResults,
        bestHourUTC: { hour: bestHour.hour + ":00", pnl: bestHour.pnl.toFixed(2), trades: bestHour.trades },
        mostActiveHourUTC: { hour: mostActiveHour.hour + ":00", trades: mostActiveHour.trades },
    };
}

/**
 * Volatility scanner: find top movers from all HL perpetuals using candle data.
 */
export async function getVolatilityScanner(limit: number = 10) {
    const mids: Record<string, string> = await getAllMids();
    const endTime = Date.now();
    const startTime24h = endTime - 24 * 60 * 60 * 1000;

    // Get candle data for top coins (by name) to calculate 24h change
    const coinNames = Object.keys(mids).filter(c => c !== "@0" && c !== "@1" && !c.startsWith("@"));
    const results: Array<{ coin: string; price: number; change24h: number; absChange: number }> = [];

    // Fetch candles for each coin — use 1h candles for 24h window
    const batchSize = 10;
    for (let i = 0; i < Math.min(coinNames.length, 50); i += batchSize) {
        const batch = coinNames.slice(i, i + batchSize);
        const promises = batch.map(async (coin) => {
            try {
                const candles: any[] = await getCandleSnapshot(coin, "1h", startTime24h, endTime);
                if (candles.length >= 2) {
                    const openPrice = parseFloat(candles[0].o);
                    const currentPrice = parseFloat(mids[coin] || "0");
                    const change = ((currentPrice - openPrice) / openPrice) * 100;
                    return { coin, price: currentPrice, change24h: change, absChange: Math.abs(change) };
                }
            } catch { /* skip coin */ }
            return null;
        });
        const batchResults = await Promise.all(promises);
        for (const r of batchResults) {
            if (r) results.push(r);
        }
    }

    const sorted = results.sort((a, b) => b.absChange - a.absChange);
    const topMovers = sorted.slice(0, limit).map(r => ({
        coin: r.coin,
        price: r.price.toFixed(4),
        change24h: r.change24h.toFixed(2) + "%",
        direction: r.change24h > 0 ? "📈 UP" : "📉 DOWN",
    }));

    const avgVolatility = results.length > 0
        ? results.reduce((s, r) => s + r.absChange, 0) / results.length
        : 0;

    return {
        scannedCoins: results.length,
        avgMarketVolatility: avgVolatility.toFixed(2) + "%",
        topMovers,
        leastVolatile: sorted.slice(-3).reverse().map(r => ({
            coin: r.coin,
            change24h: r.change24h.toFixed(2) + "%",
        })),
    };
}

/**
 * Correlation matrix: Pearson correlation between coins using recent candle data.
 */
export async function getCorrelationMatrix(symbols: string[], interval: string = "1h", periods: number = 48) {
    const endTime = Date.now();
    const intervalMs: Record<string, number> = {
        "1m": 60000, "5m": 300000, "15m": 900000, "30m": 1800000,
        "1h": 3600000, "4h": 14400000, "1d": 86400000,
    };
    const ms = intervalMs[interval] || 3600000;
    const startTime = endTime - periods * ms;

    // Fetch candles for each symbol
    const candleData: Record<string, number[]> = {};
    for (const symbol of symbols) {
        try {
            const candles: any[] = await getCandleSnapshot(symbol, interval, startTime, endTime);
            candleData[symbol] = candles.map(c => parseFloat(c.c)); // close prices
        } catch {
            candleData[symbol] = [];
        }
    }

    // Calculate returns
    const returnsMap: Record<string, number[]> = {};
    for (const [sym, prices] of Object.entries(candleData)) {
        const returns: number[] = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push((prices[i]! - prices[i - 1]!) / prices[i - 1]!);
        }
        returnsMap[sym] = returns;
    }

    // Pearson correlation
    function pearson(a: number[], b: number[]): number {
        const n = Math.min(a.length, b.length);
        if (n < 3) return 0;
        const sliceA = a.slice(0, n);
        const sliceB = b.slice(0, n);
        const meanA = sliceA.reduce((s, v) => s + v, 0) / n;
        const meanB = sliceB.reduce((s, v) => s + v, 0) / n;
        let num = 0, denA = 0, denB = 0;
        for (let i = 0; i < n; i++) {
            const da = sliceA[i]! - meanA;
            const db = sliceB[i]! - meanB;
            num += da * db;
            denA += da * da;
            denB += db * db;
        }
        const den = Math.sqrt(denA * denB);
        return den > 0 ? num / den : 0;
    }

    // Build matrix
    const matrix: Array<{ pair: string; correlation: string; strength: string }> = [];
    for (let i = 0; i < symbols.length; i++) {
        for (let j = i + 1; j < symbols.length; j++) {
            const rA = returnsMap[symbols[i]!] || [];
            const rB = returnsMap[symbols[j]!] || [];
            const corr = pearson(rA, rB);
            const absCorr = Math.abs(corr);
            let strength: string;
            if (absCorr > 0.8) strength = "VERY_HIGH";
            else if (absCorr > 0.6) strength = "HIGH";
            else if (absCorr > 0.4) strength = "MEDIUM";
            else if (absCorr > 0.2) strength = "LOW";
            else strength = "NEGLIGIBLE";

            matrix.push({
                pair: `${symbols[i]}-${symbols[j]}`,
                correlation: corr.toFixed(3),
                strength,
            });
        }
    }

    // Diversification score (lower avg correlation = better diversification)
    const avgCorr = matrix.length > 0
        ? matrix.reduce((s, m) => s + Math.abs(parseFloat(m.correlation)), 0) / matrix.length
        : 0;
    const diversificationScore = Math.max(0, Math.min(10, (1 - avgCorr) * 10));

    return {
        symbols,
        interval,
        periods,
        correlations: matrix,
        avgAbsCorrelation: avgCorr.toFixed(3),
        diversificationScore: diversificationScore.toFixed(1) + "/10",
        diversificationRating: diversificationScore >= 7 ? "GOOD" : diversificationScore >= 4 ? "MODERATE" : "POOR",
    };
}

/**
 * Order flow analysis: L2 book imbalance, bid/ask walls, spread for a symbol.
 */
export async function getOrderFlow(symbol: string) {
    const book: any = await getL2Book(symbol, 5);
    const levels = book.levels || [[], []];
    const bids: Array<{ px: number; sz: number; n: number }> = (levels[0] || []).map((l: any) => ({
        px: parseFloat(l.px), sz: parseFloat(l.sz), n: l.n,
    }));
    const asks: Array<{ px: number; sz: number; n: number }> = (levels[1] || []).map((l: any) => ({
        px: parseFloat(l.px), sz: parseFloat(l.sz), n: l.n,
    }));

    const totalBidSize = bids.reduce((s, b) => s + b.sz, 0);
    const totalAskSize = asks.reduce((s, a) => s + a.sz, 0);
    const totalBidNotional = bids.reduce((s, b) => s + b.sz * b.px, 0);
    const totalAskNotional = asks.reduce((s, a) => s + a.sz * a.px, 0);

    const bestBid = bids[0]?.px || 0;
    const bestAsk = asks[0]?.px || 0;
    const midPrice = (bestBid + bestAsk) / 2;
    const spread = bestBid > 0 ? ((bestAsk - bestBid) / midPrice * 100) : 0;

    // Find walls (levels with significantly more size than average)
    const avgBidSize = totalBidSize / Math.max(bids.length, 1);
    const avgAskSize = totalAskSize / Math.max(asks.length, 1);
    const bidWalls = bids.filter(b => b.sz > avgBidSize * 2).map(b => ({
        price: b.px.toFixed(2), size: b.sz.toFixed(4), distFromMid: ((midPrice - b.px) / midPrice * 100).toFixed(2) + "%",
    }));
    const askWalls = asks.filter(a => a.sz > avgAskSize * 2).map(a => ({
        price: a.px.toFixed(2), size: a.sz.toFixed(4), distFromMid: ((a.px - midPrice) / midPrice * 100).toFixed(2) + "%",
    }));

    const bidAskRatio = totalAskSize > 0 ? totalBidSize / totalAskSize : 0;
    const imbalance = totalBidSize + totalAskSize > 0
        ? ((totalBidSize - totalAskSize) / (totalBidSize + totalAskSize) * 100)
        : 0;

    let sentiment: string;
    if (imbalance > 20) sentiment = "BULLISH";
    else if (imbalance > 5) sentiment = "SLIGHTLY_BULLISH";
    else if (imbalance < -20) sentiment = "BEARISH";
    else if (imbalance < -5) sentiment = "SLIGHTLY_BEARISH";
    else sentiment = "NEUTRAL";

    return {
        symbol,
        midPrice: midPrice.toFixed(2),
        bestBid: bestBid.toFixed(2),
        bestAsk: bestAsk.toFixed(2),
        spread: spread.toFixed(4) + "%",
        totalBidSize: totalBidSize.toFixed(4),
        totalAskSize: totalAskSize.toFixed(4),
        totalBidNotional: totalBidNotional.toFixed(2),
        totalAskNotional: totalAskNotional.toFixed(2),
        bidAskRatio: bidAskRatio.toFixed(2),
        bookImbalance: imbalance.toFixed(1) + "%",
        sentiment,
        bidLevels: bids.length,
        askLevels: asks.length,
        bidWalls,
        askWalls,
    };
}
