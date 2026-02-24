/**
 * HTTP Server entry point — runs MCP over SSE on localhost.
 * Usage: npx tsx src/http_server.ts [port]
 * Default port: 3000
 *
 * Endpoints:
 *   GET  /sse       → SSE stream (client connects here)
 *   POST /messages   → JSON-RPC messages from client
 *   GET  /health     → Health check
 */
import "dotenv/config";
import http from "node:http";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { server } from "./mcp_server.js";

const PORT = parseInt(process.argv[2] || "3000", 10);

// Store active transports by session
const transports = new Map<string, SSEServerTransport>();

function parseBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
            catch (e) { reject(e); }
        });
        req.on("error", reject);
    });
}

const httpServer = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url || "/", `http://localhost:${PORT}`);

    // Health check
    if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            status: "ok",
            server: "trading-mcp-server",
            tools: 55,
            activeSessions: transports.size,
        }));
        return;
    }

    // SSE endpoint — establish stream
    if (req.method === "GET" && url.pathname === "/sse") {
        console.log("[SSE] New client connecting...");
        const transport = new SSEServerTransport("/messages", res);
        const sessionId = transport.sessionId;
        transports.set(sessionId, transport);

        transport.onclose = () => {
            console.log(`[SSE] Session ${sessionId} closed`);
            transports.delete(sessionId);
        };

        await server.connect(transport);
        console.log(`[SSE] Session ${sessionId} established ✓`);
        return;
    }

    // Messages endpoint — receive JSON-RPC
    if (req.method === "POST" && url.pathname === "/messages") {
        const sessionId = url.searchParams.get("sessionId");
        if (!sessionId) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing sessionId" }));
            return;
        }

        const transport = transports.get(sessionId);
        if (!transport) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Session not found" }));
            return;
        }

        const body = await parseBody(req);
        await transport.handlePostMessage(req, res, body);
        return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found", endpoints: ["/sse", "/messages", "/health"] }));
});

httpServer.listen(PORT, () => {
    console.log(`\n🚀 Trading MCP Server running on http://localhost:${PORT}`);
    console.log(`   ├── SSE stream:   GET  http://localhost:${PORT}/sse`);
    console.log(`   ├── Messages:     POST http://localhost:${PORT}/messages`);
    console.log(`   └── Health check: GET  http://localhost:${PORT}/health\n`);
});

process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    for (const [id, transport] of transports) {
        await transport.close();
        transports.delete(id);
    }
    httpServer.close();
    process.exit(0);
});
