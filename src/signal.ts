/**
 * Signal Detection Module — Technical Analysis Signals
 *
 * Provides RSI, RSI Divergence, MACD, ICT, and Smart Money Concept (SMC) analysis.
 * All tools consume candle data from Hyperliquid via getCandleSnapshot().
 */

import * as hl from "./hyperliquid.js";

// ─── Helpers ──────────────────────────────────────────────

interface Candle {
    t: number; o: number; h: number; l: number; c: number; v: number;
}

async function fetchCandles(symbol: string, interval: string, count: number): Promise<Candle[]> {
    const intervalMs: Record<string, number> = {
        "1m": 60000, "3m": 180000, "5m": 300000, "15m": 900000, "30m": 1800000,
        "1h": 3600000, "2h": 7200000, "4h": 14400000, "8h": 28800000,
        "12h": 43200000, "1d": 86400000,
    };
    const ms = intervalMs[interval] || 3600000;
    const endTime = Date.now();
    const startTime = endTime - count * ms;
    const raw: any[] = await hl.getCandleSnapshot(symbol, interval, startTime, endTime);
    return raw.map(c => ({
        t: c.t, o: parseFloat(c.o), h: parseFloat(c.h),
        l: parseFloat(c.l), c: parseFloat(c.c), v: parseFloat(c.v),
    }));
}

function ema(data: number[], period: number): number[] {
    const result: number[] = [];
    const k = 2 / (period + 1);
    let prev = data[0]!;
    result.push(prev);
    for (let i = 1; i < data.length; i++) {
        prev = data[i]! * k + prev * (1 - k);
        result.push(prev);
    }
    return result;
}

function sma(data: number[], period: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) { result.push(NaN); continue; }
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += data[j]!;
        result.push(sum / period);
    }
    return result;
}

// ─── 1. RSI Signal ────────────────────────────────────────

function calcRSI(closes: number[], period: number = 14): number[] {
    const rsi: number[] = [];
    let gainSum = 0, lossSum = 0;

    for (let i = 0; i < closes.length; i++) {
        if (i === 0) { rsi.push(NaN); continue; }
        const change = closes[i]! - closes[i - 1]!;
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? -change : 0;

        if (i <= period) {
            gainSum += gain;
            lossSum += loss;
            if (i === period) {
                const avgGain = gainSum / period;
                const avgLoss = lossSum / period;
                rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
            } else {
                rsi.push(NaN);
            }
        } else {
            const prevAvgGain = (rsi[i - 1]! === 100) ? Infinity : (100 / (100 - rsi[i - 1]!) - 1);
            // Use Wilder smoothing
            const avgGain = (gainSum * (period - 1) + gain) / period;
            const avgLoss = (lossSum * (period - 1) + loss) / period;
            gainSum = avgGain;
            lossSum = avgLoss;
            rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
        }
    }
    return rsi;
}

