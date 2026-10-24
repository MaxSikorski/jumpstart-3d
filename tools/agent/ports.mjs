// The test ports, in one place. The convention (testing.md): JS3D_PORT is a free port from 8805 in steps of 10 (8805, 8815, ... 8895).
// A port p stands for three: p (playwright.config.mjs: the site server), p + 1 (the single-file preview in .claude/launch.json)
// and p + 2 (the mobile project's gzip server).
// Free means two things. Nothing answers a connect to 127.0.0.1 on any of the three (a connect, not a bind: on macOS a bind can
// succeed on a port that a wildcard listener already holds, and Playwright reuses a server it finds, so a busy port would test
// another checkout's site). And no worktree claims it in its `.js3d-port` file (a number on the first line, written by
// new-piece.mjs and ignored by git), because a fresh worktree may not have started its server yet.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";

export const PORT_FIRST = 8805;
export const PORT_LAST = 8895;
export const PORT_STEP = 10;
export const PORT_SPAN = 3;
export const PORT_FILE = ".js3d-port";

// True when something answers on the port, or when it does not answer at all; false only when the connection is refused.
export function isListening(port, host = "127.0.0.1", timeout = 500) {
  return new Promise((done) => {
    const socket = net.connect({ port, host });
    const finish = (busy) => { socket.destroy(); done(busy); };
    socket.setTimeout(timeout);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(true));
    socket.once("error", (e) => finish(e.code !== "ECONNREFUSED"));
  });
}

// The numbers written in the .js3d-port files of these folders (a folder without the file, or with anything else in it, claims nothing).
export function claimedPorts(folders) {
  const claimed = new Set();
  for (const dir of folders) {
    try {
      const n = Number.parseInt(readFileSync(join(dir, PORT_FILE), "utf8"), 10);
      if (Number.isInteger(n)) claimed.add(n);
    } catch { /* no claim here */ }
  }
  return claimed;
}

// The folders of every worktree of the repo that contains root, the main checkout included (just root when git cannot say).
export function worktreeFolders(root) {
  return new Promise((done) => {
    execFile("git", ["worktree", "list", "--porcelain"], { cwd: root, encoding: "utf8" }, (err, out) => {
      done(err ? [root] : [...out.matchAll(/^worktree (.+)$/gm)].map((m) => m[1]));
    });
  });
}

// The first port of the convention that is free (see above) or null. claimed = a Set of claimed ports, or root = a repo to read the claims from;
// busy(port) is the connect check (a test passes its own).
export async function freePort({ root, claimed, busy = isListening } = {}) {
  const taken = claimed ?? claimedPorts(root ? await worktreeFolders(root) : []);
  for (let p = PORT_FIRST; p <= PORT_LAST; p += PORT_STEP) {
    if ([...taken].some((c) => c < p + PORT_SPAN && c + PORT_SPAN > p)) continue; // a claimed port's three overlap this port's three
    let free = true;
    for (let i = 0; i < PORT_SPAN && free; i++) free = !(await busy(p + i));
    if (free) return p;
  }
  return null;
}
