#!/usr/bin/env node
// Compatibility entry point; implementation and exports live under mcp/.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../mcp/benchmarks/agent-runner.mjs";
export * from "../mcp/benchmarks/agent-runner.mjs";
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
