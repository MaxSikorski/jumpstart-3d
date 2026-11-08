// Page-local agent checkpoints; the store owns undo and document notifications.
import { designDiff } from "./designdiff.js";

export function historyCalls({ store, snapshot, edit }) {
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
      if (typeof label !== "string") throw new Error("checkpoint label must be a string");
      const doc = structuredClone(snapshot());
      const saved = { id: "c" + ++serial, label, bodies: doc.bodies.length, at: new Date().toISOString(), doc };
      kept.push(saved);
      if (kept.length > 20) kept.shift();
      return metadata(saved);
    },
    checkpoints: () => kept.map(metadata),
    diff(fromId, toId) { return designDiff(find(fromId).doc, toId === undefined ? snapshot() : find(toId).doc); },
    rollback(id) {
      edit();
      const saved = find(id);
      if (saved.doc.id !== store.doc.id) throw new Error(`checkpoint ${id} belongs to another design; checkpoints are kept per design`);
      store.update((doc) => {
        for (const key of Object.keys(doc)) delete doc[key];
        Object.assign(doc, structuredClone(saved.doc));
      }, "Roll back to " + id + (saved.label ? ": " + saved.label : ""));
      return metadata(saved);
    },
  };
}
