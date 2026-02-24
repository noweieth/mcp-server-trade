import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { server } from "./mcp_server.js";

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`Trading MCP Server on Hyperliquid is running...`);
}

main().catch((error) => {
    console.error("Error starting server:", error);
    process.exit(1);
});
