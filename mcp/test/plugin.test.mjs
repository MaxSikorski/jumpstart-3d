// The Claude Code plugin files in mcp/ and the marketplace file at the repository root agree with each other.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const MCP = resolve(fileURLToPath(new URL("..", import.meta.url)));
const json = (...p) => JSON.parse(readFileSync(resolve(MCP, ...p), "utf8"));
const plugin = json(".claude-plugin", "plugin.json");
const market = json("..", ".claude-plugin", "marketplace.json");
const mcpJson = json(".mcp.json");
const text = (...p) => readFileSync(resolve(MCP, ...p), "utf8");

test("the plugin, the marketplace entry and the skill share one name", () => {
  assert.equal(plugin.name, "jumpstart-3d");
  assert.equal(market.name, "maxsikorski");
  assert.equal(market.plugins.length, 1);
  assert.equal(market.plugins[0].name, plugin.name);
  assert.equal(resolve(MCP, "..", market.plugins[0].source), MCP); // the plugin root is mcp/
  assert.ok(existsSync(resolve(MCP, "skills", plugin.name, "SKILL.md")));
});

test(".mcp.json starts a server file that exists in the plugin folder", () => {
  const server = mcpJson.mcpServers["jumpstart-3d"];
  assert.equal(server.command, "node");
  const [arg] = server.args;
  assert.ok(arg.startsWith("${CLAUDE_PLUGIN_ROOT}/"), arg);
  assert.ok(existsSync(resolve(MCP, arg.replace("${CLAUDE_PLUGIN_ROOT}/", ""))));
});

test("the plugin folder installs by itself: package.json, lockfile, no workspaces", () => {
  const pkg = json("package.json");
  assert.equal(pkg.workspaces, undefined);
  assert.ok(existsSync(resolve(MCP, "package-lock.json")));
  for (const [name, version] of Object.entries(pkg.dependencies)) assert.match(version, /^\d+\.\d+\.\d+$/, name + " must be pinned exactly");
  for (const bin of Object.values(pkg.bin)) assert.ok(existsSync(resolve(MCP, bin)), bin);
});

test("SKILL.md has a name and a description under 1,000 characters, in frontmatter YAML can read", () => {
  const skill = text("skills", plugin.name, "SKILL.md");
  const m = /^---\n([\s\S]*?)\n---\n/.exec(skill);
  assert.ok(m, "frontmatter");
  const field = (k) => {
    const v = new RegExp("^" + k + ": (.+)$", "m").exec(m[1])?.[1];
    if (v === undefined) return v;
    const quoted = /^"((?:[^"\\]|\\.)*)"$/.exec(v);
    if (quoted) return JSON.parse(v); // a double-quoted YAML string is a JSON string here
    assert.ok(!v.includes(": ") && !v.includes(" #") && !/^["'\[{&*!|>%@`]/.test(v), k + " has a colon or other YAML syntax and needs double quotes: " + v);
    return v;
  };
  assert.equal(field("name"), plugin.name);
  const description = field("description");
  assert.ok(description && description.length > 20 && description.length < 1000, "description length " + description?.length);
  assert.ok(skill.split("\n").length < 150);
});

test("every Chromium install line in the docs names the Playwright version the plugin pins", () => {
  const pin = json("package.json").dependencies.playwright;
  for (const file of [["..", "README.md"], ["README.md"], ["AGENT-SETUP.md"], ["skills", plugin.name, "SKILL.md"], ["cli.mjs"]]) {
    const doc = text(...file);
    assert.doesNotMatch(doc, /npx playwright install/, file.join("/") + ": a bare \"npx playwright install\" fetches the newest browser, not the one this version drives");
    assert.ok(/npx playwright@/.test(doc) || file[0] === "..", file.join("/") + " should say how to install Chromium");
    for (const [, v] of doc.matchAll(/npx playwright@([^\s]+) install/g)) assert.equal(v, pin, file.join("/"));
  }
});

test("the root @playwright/test is the same version as mcp's playwright (CI installs the browser from the root)", () => {
  assert.equal(json("..", "package.json").devDependencies["@playwright/test"], json("package.json").dependencies.playwright);
});

test("the skill at the repository root is byte-identical to the plugin's (npx skills add and other agents read the root one)", () => {
  const root = readFileSync(resolve(MCP, "..", "skills", plugin.name, "SKILL.md"));
  assert.ok(root.equals(readFileSync(resolve(MCP, "skills", plugin.name, "SKILL.md"))), "copy mcp/skills/jumpstart-3d/SKILL.md to skills/jumpstart-3d/SKILL.md");
});

test("the one-line setup prompt is in both READMEs and the About dialog, and AGENT-SETUP.md is short", () => {
  const prompt = "Read https://raw.githubusercontent.com/MaxSikorski/jumpstart-3d/main/mcp/AGENT-SETUP.md and set it up for me.";
  for (const file of [["README.md"], ["..", "README.md"], ["..", "src", "app.js"]]) assert.ok(text(...file).includes(prompt), file.join("/") + " should carry the setup prompt");
  const setup = text("AGENT-SETUP.md");
  assert.ok(setup.trimEnd().split("\n").length <= 140, "AGENT-SETUP.md must stay within 140 lines");
});
