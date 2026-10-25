// jumpstart-3d: keep editable pieces only when a cut creates new disconnected solids.
import { store, findBody, nextSeq } from "./store.js";
import { clone, uid } from "./util.js";
import { isNearEmpty } from "./pieces.js";

export function shouldSplitCombine({ op, beforeCount, afterCount, hasNonSolidFaces = false, isGroup = false, hasHoles = false }) {
  if (hasNonSolidFaces || !Number.isInteger(beforeCount) || beforeCount < 1 || !Number.isInteger(afterCount) || afterCount <= beforeCount) return false;
  return isGroup ? hasHoles : beforeCount === 1 && (op === "cut" || op === "intersect");
}

// Indexes of the solids worth keeping as bodies: a cut can leave a film or sliver of almost no thickness next to the real part
// (see pieces.js). If nothing qualifies or the measurements are missing, every piece stays.
export function significantPieces(volumes, areas, count) {
  const all = Array.from({ length: count }, (_, i) => i);
  if (!Array.isArray(volumes) || volumes.length !== count || !Array.isArray(areas) || areas.length !== count) return all;
  const keep = all.filter(i => !isNearEmpty(volumes[i], areas[i]));
  return keep.length ? keep : all;
}

export function hasLaterKeepPiece(mods = [], modId) {
  const index = mods.findIndex(m => m.id === modId && m.src === "combine");
  return index >= 0 && mods.slice(index + 1).some(m => m.t === "keeppiece" && !m.sole);
}

export async function commitCombine(app, prepare, label, { target, op } = {}) {
  const source = store.doc, mode = app.mode, command = app.command, proposed = clone(source);
  let staged = null;
  const current = () => store.doc === source && app.mode === mode && app.command === command && store.preview === staged;
  const built = async (body) => {
    const deadline = Date.now() + 130000;
    while (true) {
      if (!current()) throw new Error(`${label} cancelled because the design changed. Try again.`);
      if (!body._key) throw new Error(app.scene.errors.get(body.id) || `${label} could not build this body.`);
      const result = app.kernel.get(body._key);
      if (result) {
        if (!result.ok) throw new Error(result.error);
        return result;
      }
      if (Date.now() > deadline) throw new Error(`${label} took too long. Try again.`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };
  // Until the atomic commit lands, store.doc still holds the inputs: tell waiters (tests, JS3D.ready) the app is busy.
  const scene = app.scene;
  scene.holdBusy = (scene.holdBusy || 0) + 1;
  try {
    const id = prepare(proposed);
    if (!id) return [];
    const result = findBody(proposed, id);
    const isGroup = !target && result.node.t === "group";
    const hasHoles = isGroup && result.node.children.some(c => c.hole);
    const stage = doc => {
      // A resolution failure must not reuse the cloned body's previous mesh key.
      for (const b of doc.bodies) delete b._key;
      staged = doc;
      store.setTransient(doc);
    };
    let before;
    if (hasHoles || target && (op === "cut" || op === "intersect")) {
      const baseline = clone(isGroup ? proposed : source);
      const body = findBody(baseline, isGroup ? id : target);
      if (isGroup) body.node.children = body.node.children.filter(c => !c.hole);
      // An all-hole group has no solid baseline and cannot create cut pieces.
      if (!isGroup || body.node.children.length) {
        stage(baseline);
        before = (await built(body)).mesh;
        if (!current()) throw new Error(`${label} cancelled because the design changed. Try again.`);
      }
    }
    stage(proposed);
    const builtResult = await built(result);
    const count = builtResult.mesh.solidCount;
    const ids = [id];
    if (shouldSplitCombine({ op, isGroup, hasHoles, beforeCount: before?.solidCount, afterCount: count,
      hasNonSolidFaces: builtResult.mesh.hasNonSolidFaces || before?.hasNonSolidFaces })) {
      const whole = clone(result), names = new Set(proposed.bodies.map(b => b.name));
      let suffix = 1;
      const keep = significantPieces(builtResult.mesh.solidVolumes, builtResult.mesh.solidAreas, count);
      keep.forEach((i, n) => {
        const piece = n === 0 ? result : clone(whole);
        if (n > 0) {
          piece.id = uid("b"); piece.seq = nextSeq(proposed);
          do { piece.name = `${whole.name} (split${suffix === 1 ? "" : " " + suffix})`; suffix++; } while (names.has(piece.name));
          names.add(piece.name); proposed.bodies.push(piece); ids.push(piece.id);
        }
        piece.node.mods = piece.node.mods || [];
        piece.node.mods.push({ id: uid("f"), seq: nextSeq(proposed), t: "keeppiece", piece: i, count, ...(keep.length === 1 && count > 1 ? { sole: true } : {}) });
      });
      // The validated compound fixes every selector index. Build outputs normally after
      // committing; waiting for all their meshes at once would exceed the bounded cache.
    }
    if (!current()) throw new Error(`${label} cancelled because the design changed. Try again.`);
    store.update(doc => Object.assign(doc, proposed), label);
    return ids;
  } finally {
    scene.holdBusy--;
    if (staged && store.preview === staged) store.setPreview(null);
  }
}
