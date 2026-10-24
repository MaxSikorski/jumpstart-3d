// The test ports (tools/agent/ports.mjs): the convention 8805, 8815, ... 8895, three ports each (p, p + 1, p + 2), free by a connect and by the .js3d-port claims.
// Real sockets on 127.0.0.1 (ports the OS picks, never the 88xx ones) and real git on a scratch repo; HOME and the git config point at a scratch folder.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as P from "../tools/agent/ports.mjs";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ports-")));
after(() => rmSync(scratch, { recursive: true, force: true }));
writeFileSync(join(scratch, "gitconfig"), "[user]\n\tname = Test Max\n\temail = max@example.test\n[init]\n\tdefaultBranch = main\n");
Object.assign(process.env, { HOME: scratch, USERPROFILE: scratch, GIT_CONFIG_GLOBAL: join(scratch, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1" });

let counter = 0;
const folder = () => { const d = join(scratch, `f${++counter}`); mkdirSync(d); return d; };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

// A server on a port the OS picks; resolves { port, close }.
function listenOn(host) {
  return new Promise((done) => {
    const server = net.createServer((socket) => socket.destroy());
    server.listen(0, host, () => done({ port: server.address().port, close: () => new Promise((closed) => server.close(closed)) }));
  });
}

test("the convention: 8805 to 8895 in steps of 10, three ports each, claims in .js3d-port", () => {
  assert.deepEqual([P.PORT_FIRST, P.PORT_LAST, P.PORT_STEP, P.PORT_SPAN, P.PORT_FILE], [8805, 8895, 10, 3, ".js3d-port"]);
});

test("JS3D_PORT_FIRST moves the whole range (the tests of new-piece and done-piece use it); an unset or bad value changes nothing", () => {
  const ask = (value) => {
    const env = { ...process.env };
    delete env.JS3D_PORT_FIRST;
    if (value !== undefined) env.JS3D_PORT_FIRST = value;
    const code = `import * as P from ${JSON.stringify(new URL("../tools/agent/ports.mjs", import.meta.url).href)}; console.log(JSON.stringify([P.PORT_FIRST, P.PORT_LAST]))`;
    return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], { env, encoding: "utf8" }));
  };
  assert.deepEqual(ask("18805"), [18805, 18895]);
  assert.deepEqual(ask("23000"), [23000, 23090]);
  for (const bad of [undefined, "", "abc", "80", "1.5", "70000"]) assert.deepEqual(ask(bad), [8805, 8895], `${bad}`);
});

test("isListening is a connect: true for a server on 127.0.0.1 and for one on every address, false once it is gone", async () => {
  for (const host of ["127.0.0.1", "0.0.0.0"]) {
    const server = await listenOn(host);
    assert.equal(await P.isListening(server.port), true, host);
    await server.close();
    assert.equal(await P.isListening(server.port), false, `${host} after close`);
  }
});

test("claimedPorts reads the number in each folder's .js3d-port; a missing file, a missing folder and junk claim nothing", () => {
  const [a, b, c, d] = [folder(), folder(), folder(), folder()];
  writeFileSync(join(a, ".js3d-port"), "8815\n");
  writeFileSync(join(b, ".js3d-port"), "8825 # the piece on this branch\n");
  writeFileSync(join(c, ".js3d-port"), "not a port\n");
  assert.deepEqual([...P.claimedPorts([a, b, c, d, join(scratch, "nowhere")])], [8815, 8825]);
  assert.deepEqual([...P.claimedPorts([])], []);
});

test("freePort: the first port where p, p + 1 and p + 2 are all free", async () => {
  const asked = [];
  assert.equal(await P.freePort({ claimed: new Set(), busy: async (p) => { asked.push(p); return false; } }), 8805);
  assert.deepEqual(asked, [8805, 8806, 8807]);
  const busyAt = (...ports) => async (p) => ports.includes(p);
  assert.equal(await P.freePort({ claimed: new Set(), busy: busyAt(8805) }), 8815);
  assert.equal(await P.freePort({ claimed: new Set(), busy: busyAt(8806) }), 8815); // the single-file preview
  assert.equal(await P.freePort({ claimed: new Set(), busy: busyAt(8807) }), 8815); // the mobile server
  assert.equal(await P.freePort({ claimed: new Set(), busy: busyAt(8808, 8804) }), 8805); // outside the three
  assert.equal(await P.freePort({ claimed: new Set(), busy: busyAt(8805, 8816, 8827) }), 8835);
  assert.equal(await P.freePort({ claimed: new Set(), busy: async () => true }), null);
  const lastOnly = async (p) => p < 8895;
  assert.equal(await P.freePort({ claimed: new Set(), busy: lastOnly }), 8895);
});

test("freePort skips a port that a worktree claimed, also when it overlaps by one or two", async () => {
  const free = async () => false;
  assert.equal(await P.freePort({ claimed: new Set([8805]), busy: free }), 8815);
  assert.equal(await P.freePort({ claimed: new Set([8805, 8815, 8825]), busy: free }), 8835);
  assert.equal(await P.freePort({ claimed: new Set([8806]), busy: free }), 8815); // 8806 to 8808 overlaps 8805 to 8807
  assert.equal(await P.freePort({ claimed: new Set([8803]), busy: free }), 8815); // 8803 to 8805 does too
  assert.equal(await P.freePort({ claimed: new Set([8808]), busy: free }), 8805); // 8808 to 8810 does not
  assert.equal(await P.freePort({ claimed: new Set([8802]), busy: free }), 8805); // 8802 to 8804 does not
  const all = new Set(Array.from({ length: 10 }, (_, i) => 8805 + 10 * i));
  assert.equal(await P.freePort({ claimed: all, busy: free }), null);
});

test("freePort({ root }) reads the claims of the main checkout and of every worktree of the repo", async () => {
  const root = folder();
  git(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, "a.txt"), "a\n");
  git(root, "add", "a.txt");
  git(root, "commit", "-q", "-m", "first");
  const wt = join(scratch, "wt-claims");
  git(root, "worktree", "add", "-q", "--no-track", "-b", "claims", wt);
  assert.deepEqual((await P.worktreeFolders(root)).sort(), [root, wt].sort());
  const free = async () => false;
  assert.equal(await P.freePort({ root, busy: free }), 8805);
  writeFileSync(join(wt, ".js3d-port"), "8805\n");
  assert.equal(await P.freePort({ root, busy: free }), 8815);
  writeFileSync(join(root, ".js3d-port"), "8815\n");
  assert.equal(await P.freePort({ root, busy: free }), 8825);
  rmSync(wt, { recursive: true });
  git(root, "worktree", "prune");
  assert.equal(await P.freePort({ root, busy: free }), 8805, "the removed worktree's claim is gone, the main checkout's 8815 stays");
  writeFileSync(join(root, ".js3d-port"), "8805\n");
  assert.equal(await P.freePort({ root, busy: free }), 8815);
  rmSync(join(root, ".js3d-port"));
  assert.equal(await P.freePort({ root, busy: free }), 8805);
  const nowhere = folder();
  assert.deepEqual(await P.worktreeFolders(nowhere), [nowhere], "not a repo: just the folder itself");
});

test("freePort with no arguments connects to the real ports and answers with a port of the convention or null", async () => {
  const port = await P.freePort({ claimed: new Set() });
  assert.ok(port === null || (port >= 8805 && port <= 8895 && (port - 8805) % 10 === 0), String(port));
});
