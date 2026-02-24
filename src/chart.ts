/**
 * Chart Generation — Uses QuickChart.io API (zero local deps).
 * Generates chart images from market data, returns base64 PNG.
 * Dark theme by default.
 */

import * as hl from "./hyperliquid.js";

const QUICKCHART_URL = "https://quickchart.io/chart";

interface ChartResult {
    base64: string;
    summary: string;
}

/**
 * Render a Chart.js config via QuickChart.io API → returns base64 PNG.
 */
async function renderChart(config: object, width: number = 800, height: number = 400): Promise<string> {
    const res = await fetch(QUICKCHART_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chart: config,
            width,
            height,
            backgroundColor: "#1a1a2e",
            format: "png",
        }),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`QuickChart render error: ${res.status} - ${errText}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.toString("base64");
}

// ─── Helpers ──────────────────────────────────────────

function formatTimestamp(ms: number): string {
    const d = new Date(ms);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

// ─── 1. Price Chart ───────────────────────────────────

/**
 * Generate a price line chart for a symbol using candle data.
 * Fetches candles internally.
 */
export async function generatePriceChart(
    symbol: string,
    interval: string,
    count: number = 100
): Promise<ChartResult> {
    // Compute time range
    const intervalMs: Record<string, number> = {
        "1m": 60000, "3m": 180000, "5m": 300000, "15m": 900000, "30m": 1800000,
        "1h": 3600000, "2h": 7200000, "4h": 14400000, "8h": 28800000,
        "12h": 43200000, "1d": 86400000,
    };
    const ms = intervalMs[interval] || 3600000;
    const endTime = Date.now();
    const startTime = endTime - count * ms;

    const raw: any[] = await hl.getCandleSnapshot(symbol, interval, startTime, endTime);
    if (raw.length === 0) throw new Error(`No candle data for ${symbol} ${interval}`);

    const candles = raw.map(c => ({
        t: c.t as number,
        o: parseFloat(c.o),
        h: parseFloat(c.h),
        l: parseFloat(c.l),
        c: parseFloat(c.c),
        v: parseFloat(c.v),
    }));

    const labels = candles.map(c => formatTimestamp(c.t));
    const closes = candles.map(c => c.c);
    const first = candles[0]!;
    const last = candles[candles.length - 1]!;
    const priceChange = ((last.c - first.c) / first.c * 100).toFixed(2);
    const isPositive = parseFloat(priceChange) >= 0;

    const config = {
        type: "line",
        data: {
            labels,
            datasets: [{
                label: `${symbol} (${interval})`,
                data: closes,
                borderColor: isPositive ? "#00e676" : "#ff1744",
                backgroundColor: isPositive ? "rgba(0,230,118,0.1)" : "rgba(255,23,68,0.1)",
                fill: true,
                tension: 0.1,
                pointRadius: 0,
                borderWidth: 2,
            }],
        },
        options: {
            plugins: {
                title: {
                    display: true,
                    text: `${symbol} ${interval} | ${priceChange}% | $${last.c.toFixed(2)}`,
                    color: "#e0e0e0",
                    font: { size: 16 },
                },
                legend: { labels: { color: "#e0e0e0" } },
            },
            scales: {
                x: {
                    ticks: { color: "#999", maxTicksLimit: 10, maxRotation: 0 },
                    grid: { color: "rgba(255,255,255,0.05)" },
                },
                y: {
                    ticks: { color: "#999" },
                    grid: { color: "rgba(255,255,255,0.1)" },
                },
            },
        },
    };

    const base64 = await renderChart(config);
    return {
        base64,
        summary: `${symbol} ${interval} chart: ${candles.length} candles, ${priceChange}% change, last price $${last.c.toFixed(2)}`,
    };
}

// ─── 2. Portfolio Chart ───────────────────────────────

/**
 * Generate a portfolio allocation doughnut chart from account positions.
 */
export async function generatePortfolioChart(userAddress: string): Promise<ChartResult> {
    const portfolio = await hl.getPortfolioSummary(userAddress);
    const positions = portfolio.positions;

    if (positions.length === 0) {
        throw new Error("No open positions to chart");
    }

    const labels = positions.map((p: any) => `${p.coin} (${parseFloat(p.unrealizedPnl) >= 0 ? "+" : ""}${p.unrealizedPnl})`);
    const values = positions.map((p: any) => {
        // Use entry price × size as notional approximation
        return Math.abs(parseFloat(p.entryPx) * parseFloat(p.size));
    });

    // Color by side: green for longs, red for shorts
    const colors = positions.map((p: any) =>
        parseFloat(p.size) > 0 ? "#00e676" : "#ff1744"
    );

    const config = {
        type: "doughnut",
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderColor: "#1a1a2e",
                borderWidth: 2,
            }],
        },
        options: {
            plugins: {
                title: {
                    display: true,
                    text: `Portfolio — $${portfolio.accountValue} | PnL: $${portfolio.totalUnrealizedPnl}`,
                    color: "#e0e0e0",
                    font: { size: 16 },
                },
                legend: {
                    position: "right",
                    labels: { color: "#e0e0e0", font: { size: 12 } },
                },
            },
        },
    };

    const base64 = await renderChart(config, 700, 400);
    return {
        base64,
        summary: `Portfolio: ${positions.length} positions, equity $${portfolio.accountValue}, unrealized PnL $${portfolio.totalUnrealizedPnl}`,
    };
}

// ─── 3. PnL Chart ─────────────────────────────────────

/**
 * Generate a cumulative PnL equity curve from trade fill history.
 */
export async function generatePnlChart(
    userAddress: string,
    days: number = 30
): Promise<ChartResult> {
    const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
    const fills: any[] = await hl.getUserFillsByTime(userAddress, startTime);

    // Build cumulative PnL
    let cumulative = 0;
    const data: number[] = [];
    const labels: string[] = [];

    for (const fill of fills) {
        const pnl = parseFloat(fill.closedPnl || "0");
        if (pnl === 0) continue;
        cumulative += pnl;
        data.push(parseFloat(cumulative.toFixed(2)));
        const d = new Date(fill.time);
        labels.push(`${d.getUTCMonth() + 1}/${d.getUTCDate()}`);
    }

    if (data.length === 0) {
        throw new Error(`No closed PnL data in the last ${days} days`);
    }

    const isPositive = cumulative >= 0;

    const config = {
        type: "line",
        data: {
            labels,
            datasets: [{
                label: `PnL (${days}d)`,
                data,
                borderColor: isPositive ? "#00e676" : "#ff1744",
                backgroundColor: isPositive ? "rgba(0,230,118,0.15)" : "rgba(255,23,68,0.15)",
                fill: true,
                tension: 0.2,
                pointRadius: 0,
                borderWidth: 2,
            }],
        },
        options: {
            plugins: {
                title: {
                    display: true,
                    text: `Cumulative PnL (${days}d): $${cumulative.toFixed(2)}`,
                    color: "#e0e0e0",
                    font: { size: 16 },
                },
                legend: { labels: { color: "#e0e0e0" } },
            },
            scales: {
                x: {
                    ticks: { color: "#999", maxTicksLimit: 10, maxRotation: 0 },
                    grid: { color: "rgba(255,255,255,0.05)" },
                },
                y: {
                    ticks: { color: "#999" },
                    grid: { color: "rgba(255,255,255,0.1)" },
                },
            },
        },
    };

    const base64 = await renderChart(config);
    return {
        base64,
        summary: `PnL chart: ${data.length} trades over ${days} days, cumulative $${cumulative.toFixed(2)}`,
    };
}
