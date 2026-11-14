// Page-local agent checkpoints; the store owns undo and document notifications.
import { show } from "./teach.js";
import { designDiff } from "./designdiff.js";

export function historyCalls({ store, snapshot, edit, app }) {
  const kept = [];
  let serial = 0;
  const metadata = ({ id, label, bodies, at }) => ({ id, label, bodies, at });
  const find = (id) => {
    const saved = kept.find((c) => c.id === id);
    if (!saved) throw new Error(`no checkpoint ${show(id)}. ${!kept.length ? "There are none; call JS3D.checkpoint() first." : kept.length <= 8 ? `Retained checkpoint ids: ${kept.map((c) => c.id).join(", ")}.` : `${kept.length} checkpoints are retained; call JS3D.checkpoints() to see their ids.`}`);
    return saved;
  };
  return {
    checkpoint(label = "") {
      edit();
      if (typeof label !== "string") throw new Error(`checkpoint label must be a string, got ${show(label)}. Try "before edits".`);
      if (label.length > 200) throw new Error(`checkpoint label must be 200 characters or fewer, got ${show(label)}. Use a shorter label.`);
      const doc = snapshot({ shareAssets: true });
      const saved = { id: "c" + ++serial, label, bodies: doc.bodies.length, at: new Date().toISOString(), doc };
      kept.push(saved);
      if (kept.length > 20) kept.shift();
      return metadata(saved);
    },
    checkpoints: () => kept.map(metadata),
    diff(fromId, toId) {
      const from = find(fromId), to = toId === undefined ? null : find(toId);
      for (const [id, c] of [[fromId, from], [toId, to]]) if (c && c.doc.id !== store.doc.id) throw new Error(`checkpoint ${show(id)} belongs to another design; checkpoints are kept per design. Switch back to its original design, or call JS3D.checkpoint() to make one for this design.`);
      return designDiff(from.doc, to ? to.doc : snapshot({ shareAssets: true }));
    },
    rollback(id) {
      edit();
      const saved = find(id);
      if (saved.doc.id !== store.doc.id) throw new Error(`checkpoint ${show(id)} belongs to another design; checkpoints are kept per design. Switch back to its original design, or call JS3D.checkpoint() to make one for this design.`);
      if (app && app.simLock) throw new Error("undo is off in the 3D Print Sim. Close the 3D Print Sim and retry.");
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
