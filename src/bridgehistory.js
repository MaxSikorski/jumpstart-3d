// Page-local agent checkpoints; the store owns undo and document notifications.
import { designDiff } from "./designdiff.js";

export function historyCalls({ store, snapshot, edit, app }) {
  const kept = [];
  let serial = 0;
  const metadata = ({ id, label, bodies, at }) => ({ id, label, bodies, at });
  const find = (id) => {
    const saved = kept.find((c) => c.id === id);
    if (!saved) throw new Error(`no checkpoint "${id}"; ${kept.length ? "checkpoints: " + kept.map((c) => c.id).join(", ") : "none yet: call checkpoint first"}`);
    return saved;
  };
  return {
    checkpoint(label = "") {
      edit();
      if (typeof label !== "string") throw new Error("checkpoint label must be a string");
      if (label.length > 200) throw new Error("checkpoint label must be 200 characters or fewer");
      const doc = snapshot({ shareAssets: true });
      const saved = { id: "c" + ++serial, label, bodies: doc.bodies.length, at: new Date().toISOString(), doc };
      kept.push(saved);
      if (kept.length > 20) kept.shift();
      return metadata(saved);
    },
    checkpoints: () => kept.map(metadata),
    diff(fromId, toId) {
      const from = find(fromId), to = toId === undefined ? null : find(toId);
      for (const [id, c] of [[fromId, from], [toId, to]]) if (c && c.doc.id !== store.doc.id) throw new Error(`checkpoint ${id} belongs to another design; checkpoints are kept per design`);
      return designDiff(from.doc, to ? to.doc : snapshot({ shareAssets: true }));
    },
    rollback(id) {
      edit();
      const saved = find(id);
      if (saved.doc.id !== store.doc.id) throw new Error(`checkpoint ${id} belongs to another design; checkpoints are kept per design`);
      if (app && app.simLock) throw new Error("undo is off in the 3D Print Sim");
      const { assets, ...rest } = saved.doc, copy = structuredClone(rest);
      store.update((doc) => {
        const mode = doc.mode;
        for (const key of Object.keys(doc)) delete doc[key];
        for (const key of Object.keys(copy)) if (key !== "__proto__") doc[key] = copy[key];
        if (assets) doc.assets = { ...assets };
        if (mode !== undefined) doc.mode = mode;
      }, "Roll back to " + id + (saved.label ? ": " + saved.label : ""));
      return metadata(saved);
    },
  };
}
