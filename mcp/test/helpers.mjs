// Shared by the mcp tests: start the real server over stdio with the SDK's client, and small readers for its answers.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

export const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));
export const DOCS = fileURLToPath(new URL("../../docs/", import.meta.url)); // the built site: run node build.mjs first
export const DEMO = fileURLToPath(new URL("../../tools/bridge-demo.js", import.meta.url));

export async function startServer(env = {}) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env, JS3D_APP: DOCS, ...env }, stderr: "pipe" });
  const log = [];
  transport.stderr.on("data", (d) => log.push(String(d)));
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  return { client, log, close: () => client.close() };
}
export const call = (client, name, args = {}) => client.callTool({ name, arguments: args });
// the JSON in a tool's text answer
export const data = (r) => { if (r.isError) throw new Error("tool error: " + r.content[0].text); return JSON.parse(r.content[0].text); };
export const pngWidth = (buf) => buf.readUInt32BE(16); // IHDR: width comes right after the 8-byte signature and the chunk header
export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
