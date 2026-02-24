/**
 * AIXBT Terminal API — Sentiment & News Signals
 * 
 * Provides aggregated crypto market signals from multiple Twitter/X clusters:
 * whale activity, market events, token economics, risk alerts, etc.
 */

const AIXBT_BASE_URL = "https://api.aixbt.tech/terminal/summaries";

// All available signal categories
const ALL_CATEGORIES = [
    "FINANCIAL_EVENT", "TOKEN_ECONOMICS", "TECH_EVENT", "MARKET_ACTIVITY",
    "ONCHAIN_METRICS", "PARTNERSHIP", "TEAM_UPDATE", "REGULATORY",
    "WHALE_ACTIVITY", "RISK_ALERT", "VISIBILITY_EVENT", "OPINION_SPECULATION"
] as const;

// Default cluster IDs (all clusters)
const DEFAULT_CLUSTERS = [
    "67ffa0cdd37b7e33fb723568", "67ffa0cdd37b7e33fb72357c", "67ffa0cdd37b7e33fb723574",
    "67ffa0cdd37b7e33fb723560", "67ffa0cdd37b7e33fb723569", "67ffa0cdd37b7e33fb723561",
    "67ffa0cdd37b7e33fb723577", "67ffa0cdd37b7e33fb723575", "67ffa0cdd37b7e33fb723565",
    "67ffa0cdd37b7e33fb723566", "67ffa0cdd37b7e33fb72356c", "67ffa0cdd37b7e33fb72356e",
    "67ffa0cdd37b7e33fb723570", "67ffa0cdd37b7e33fb723576", "67ffa0cdd37b7e33fb72357a",
    "67ffa0cdd37b7e33fb723562", "67ffa0cdd37b7e33fb72356b", "67ffa0cdd37b7e33fb72357e",
    "67ffa0cdd37b7e33fb72357f", "67ffa0cdd37b7e33fb723585", "67ffa0cdd37b7e33fb72358a",
    "67ffa0cdd37b7e33fb72356a", "67ffa0cdd37b7e33fb723581", "67ffa0cdd37b7e33fb723584",
    "67ffa0cdd37b7e33fb723586", "67ffa0cdd37b7e33fb723571", "67ffa0cdd37b7e33fb723579",
    "67ffa0cdd37b7e33fb72357b", "67ffa0cdd37b7e33fb72358d", "67ffa0cdd37b7e33fb723564",
    "67ffa0cdd37b7e33fb723572", "67ffa0cdd37b7e33fb723567", "67ffa0cdd37b7e33fb72356d",
    "67ffa0cdd37b7e33fb723582", "67ffa0cdd37b7e33fb72358b", "67ffa0cdd37b7e33fb723563",
    "67ffa0cdd37b7e33fb72356f", "67ffa0cdd37b7e33fb723573", "67ffa0cdd37b7e33fb72357d",
    "67ffa0cdd37b7e33fb723580", "67ffa0cdd37b7e33fb723583", "67ffa0cdd37b7e33fb723588",
    "67ffa0cdd37b7e33fb723578", "67ffa0cdd37b7e33fb723587", "67ffa0cdd37b7e33fb723589",
    "67ffa0cdd37b7e33fb72358c"
];

export type SignalCategory = typeof ALL_CATEGORIES[number];

interface SignalCluster {
    id: string;
    name: string;
}

interface SignalActivity {
    date: string;
    source: string;
    cluster: SignalCluster;
    incoming: string;
    result: string;
}

interface RawSignal {
    id: string;
    detectedAt: string;
    reinforcedAt: string;
    description: string;
    projectName: string;
    projectId: string;
    category: SignalCategory;
    officialSources: string[];
    clusters: SignalCluster[];
    activity: SignalActivity[];
}

interface ProcessedSignal {
    id: string;
    project: string;
    category: string;
    description: string;
    detectedAt: string;
    reinforcedAt: string;
    clusterCount: number;
    clusters: string[];
    activityCount: number;
    ageMinutes: number;
}

// ─── Core API ─────────────────────────────────────────────

async function fetchSignals(
    categories: string[],
    hot: boolean = true
): Promise<RawSignal[]> {
    const params = new URLSearchParams();
    params.set("categories", categories.join(","));
    params.set("clusters", DEFAULT_CLUSTERS.join(","));
    if (hot) params.set("hot", "true");

    const url = `${AIXBT_BASE_URL}/signals?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`AIXBT API error: ${res.status} ${res.statusText}`);
    return await res.json() as RawSignal[];
}

function processSignal(raw: RawSignal): ProcessedSignal {
    const now = Date.now();
    const detectedMs = new Date(raw.detectedAt).getTime();
    return {
        id: raw.id,
        project: raw.projectName,
        category: raw.category,
        description: raw.description,
        detectedAt: raw.detectedAt,
        reinforcedAt: raw.reinforcedAt,
        clusterCount: raw.clusters.length,
        clusters: raw.clusters.map(c => c.name),
        activityCount: raw.activity.length,
        ageMinutes: Math.round((now - detectedMs) / 60000),
    };
}

// ─── Exported Tools ───────────────────────────────────────

/**
 * Get hot market signals across all categories.
 * Returns condensed signals sorted by recency.
 */
export async function getMarketSignals(
    limit: number = 30
): Promise<{
    fetchedAt: string;
    totalSignals: number;
    signals: ProcessedSignal[];
}> {
    const raw = await fetchSignals([...ALL_CATEGORIES], true);
    const signals = raw
        .map(processSignal)
        .sort((a, b) => new Date(b.reinforcedAt).getTime() - new Date(a.reinforcedAt).getTime())
        .slice(0, limit);

    return {
        fetchedAt: new Date().toISOString(),
        totalSignals: raw.length,
        signals,
    };
}

/**
 * Get signals filtered by specific categories.
 */
export async function getSignalsByCategory(
    categories: string[],
    limit: number = 20
): Promise<{
    fetchedAt: string;
    categories: string[];
    totalSignals: number;
    signals: ProcessedSignal[];
}> {
    const validCategories = categories.filter(c =>
        ALL_CATEGORIES.includes(c as SignalCategory)
    );
    if (validCategories.length === 0) {
        throw new Error(`Invalid categories. Valid: ${ALL_CATEGORIES.join(", ")}`);
    }

    const raw = await fetchSignals(validCategories, true);
    const signals = raw
        .map(processSignal)
        .sort((a, b) => new Date(b.reinforcedAt).getTime() - new Date(a.reinforcedAt).getTime())
        .slice(0, limit);

    return {
        fetchedAt: new Date().toISOString(),
        categories: validCategories,
        totalSignals: raw.length,
        signals,
    };
}

/**
 * Get signals for a specific project/token (e.g. "bitcoin", "ethereum", "solana").
 */
export async function getSignalsByProject(
    projectName: string,
    limit: number = 20
): Promise<{
    fetchedAt: string;
    project: string;
    totalSignals: number;
    signals: ProcessedSignal[];
}> {
    const raw = await fetchSignals([...ALL_CATEGORIES], true);
    const filtered = raw
        .filter(s => s.projectName.toLowerCase() === projectName.toLowerCase())
        .map(processSignal)
        .sort((a, b) => new Date(b.reinforcedAt).getTime() - new Date(a.reinforcedAt).getTime())
        .slice(0, limit);

    return {
        fetchedAt: new Date().toISOString(),
        project: projectName,
        totalSignals: filtered.length,
        signals: filtered,
    };
}
