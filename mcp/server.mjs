#!/usr/bin/env node
// The MCP server for JumpStart 3D (stdio). See README.md. stdout belongs to the protocol: log to stderr only.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { Session, HELP } from "./session.mjs";
import { registerTools } from "./tools.mjs";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
let session;
try { session = Session.fromEnv(); } catch (e) { console.error("jumpstart-mcp: " + e.message); process.exit(2); }
await session.start();

const server = new McpServer({ name: "jumpstart-3d", version });
registerTools(server, session);
await server.connect(new StdioServerTransport());

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await session.close().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.stdin.on("end", shutdown);
process.stdin.on("close", shutdown);