// Proper Wilder RSI
function wilderRSI(closes: number[], period: number = 14): number[] {
    const rsi: number[] = new Array(closes.length).fill(NaN);
    if (closes.length < period + 1) return rsi;

    let avgGain = 0, avgLoss = 0;
    // Seed with SMA
    for (let i = 1; i <= period; i++) {
        const change = closes[i]! - closes[i - 1]!;
        if (change > 0) avgGain += change;
        else avgLoss -= change;
    }
    avgGain /= period;
    avgLoss /= period;
    rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

    for (let i = period + 1; i < closes.length; i++) {
        const change = closes[i]! - closes[i - 1]!;
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? -change : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return rsi;
}

export async function getRSISignal(
    symbol: string,
    interval: string = "15m",
    period: number = 14,
    overbought: number = 70,
    oversold: number = 30
) {
    const candles = await fetchCandles(symbol, interval, period + 50);
    const closes = candles.map(c => c.c);
    const rsiValues = wilderRSI(closes, period);

    const currentRSI = rsiValues[rsiValues.length - 1]!;
    const prevRSI = rsiValues[rsiValues.length - 2]!;
    const currentPrice = closes[closes.length - 1]!;

    let signal: string;
    let description: string;
    if (currentRSI >= overbought) {
        signal = "OVERBOUGHT";
        description = `RSI ${currentRSI.toFixed(1)} > ${overbought} — potential reversal down`;
    } else if (currentRSI <= oversold) {
        signal = "OVERSOLD";
        description = `RSI ${currentRSI.toFixed(1)} < ${oversold} — potential reversal up`;
    } else if (prevRSI <= oversold && currentRSI > oversold) {
        signal = "BULLISH_CROSS";
        description = `RSI crossed above ${oversold} from oversold territory`;
    } else if (prevRSI >= overbought && currentRSI < overbought) {
        signal = "BEARISH_CROSS";
        description = `RSI crossed below ${overbought} from overbought territory`;
    } else {
        signal = "NEUTRAL";
        description = `RSI ${currentRSI.toFixed(1)} — no extreme reading`;
    }

    // RSI trend
    const rsiTrend = currentRSI > prevRSI ? "RISING" : "FALLING";

    return {
        symbol, interval, period,
        currentRSI: currentRSI.toFixed(1),
        previousRSI: prevRSI.toFixed(1),
        rsiTrend,
        currentPrice: currentPrice.toFixed(2),
        signal,
        description,
        overbought, oversold,
        last5RSI: rsiValues.slice(-5).map(v => isNaN(v!) ? "N/A" : v!.toFixed(1)),
    };
}

// ─── 2. RSI Divergence ────────────────────────────────────

export async function getRSIDivergence(
    symbol: string,
    interval: string = "15m",
    period: number = 14,
    lookback: number = 30
) {
    const candles = await fetchCandles(symbol, interval, period + lookback + 20);
    const closes = candles.map(c => c.c);
    const lows = candles.map(c => c.l);
    const highs = candles.map(c => c.h);
    const rsiValues = wilderRSI(closes, period);

    const divergences: Array<{
        type: string; direction: string;
        pricePoint1: string; pricePoint2: string;
        rsiPoint1: string; rsiPoint2: string;
        candlesAgo: number;
    }> = [];

    const validStart = period + 2;
    const end = rsiValues.length - 1;

    // Find local lows/highs in price and RSI (swing points)
    const swingLows: number[] = [];
    const swingHighs: number[] = [];

    for (let i = validStart; i < end - 1; i++) {
        if (!isNaN(rsiValues[i]!)) {
            // Swing low
            if (lows[i]! <= lows[i - 1]! && lows[i]! <= lows[i - 2]! &&
                lows[i]! <= lows[i + 1]! && lows[i]! <= lows[i + 2]!) {
                swingLows.push(i);
            }
            // Swing high
            if (highs[i]! >= highs[i - 1]! && highs[i]! >= highs[i - 2]! &&
                highs[i]! >= highs[i + 1]! && highs[i]! >= highs[i + 2]!) {
                swingHighs.push(i);
            }
        }
    }

    // Check bullish divergence: price makes lower low, RSI makes higher low
    for (let i = 1; i < swingLows.length; i++) {
        const prev = swingLows[i - 1]!;
        const curr = swingLows[i]!;
        if (curr - prev < 3) continue; // too close
        if (lows[curr]! < lows[prev]! && rsiValues[curr]! > rsiValues[prev]!) {
            divergences.push({
                type: "BULLISH",
                direction: "Price ↓ RSI ↑ — potential reversal UP",
                pricePoint1: lows[prev]!.toFixed(2),
                pricePoint2: lows[curr]!.toFixed(2),
                rsiPoint1: rsiValues[prev]!.toFixed(1),
                rsiPoint2: rsiValues[curr]!.toFixed(1),
                candlesAgo: end - curr,
            });
        }
    }

    // Check bearish divergence: price makes higher high, RSI makes lower high
    for (let i = 1; i < swingHighs.length; i++) {
        const prev = swingHighs[i - 1]!;
        const curr = swingHighs[i]!;
        if (curr - prev < 3) continue;
        if (highs[curr]! > highs[prev]! && rsiValues[curr]! < rsiValues[prev]!) {
            divergences.push({
                type: "BEARISH",
                direction: "Price ↑ RSI ↓ — potential reversal DOWN",
                pricePoint1: highs[prev]!.toFixed(2),
                pricePoint2: highs[curr]!.toFixed(2),
                rsiPoint1: rsiValues[prev]!.toFixed(1),
                rsiPoint2: rsiValues[curr]!.toFixed(1),
                candlesAgo: end - curr,
            });
        }
    }

    // Sort by recency
    divergences.sort((a, b) => a.candlesAgo - b.candlesAgo);

    const currentRSI = rsiValues[end]!;
    const currentPrice = closes[end]!;

    return {
        symbol, interval, period,
        currentRSI: currentRSI.toFixed(1),
        currentPrice: currentPrice.toFixed(2),
        divergenceCount: divergences.length,
        divergences: divergences.slice(0, 5), // latest 5
        signal: divergences.length > 0 && divergences[0]!.candlesAgo <= 5
            ? divergences[0]!.type + "_DIVERGENCE"
            : "NO_DIVERGENCE",
    };
}

// ─── 3. MACD Signal ───────────────────────────────────────

export async function getMACDSignal(
    symbol: string,
    interval: string = "15m",
    fastPeriod: number = 12,
    slowPeriod: number = 26,
    signalPeriod: number = 9
) {
    const candles = await fetchCandles(symbol, interval, slowPeriod + signalPeriod + 50);
    const closes = candles.map(c => c.c);

    const fastEMA = ema(closes, fastPeriod);
    const slowEMA = ema(closes, slowPeriod);
    const macdLine = fastEMA.map((f, i) => f - slowEMA[i]!);
    const signalLine = ema(macdLine, signalPeriod);
    const histogram = macdLine.map((m, i) => m - signalLine[i]!);

    const len = closes.length;
    const curr = {
        macd: macdLine[len - 1]!,
        signal: signalLine[len - 1]!,
        histogram: histogram[len - 1]!,
        price: closes[len - 1]!,
    };
    const prev = {
        macd: macdLine[len - 2]!,
        signal: signalLine[len - 2]!,
        histogram: histogram[len - 2]!,
    };
    const prev2 = {
        histogram: histogram[len - 3]!,
    };

    // Detect signals
    let signal: string;
    let description: string;

    if (prev.macd <= prev.signal && curr.macd > curr.signal) {
        signal = "BULLISH_CROSS";
        description = "MACD line crossed ABOVE signal line — bullish momentum";
    } else if (prev.macd >= prev.signal && curr.macd < curr.signal) {
        signal = "BEARISH_CROSS";
        description = "MACD line crossed BELOW signal line — bearish momentum";
    } else if (curr.histogram > 0 && prev.histogram > 0 && curr.histogram > prev.histogram) {
        signal = "BULLISH_MOMENTUM";
        description = "Histogram expanding positive — strengthening bullish momentum";
    } else if (curr.histogram < 0 && prev.histogram < 0 && curr.histogram < prev.histogram) {
        signal = "BEARISH_MOMENTUM";
        description = "Histogram expanding negative — strengthening bearish momentum";
    } else if (curr.histogram > 0 && prev.histogram > 0 && curr.histogram < prev.histogram) {
        signal = "BULLISH_WEAKENING";
        description = "Histogram contracting — bullish momentum weakening";
    } else if (curr.histogram < 0 && prev.histogram < 0 && curr.histogram > prev.histogram) {
        signal = "BEARISH_WEAKENING";
        description = "Histogram contracting — bearish momentum weakening";
    } else {
        signal = "NEUTRAL";
        description = "No significant MACD signal";
    }

    // Zero line cross
    const zeroCross = (prev.macd <= 0 && curr.macd > 0) ? "BULLISH_ZERO_CROSS"
        : (prev.macd >= 0 && curr.macd < 0) ? "BEARISH_ZERO_CROSS"
        : null;

    return {
        symbol, interval,
        params: { fast: fastPeriod, slow: slowPeriod, signal: signalPeriod },
        currentPrice: curr.price.toFixed(2),
        macd: curr.macd.toFixed(4),
        signalLine: curr.signal.toFixed(4),
        histogram: curr.histogram.toFixed(4),
        histogramTrend: curr.histogram > prev.histogram ? "EXPANDING" : "CONTRACTING",
        signal,
        zeroCross,
        description,
        last5Histogram: histogram.slice(-5).map(v => v.toFixed(4)),
    };
}

// ─── 4. ICT Analysis ──────────────────────────────────────

export async function getICTAnalysis(
    symbol: string,
    interval: string = "15m",
    lookback: number = 50
) {
    const candles = await fetchCandles(symbol, interval, lookback + 10);
    const currentPrice = candles[candles.length - 1]!.c;

    // 1. Fair Value Gaps (FVG) — 3-candle imbalance
    const fvgs: Array<{
        type: string; top: string; bottom: string; midpoint: string;
        candlesAgo: number; filled: boolean;
    }> = [];

    for (let i = 2; i < candles.length; i++) {
        const c1 = candles[i - 2]!;
        const c2 = candles[i - 1]!;
        const c3 = candles[i]!;

        // Bullish FVG: candle 3 low > candle 1 high (gap up)
        if (c3.l > c1.h) {
            const filled = currentPrice <= c3.l; // price came back to fill
            fvgs.push({
                type: "BULLISH_FVG",
                top: c3.l.toFixed(2),
                bottom: c1.h.toFixed(2),
                midpoint: ((c3.l + c1.h) / 2).toFixed(2),
                candlesAgo: candles.length - 1 - i,
                filled,
            });
        }
        // Bearish FVG: candle 3 high < candle 1 low (gap down)
        if (c3.h < c1.l) {
            const filled = currentPrice >= c3.h;
            fvgs.push({
                type: "BEARISH_FVG",
                top: c1.l.toFixed(2),
                bottom: c3.h.toFixed(2),
                midpoint: ((c1.l + c3.h) / 2).toFixed(2),
                candlesAgo: candles.length - 1 - i,
                filled,
            });
        }
    }

    // 2. Order Blocks — last bullish/bearish candle before impulsive move
    const orderBlocks: Array<{
        type: string; high: string; low: string; candlesAgo: number;
    }> = [];

    for (let i = 3; i < candles.length - 1; i++) {
        const c = candles[i]!;
        const next = candles[i + 1]!;
        const body = Math.abs(c.c - c.o);
        const nextBody = Math.abs(next.c - next.o);

        // Bullish OB: bearish candle followed by strong bullish candle
        if (c.c < c.o && next.c > next.o && nextBody > body * 1.5) {
            orderBlocks.push({
                type: "BULLISH_OB",
                high: c.h.toFixed(2),
                low: c.l.toFixed(2),
                candlesAgo: candles.length - 1 - i,
            });
        }
        // Bearish OB: bullish candle followed by strong bearish candle
        if (c.c > c.o && next.c < next.o && nextBody > body * 1.5) {
            orderBlocks.push({
                type: "BEARISH_OB",
                high: c.h.toFixed(2),
                low: c.l.toFixed(2),
                candlesAgo: candles.length - 1 - i,
            });
        }
    }

    // 3. Liquidity Sweeps — sweep of recent swing high/low then reversal
    const liquiditySweeps: Array<{
        type: string; sweptLevel: string; candlesAgo: number;
    }> = [];

    // Find swing highs/lows
    for (let i = 4; i < candles.length - 1; i++) {
        const c = candles[i]!;
        const prev1 = candles[i - 1]!;
        const prev2 = candles[i - 2]!;
        const next = candles[i + 1]!;

        // High sweep: wick above recent highs then close back below
        const recentHighs = candles.slice(Math.max(0, i - 10), i).map(x => x.h);
        const maxRecentHigh = Math.max(...recentHighs);
        if (c.h > maxRecentHigh && c.c < maxRecentHigh && next.c < c.c) {
            liquiditySweeps.push({
                type: "BEARISH_SWEEP",
                sweptLevel: maxRecentHigh.toFixed(2),
                candlesAgo: candles.length - 1 - i,
            });
        }

        // Low sweep: wick below recent lows then close back above
        const recentLows = candles.slice(Math.max(0, i - 10), i).map(x => x.l);
        const minRecentLow = Math.min(...recentLows);
        if (c.l < minRecentLow && c.c > minRecentLow && next.c > c.c) {
            liquiditySweeps.push({
                type: "BULLISH_SWEEP",
                sweptLevel: minRecentLow.toFixed(2),
                candlesAgo: candles.length - 1 - i,
            });
        }
    }

    // Sort all by recency
    const unfilledFVGs = fvgs.filter(f => !f.filled).sort((a, b) => a.candlesAgo - b.candlesAgo);
    orderBlocks.sort((a, b) => a.candlesAgo - b.candlesAgo);
    liquiditySweeps.sort((a, b) => a.candlesAgo - b.candlesAgo);

    // Nearest level
    const nearestBullishFVG = unfilledFVGs.find(f => f.type === "BULLISH_FVG" && parseFloat(f.midpoint) < currentPrice);
    const nearestBearishFVG = unfilledFVGs.find(f => f.type === "BEARISH_FVG" && parseFloat(f.midpoint) > currentPrice);

    return {
        symbol, interval, currentPrice: currentPrice.toFixed(2),
        fairValueGaps: {
            total: fvgs.length,
            unfilled: unfilledFVGs.length,
            nearest: {
                above: nearestBearishFVG || null,
                below: nearestBullishFVG || null,
            },
            recent: unfilledFVGs.slice(0, 5),
        },
        orderBlocks: {
            total: orderBlocks.length,
            recent: orderBlocks.slice(0, 5),
        },
        liquiditySweeps: {
            total: liquiditySweeps.length,
            recent: liquiditySweeps.slice(0, 3),
        },
    };
}

// ─── 5. Smart Money Concept (SMC) ─────────────────────────

export async function getSMCAnalysis(
    symbol: string,
    interval: string = "15m",
    lookback: number = 60
) {
    const candles = await fetchCandles(symbol, interval, lookback + 10);
    const currentPrice = candles[candles.length - 1]!.c;

    // 1. Market Structure — detect BOS (Break of Structure) and CHoCH (Change of Character)
    // Find swing points
    const swings: Array<{ type: "HH" | "HL" | "LH" | "LL"; price: number; index: number }> = [];
    const swingHighs: Array<{ price: number; index: number }> = [];
    const swingLows: Array<{ price: number; index: number }> = [];

    for (let i = 2; i < candles.length - 2; i++) {
        const c = candles[i]!;
        // Swing High
        if (c.h >= candles[i - 1]!.h && c.h >= candles[i - 2]!.h &&
            c.h >= candles[i + 1]!.h && c.h >= candles[i + 2]!.h) {
            swingHighs.push({ price: c.h, index: i });
        }
        // Swing Low
        if (c.l <= candles[i - 1]!.l && c.l <= candles[i - 2]!.l &&
            c.l <= candles[i + 1]!.l && c.l <= candles[i + 2]!.l) {
            swingLows.push({ price: c.l, index: i });
        }
    }

    // Classify swing points (HH, HL, LH, LL)
    for (let i = 1; i < swingHighs.length; i++) {
        const curr = swingHighs[i]!;
        const prev = swingHighs[i - 1]!;
        swings.push({
            type: curr.price > prev.price ? "HH" : "LH",
            price: curr.price,
            index: curr.index,
        });
    }
    for (let i = 1; i < swingLows.length; i++) {
        const curr = swingLows[i]!;
        const prev = swingLows[i - 1]!;
        swings.push({
            type: curr.price > prev.price ? "HL" : "LL",
            price: curr.price,
            index: curr.index,
        });
    }
    swings.sort((a, b) => a.index - b.index);

    // Determine trend from recent swing structure
    const recentSwings = swings.slice(-6);
    const hhCount = recentSwings.filter(s => s.type === "HH").length;
    const hlCount = recentSwings.filter(s => s.type === "HL").length;
    const lhCount = recentSwings.filter(s => s.type === "LH").length;
    const llCount = recentSwings.filter(s => s.type === "LL").length;

    let marketStructure: string;
    if (hhCount + hlCount > lhCount + llCount) marketStructure = "BULLISH";
    else if (lhCount + llCount > hhCount + hlCount) marketStructure = "BEARISH";
    else marketStructure = "RANGING";

    // 2. BOS (Break of Structure) — price breaks above swing high (bullish) or below swing low (bearish)
    const bosEvents: Array<{
        type: string; brokenLevel: string; candlesAgo: number;
    }> = [];

    for (let i = 0; i < swingHighs.length - 1; i++) {
        const sh = swingHighs[i]!;
        // Check if any candle after broke above this swing high
        for (let j = sh.index + 1; j < candles.length; j++) {
            if (candles[j]!.c > sh.price) {
                bosEvents.push({
                    type: "BULLISH_BOS",
                    brokenLevel: sh.price.toFixed(2),
                    candlesAgo: candles.length - 1 - j,
                });
                break;
            }
        }
    }
    for (let i = 0; i < swingLows.length - 1; i++) {
        const sl = swingLows[i]!;
        for (let j = sl.index + 1; j < candles.length; j++) {
            if (candles[j]!.c < sl.price) {
                bosEvents.push({
                    type: "BEARISH_BOS",
                    brokenLevel: sl.price.toFixed(2),
                    candlesAgo: candles.length - 1 - j,
                });
                break;
            }
        }
    }
    bosEvents.sort((a, b) => a.candlesAgo - b.candlesAgo);

    // 3. CHoCH (Change of Character) — structure shift (from HH/HL to LH/LL or vice versa)
    const chochEvents: Array<{
        type: string; from: string; to: string; level: string; candlesAgo: number;
    }> = [];

    for (let i = 1; i < swings.length; i++) {
        const curr = swings[i]!;
        const prev = swings[i - 1]!;

        // Bullish CHoCH: was making LL/LH, now makes HL
        if ((prev.type === "LL" || prev.type === "LH") && curr.type === "HL") {
            chochEvents.push({
                type: "BULLISH_CHOCH",
                from: "Bearish",
                to: "Bullish",
                level: curr.price.toFixed(2),
                candlesAgo: candles.length - 1 - curr.index,
            });
        }
        // Bearish CHoCH: was making HH/HL, now makes LH
        if ((prev.type === "HH" || prev.type === "HL") && curr.type === "LH") {
            chochEvents.push({
                type: "BEARISH_CHOCH",
                from: "Bullish",
                to: "Bearish",
                level: curr.price.toFixed(2),
                candlesAgo: candles.length - 1 - curr.index,
            });
        }
    }
    chochEvents.sort((a, b) => a.candlesAgo - b.candlesAgo);

    // 4. Supply/Demand Zones — areas of significant price rejection
    const supplyDemandZones: Array<{
        type: string; high: string; low: string; strength: string; candlesAgo: number;
    }> = [];

    for (let i = 2; i < candles.length - 2; i++) {
        const c = candles[i]!;
        const prevC = candles[i - 1]!;
        const nextC = candles[i + 1]!;
        const bodySize = Math.abs(c.c - c.o);
        const wickUp = c.h - Math.max(c.o, c.c);
        const wickDown = Math.min(c.o, c.c) - c.l;
        const totalRange = c.h - c.l;

        if (totalRange === 0) continue;

        // Demand zone: long lower wick (rejection from below) + bullish follow-through
        if (wickDown > bodySize * 1.5 && nextC.c > c.c) {
            const touches = candles.slice(i + 1).filter(x => x.l >= c.l && x.l <= c.l + wickDown * 0.5).length;
            supplyDemandZones.push({
                type: "DEMAND",
                high: Math.min(c.o, c.c).toFixed(2),
                low: c.l.toFixed(2),
                strength: touches >= 2 ? "STRONG" : "MODERATE",
                candlesAgo: candles.length - 1 - i,
            });
        }

        // Supply zone: long upper wick (rejection from above) + bearish follow-through
        if (wickUp > bodySize * 1.5 && nextC.c < c.c) {
            const touches = candles.slice(i + 1).filter(x => x.h <= c.h && x.h >= c.h - wickUp * 0.5).length;
            supplyDemandZones.push({
                type: "SUPPLY",
                high: c.h.toFixed(2),
                low: Math.max(c.o, c.c).toFixed(2),
                strength: touches >= 2 ? "STRONG" : "MODERATE",
                candlesAgo: candles.length - 1 - i,
            });
        }
    }
    supplyDemandZones.sort((a, b) => a.candlesAgo - b.candlesAgo);

    // 5. Liquidity Pools — clusters of equal highs/lows (stop hunts)
    const liquidityPools: Array<{
        type: string; level: string; touches: number; candlesAgo: number;
    }> = [];

    // Equal highs (within 0.05% tolerance)
    for (let i = 0; i < swingHighs.length; i++) {
        let touches = 1;
        for (let j = i + 1; j < swingHighs.length; j++) {
            const diff = Math.abs(swingHighs[i]!.price - swingHighs[j]!.price) / swingHighs[i]!.price;
            if (diff < 0.0005) touches++;
        }
        if (touches >= 2) {
            liquidityPools.push({
                type: "SELL_SIDE_LIQUIDITY",
                level: swingHighs[i]!.price.toFixed(2),
                touches,
                candlesAgo: candles.length - 1 - swingHighs[i]!.index,
            });
        }
    }

    // Equal lows
    for (let i = 0; i < swingLows.length; i++) {
        let touches = 1;
        for (let j = i + 1; j < swingLows.length; j++) {
            const diff = Math.abs(swingLows[i]!.price - swingLows[j]!.price) / swingLows[i]!.price;
            if (diff < 0.0005) touches++;
        }
        if (touches >= 2) {
            liquidityPools.push({
                type: "BUY_SIDE_LIQUIDITY",
                level: swingLows[i]!.price.toFixed(2),
                touches,
                candlesAgo: candles.length - 1 - swingLows[i]!.index,
            });
        }
    }

    return {
        symbol, interval, currentPrice: currentPrice.toFixed(2),
        marketStructure,
        recentSwings: recentSwings.map(s => ({
            type: s.type,
            price: s.price.toFixed(2),
            candlesAgo: candles.length - 1 - s.index,
        })),
        breakOfStructure: {
            total: bosEvents.length,
            recent: bosEvents.slice(0, 3),
        },
        changeOfCharacter: {
            total: chochEvents.length,
            recent: chochEvents.slice(0, 3),
        },
        supplyDemandZones: {
            total: supplyDemandZones.length,
            nearestDemand: supplyDemandZones.find(z => z.type === "DEMAND" && parseFloat(z.low) < currentPrice) || null,
            nearestSupply: supplyDemandZones.find(z => z.type === "SUPPLY" && parseFloat(z.high) > currentPrice) || null,
            recent: supplyDemandZones.slice(0, 5),
        },
        liquidityPools: {
            total: liquidityPools.length,
            above: liquidityPools.filter(l => parseFloat(l.level) > currentPrice).slice(0, 3),
            below: liquidityPools.filter(l => parseFloat(l.level) < currentPrice).slice(0, 3),
        },
    };
}

// ─── 6. Support & Resistance Zones ────────────────────────

export async function getSupportResistance(
    symbol: string,
    interval: string = "1h",
    lookback: number = 100,
    tolerance: number = 0.003 // 0.3% cluster tolerance
) {
    const candles = await fetchCandles(symbol, interval, lookback + 10);
    const currentPrice = candles[candles.length - 1]!.c;

    // Collect all swing highs and lows as raw levels
    const rawLevels: Array<{ price: number; type: "high" | "low"; volume: number; index: number }> = [];

    for (let i = 2; i < candles.length - 2; i++) {
        const c = candles[i]!;
        // Swing High (resistance candidate)
        if (c.h >= candles[i - 1]!.h && c.h >= candles[i - 2]!.h &&
            c.h >= candles[i + 1]!.h && c.h >= candles[i + 2]!.h) {
            rawLevels.push({ price: c.h, type: "high", volume: c.v, index: i });
        }
        // Swing Low (support candidate)
        if (c.l <= candles[i - 1]!.l && c.l <= candles[i - 2]!.l &&
            c.l <= candles[i + 1]!.l && c.l <= candles[i + 2]!.l) {
            rawLevels.push({ price: c.l, type: "low", volume: c.v, index: i });
        }
    }

    // Also add round-number levels near current price (psychological S/R)
    const magnitude = Math.pow(10, Math.floor(Math.log10(currentPrice)) - 1);
    const roundBase = Math.floor(currentPrice / magnitude) * magnitude;
    const roundLevels: number[] = [];
    for (let m = -5; m <= 5; m++) {
        roundLevels.push(roundBase + m * magnitude);
    }

    // Cluster nearby raw levels into zones
    rawLevels.sort((a, b) => a.price - b.price);
    const zones: Array<{
        price: number; type: string; touches: number;
        totalVolume: number; firstSeen: number; lastSeen: number;
    }> = [];

    const used = new Set<number>();
    for (let i = 0; i < rawLevels.length; i++) {
        if (used.has(i)) continue;
        const cluster = [rawLevels[i]!];
        used.add(i);

        for (let j = i + 1; j < rawLevels.length; j++) {
            if (used.has(j)) continue;
            const diff = Math.abs(rawLevels[j]!.price - rawLevels[i]!.price) / rawLevels[i]!.price;
            if (diff <= tolerance) {
                cluster.push(rawLevels[j]!);
                used.add(j);
            }
        }

        const avgPrice = cluster.reduce((s, c) => s + c.price, 0) / cluster.length;
        const totalVolume = cluster.reduce((s, c) => s + c.volume, 0);
        const highCount = cluster.filter(c => c.type === "high").length;
        const lowCount = cluster.filter(c => c.type === "low").length;
        const type = highCount > lowCount ? "RESISTANCE"
            : lowCount > highCount ? "SUPPORT"
            : avgPrice > currentPrice ? "RESISTANCE" : "SUPPORT";

        zones.push({
            price: avgPrice,
            type,
            touches: cluster.length,
            totalVolume,
            firstSeen: candles.length - 1 - Math.max(...cluster.map(c => c.index)),
            lastSeen: candles.length - 1 - Math.min(...cluster.map(c => c.index)),
        });
    }

    // Rank by touches × volume (higher = stronger)
    zones.sort((a, b) => (b.touches * b.totalVolume) - (a.touches * a.totalVolume));

    // Format zones
    const formatZone = (z: typeof zones[0]) => ({
        price: z!.price.toFixed(2),
        type: z!.type,
        touches: z!.touches,
        strength: z!.touches >= 4 ? "VERY_STRONG" : z!.touches >= 3 ? "STRONG" : z!.touches >= 2 ? "MODERATE" : "WEAK",
        distanceFromPrice: ((z!.price - currentPrice) / currentPrice * 100).toFixed(2) + "%",
        candlesAgoFirstSeen: z!.firstSeen,
    });

    const resistanceLevels = zones
        .filter(z => z.price > currentPrice)
        .sort((a, b) => a.price - b.price)
        .slice(0, 5)
        .map(formatZone);

    const supportLevels = zones
        .filter(z => z.price < currentPrice)
        .sort((a, b) => b.price - a.price)
        .slice(0, 5)
        .map(formatZone);

    // Check if price is at a level
    const nearestSupport = supportLevels[0];
    const nearestResistance = resistanceLevels[0];
    const supportDist = nearestSupport ? Math.abs(parseFloat(nearestSupport.distanceFromPrice)) : 999;
    const resistDist = nearestResistance ? Math.abs(parseFloat(nearestResistance.distanceFromPrice)) : 999;

    let proximity: string;
    if (supportDist < 0.3) proximity = "AT_SUPPORT";
    else if (resistDist < 0.3) proximity = "AT_RESISTANCE";
    else if (supportDist < 1.0) proximity = "NEAR_SUPPORT";
    else if (resistDist < 1.0) proximity = "NEAR_RESISTANCE";
    else proximity = "BETWEEN_LEVELS";

    // Check for round-number levels nearby
    const nearbyRoundLevels = roundLevels
        .filter(r => Math.abs(r - currentPrice) / currentPrice < 0.02)
        .map(r => ({
            price: r.toFixed(2),
            type: r > currentPrice ? "PSYCHOLOGICAL_RESISTANCE" : "PSYCHOLOGICAL_SUPPORT",
            distanceFromPrice: ((r - currentPrice) / currentPrice * 100).toFixed(2) + "%",
        }));

    return {
        symbol, interval, lookback,
        currentPrice: currentPrice.toFixed(2),
        proximity,
        nearestResistance: nearestResistance || null,
        nearestSupport: nearestSupport || null,
        resistanceLevels,
        supportLevels,
        psychologicalLevels: nearbyRoundLevels,
        totalZonesDetected: zones.length,
    };
}
