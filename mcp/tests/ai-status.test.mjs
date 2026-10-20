import test from "node:test";
import assert from "node:assert/strict";
import { agentStatus } from "../browser/ai-status.js";
import { clientPresence } from "../server/presence.mjs";

test("editor online is waiting, not proof of an AI client connection", () => {
  assert.equal(agentStatus({ online: true }).state, "waiting");
  assert.equal(agentStatus({ online: true, connected: true }).state, "connected");
  assert.equal(agentStatus({ online: true, recent: true }).state, "recent");
  assert.equal(agentStatus({ checking: true }).state, "checking");
  assert.equal(agentStatus({ online: false, connected: true }).state, "offline");
});
test("reading, previewing, changing, completion and failures have distinct truthful labels", () => {
  const input = { online: true, connected: true };
  for (const action of ["get_document", "inspect_geometry", "select_geometry"]) assert.equal(agentStatus({ ...input, action }).state, "reading");
  for (const action of ["preview_model", "preview_parameters", "preview_new_document"]) assert.equal(agentStatus({ ...input, action }).state, "previewing");
  for (const action of ["apply_model", "undo", "reopen_document"]) assert.equal(agentStatus({ ...input, action }).state, "editing");
  assert.equal(agentStatus({ ...input, outcome: "apply_model" }).compact, "AI updated");
  assert.equal(agentStatus({ ...input, outcome: "no_change" }).compact, "AI unchanged");
  assert.equal(agentStatus({ ...input, error: "Invalid plan" }).state, "error");
  assert.match(agentStatus({ ...input, error: "Invalid plan" }).detail, /Invalid plan/);
});
test("presence distinguishes leases, stateless activity, disconnect and lease expiry", () => {
  let now = 0;
  const presence = clientPresence(() => now);
  assert.deepEqual(presence.status(), { clientConnected: false, recentClientActivity: false });
  presence.activity(); assert.deepEqual(presence.status(), { clientConnected: false, recentClientActivity: true });
  presence.lease("one", "connect"); assert.equal(presence.status().clientConnected, true);
  presence.lease("one", "disconnect"); assert.equal(presence.status().clientConnected, false);
  presence.lease("one", "connect"); now = 14000; presence.lease("one", "heartbeat"); now = 16000;
  assert.deepEqual(presence.status(), { clientConnected: true, recentClientActivity: false });
  now = 29000; assert.equal(presence.status().clientConnected, false);
  presence.stdioConnected(); assert.equal(presence.status().clientConnected, true);
});
