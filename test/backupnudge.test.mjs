// The single file's backup reminder (src/backupnudge.js): the rule for when to ask, and the stored answers. The note itself is backupnudge.spec.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldAsk, readState, writeState, KEY, DAY } from "../src/backupnudge.js";

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);
const H = 3600 * 1000;
const d = (id, updated) => ({ id, updated });
const ask = (over) => shouldAsk({ now: NOW, online: true, designs: [d("a", NOW - H)], state: {}, folderFiles: null, ...over });
const memory = (init) => { const m = new Map(Object.entries(init || {})); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, m }; };

test("a first time with designs asks, and says how many designs there are", () => {
  const r = ask({ designs: [d("a", NOW - H), d("b", NOW - 5 * DAY)] });
  assert.deepEqual(r, { ask: true, n: 2, changed: 2 });
});

test("it never asks offline, with no designs, or after Don't ask again", () => {
  assert.equal(ask({ online: false }).ask, false);
  assert.equal(ask({ designs: [] }).ask, false);
  assert.equal(ask({ designs: null }).ask, false);
  assert.equal(ask({ state: { never: true } }).ask, false);
  assert.equal(ask({ state: { never: true, asked: NOW - 30 * DAY } }).ask, false);
});

test("at most once a day, counted from when the note was last shown", () => {
  assert.equal(ask({ state: { asked: NOW - 23 * H } }).ask, false);
  assert.equal(ask({ state: { asked: NOW - DAY + 1 } }).ask, false);
  assert.equal(ask({ state: { asked: NOW - DAY } }).ask, true);
  assert.equal(ask({ state: { asked: NOW - 3 * DAY } }).ask, true);
});

test("a clock set back (asked in the future) does not silence it for good", () => {
  assert.equal(ask({ state: { asked: NOW + 40 * DAY } }).ask, true);
});

test("designs not changed since the last backup are not asked about", () => {
  const designs = [d("a", NOW - 3 * DAY), d("b", NOW - 2 * DAY)];
  assert.equal(ask({ designs, state: { backedUp: NOW - DAY } }).ask, false);
  const r = ask({ designs: [...designs, d("c", NOW - H)], state: { backedUp: NOW - DAY } });
  assert.deepEqual(r, { ask: true, n: 3, changed: 1 });
  assert.equal(ask({ designs, state: { backedUp: NOW - 2 * DAY - H } }).changed, 1, "b changed after that backup");
});

test("Not now waits for a change: the last answer counts like a backup", () => {
  const state = { answered: NOW - 2 * DAY, asked: NOW - 2 * DAY };
  assert.equal(ask({ designs: [d("a", NOW - 3 * DAY)], state }).ask, false, "a day has passed but nothing changed");
  assert.equal(ask({ designs: [d("a", NOW - 3 * DAY), d("new", NOW - DAY)], state }).ask, true, "a new design");
  assert.equal(ask({ designs: [d("a", NOW - H)], state }).ask, true, "an edited design");
  assert.equal(ask({ designs: [d("a", NOW - H)], state: { ...state, asked: NOW - H } }).ask, false, "changed, but asked an hour ago");
});

test("the later of the backup and the answer is the line", () => {
  const designs = [d("a", NOW - 2 * DAY)];
  assert.equal(ask({ designs, state: { backedUp: NOW - 3 * DAY, answered: NOW - DAY } }).ask, false);
  assert.equal(ask({ designs, state: { backedUp: NOW - DAY, answered: NOW - 3 * DAY } }).ask, false);
  assert.equal(ask({ designs, state: { backedUp: NOW - 3 * DAY, answered: NOW - 4 * DAY } }).ask, true);
});

test("a design whose folder copy is as new as it is counts as backed up", () => {
  const designs = [d("a", NOW - H), d("b", NOW - H)];
  const files = { a: { file: "a-a.json", updated: NOW - H }, b: { file: "b-b.json", updated: NOW - 2 * H } };
  assert.deepEqual(ask({ designs, folderFiles: files }), { ask: true, n: 2, changed: 1 }, "b has an older copy");
  assert.equal(ask({ designs: [designs[0]], folderFiles: files }).ask, false);
  assert.equal(ask({ designs: [designs[0]], folderFiles: { a: { updated: NOW } } }).ask, false, "a newer copy is fine too");
});

test("a design with no usable time is asked about, never skipped", () => {
  for (const updated of [undefined, null, 0, NaN, "soon"]) assert.equal(ask({ designs: [d("a", updated)], state: { backedUp: NOW } }).ask, true, String(updated));
});

test("rubbish in the stored state is ignored, not trusted", () => {
  for (const state of [null, undefined, "x", 7, { asked: "yesterday", backedUp: -5, answered: NaN, never: "yes" }]) {
    assert.equal(ask({ state }).ask, true, JSON.stringify(state));
  }
  const m = memory({ [KEY]: '{"asked":"x","backedUp":12,"never":"true","extra":1}' });
  assert.deepEqual(readState(m), { backedUp: 12, answered: 0, asked: 0, never: false });
  assert.deepEqual(readState(memory({ [KEY]: "not json" })), {});
  assert.deepEqual(readState(memory()), {});
  assert.deepEqual(readState(memory({ [KEY]: "null" })), {});
});

test("storage that throws never throws out of the reminder", () => {
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); } };
  assert.deepEqual(readState(broken), {});
  assert.equal(writeState(broken, { never: true }), false);
});

test("writeState keeps what is there and changes only what it is given", () => {
  const m = memory();
  assert.equal(writeState(m, { asked: 5 }), true);
  writeState(m, { never: true });
  writeState(m, { answered: 9, asked: 0 });
  assert.deepEqual(readState(m), { backedUp: 0, answered: 9, asked: 0, never: true });
  assert.deepEqual(JSON.parse(m.getItem(KEY)).never, true);
});
