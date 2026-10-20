#!/usr/bin/env node

import { randomUUID } from "node:crypto";
const endpoint = process.env.JUMPSTART_MCP_HTTP_URL || "http://127.0.0.1:3210/__mcp/rpc";
const clientEndpoint = new URL("/__mcp/client", endpoint);
const clientId = randomUUID();
let stopped = false;
async function lease(state) {
  try { await fetch(clientEndpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId, state }), signal: AbortSignal.timeout(2000) }); } catch { /* A disconnected proxy expires at the server. */ }
}
await lease("connect");
let renewing = null;
const leaseTimer = setInterval(() => { if (!stopped && !renewing) renewing = lease("heartbeat").finally(() => { renewing = null; }); }, 5000);
async function disconnect() { stopped = true; clearInterval(leaseTimer); await renewing; await lease("disconnect"); }
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { void disconnect().finally(() => process.exit(0)); });
const pending = new Set();
let inputBuffer = "";

async function forward(line) {
  let message;
  try { message = JSON.parse(line); }
  catch {
    process.stderr.write("JumpStart MCP proxy received invalid JSON\n");
    return;
  }
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
    });
    if (message.method?.startsWith("notifications/")) return;
    if (!response.ok) throw new Error(`JumpStart MCP bridge returned HTTP ${response.status}`);
    process.stdout.write(`${JSON.stringify(await response.json())}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  inputBuffer += chunk;
  const lines = inputBuffer.split(/\r?\n/);
  inputBuffer = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const task = forward(line);
    pending.add(task);
    task.finally(() => pending.delete(task));
  }
});
process.stdin.on("end", async () => {
  if (inputBuffer.trim()) await forward(inputBuffer);
  await Promise.allSettled([...pending]);
  await disconnect();
});
