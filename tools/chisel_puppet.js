// ================= Puppet Animator =================
// Rig a sculpt with a skeleton, pose it by dragging its joints, set keyframes on a timeline
// (up to 30 seconds), use ready-made animations or your own, put it on a virtual set (a
// background picture or color, a floor with soft shadows), and export the animation as an MP4.
// The sculpt itself is never changed: the animator shows a posed copy of it. Skeletons and
// animations are saved with the sculpt in the design.
// Characters face +Z; bones are in the object's own coordinates. Rotation keys are quaternions
// in each bone's rest frame (the rest pose has no rotation), so a bone's angles are about the
// object's axes: X tips forward / back, Z sideways, Y twists.
const PUP = (() => {
  const P = { on: false, tool: 'pose', t: 0, playing: false, loop: true, dur: 4, fps: 30, autoKey: true,
    set: { bg: 'none', color: '#1f2633', img: null, imgName: '', floor: true, shadows: true, floorColor: '#d9dee5', frame: true },
    cam: null, res: 720, exporting: false };
  const Q = THREE.Quaternion, ID = new Q();
  const MAX_DUR = 30, LENGTHS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30];
  const deg = Math.PI / 180;
  const eq = (x, y, z) => new Q().setFromEuler(new THREE.Euler(x * deg, y * deg, z * deg, 'XYZ'));
  const rigged = () => objects.filter((o) => o.skel && o.skel.bones && o.skel.bones.length && o.visible);
  const bump = (o) => { o.pupRev = (o.pupRev || 0) + 1; };

  // ---------------------------------------------------------------- skeleton math
  function prep(o) {
    const sk = o.skel;
    if (sk._ver === sk.ver && sk._order) return sk;
    const B = sk.bones, idx = new Map(B.map((b, i) => [b.name, i]));
    const order = [], seen = new Set();
    const visit = (i) => { if (seen.has(i)) return; const p = B[i].parent; if (p != null && idx.has(p)) visit(idx.get(p)); seen.add(i); order.push(i); };
    B.forEach((_, i) => visit(i));
    sk._order = order; sk._idx = idx; sk._ver = sk.ver; sk._pi = B.map((b) => (b.parent != null && idx.has(b.parent) ? idx.get(b.parent) : -1));
    return sk;
  }
  // a pose: { q: { boneName: [x,y,z,w] }, root: [x,y,z] } -> world (object) rotations, joints
  function solve(o, pose) {
    const sk = prep(o), B = sk.bones, n = B.length;
    const W = new Array(n), H = new Array(n), T = new Array(n);
    const v = new V3();
    for (const i of sk._order) {
      const b = B[i], pi = sk._pi[i], qa = pose && pose.q && pose.q[b.name], q = qa ? new Q(qa[0], qa[1], qa[2], qa[3]) : ID.clone();
      if (pi < 0) {
        W[i] = q; const r = (pose && pose.root) || [0, 0, 0];
        H[i] = new V3(b.head[0] + r[0], b.head[1] + r[1], b.head[2] + r[2]);
      } else {
        W[i] = W[pi].clone().multiply(q);
        const pb = B[pi];
        H[i] = v.set(b.head[0] - pb.head[0], b.head[1] - pb.head[1], b.head[2] - pb.head[2]).applyQuaternion(W[pi]).add(H[pi]).clone();
      }
      T[i] = v.set(b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]).applyQuaternion(W[i]).add(H[i]).clone();
    }
    return { W, H, T };
  }
  // skin weights: each surface point follows its nearest bones (up to 4), blended smoothly
  function weights(o) {
    const sk = prep(o), key = sk.ver + ':' + o.pos.length + ':' + (o.rev || 0);
    if (o._w && o._w.key === key) return o._w;
    const B = sk.bones, n = o.pos.length / 3, P = o.pos, bi = new Uint16Array(n * 4), bw = new Float32Array(n * 4);
    // ready-made characters know which part of the body each bone moves: a point follows the
    // part it lies on, blended where parts meet (no skin pulled along by a nearby arm)
    if (sk.parts && sk.parts.length) {
      const bix = sk._idx, parts = sk.parts.filter((p) => bix.has(p.bone)), sig = Math.max(1e-3, (sk.k || 0.05) * 0.45);
      const best = new Float32Array(B.length);
      for (let v = 0; v < n; v++) {
        const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
        best.fill(1e9);
        for (const p of parts) { const d = CHARS.partDist(p, x, y, z), j = bix.get(p.bone); if (d < best[j]) best[j] = d; }
        let dmin = 1e9; for (let j = 0; j < best.length; j++) if (best[j] < dmin) dmin = best[j];
        const top = [];
        for (let j = 0; j < best.length; j++) { const w = Math.exp(-(best[j] - dmin) / sig); if (w > 0.02) top.push([w, j]); }
        top.sort((a, b) => b[0] - a[0]); top.length = Math.min(4, top.length);
        const sum = top.reduce((a, q) => a + q[0], 0) || 1;
        for (let k = 0; k < 4; k++) { const q = top[k]; bi[v * 4 + k] = q ? q[1] : 0; bw[v * 4 + k] = q ? q[0] / sum : 0; }
      }
      return (o._w = { key, bi, bw });
    }
    const seg = B.map((b) => ({ ax: b.head[0], ay: b.head[1], az: b.head[2], dx: b.tail[0] - b.head[0], dy: b.tail[1] - b.head[1], dz: b.tail[2] - b.head[2] }));
    for (const s of seg) s.l2 = s.dx * s.dx + s.dy * s.dy + s.dz * s.dz || 1e-9;
    const bd = new Float32Array(4), bk = new Int32Array(4);
    for (let v = 0; v < n; v++) {
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      bd.fill(1e9); bk.fill(-1);
      for (let i = 0; i < seg.length; i++) {
        const s = seg[i], t = Math.max(0, Math.min(1, ((x - s.ax) * s.dx + (y - s.ay) * s.dy + (z - s.az) * s.dz) / s.l2));
        const ex = x - s.ax - s.dx * t, ey = y - s.ay - s.dy * t, ez = z - s.az - s.dz * t, d = ex * ex + ey * ey + ez * ez;
        if (d < bd[3]) { let k = 3; while (k > 0 && d < bd[k - 1]) { bd[k] = bd[k - 1]; bk[k] = bk[k - 1]; k--; } bd[k] = d; bk[k] = i; }
      }
      // the nearest bone counts most; the others only where they are almost as near
      const d0 = Math.sqrt(bd[0]) + 1e-4; let sum = 0;
      for (let k = 0; k < 4; k++) {
        if (bk[k] < 0) { bw[v * 4 + k] = 0; continue; }
        const d = Math.sqrt(bd[k]) + 1e-4, r = d / d0, w = r > 1.9 ? 0 : 1 / Math.pow(r, 6);
        bi[v * 4 + k] = bk[k]; bw[v * 4 + k] = w; sum += w;
      }
      for (let k = 0; k < 4; k++) bw[v * 4 + k] /= sum || 1;
    }
    return (o._w = { key, bi, bw });
  }
  // the posed copy of the sculpt
  function puppetMesh(o) {
    if (o._pm && o._pm.userData.n === o.pos.length) return o._pm;
    if (o._pm) { scene.remove(o._pm); o._pm.geometry.dispose(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(o.pos), 3));
    g.setIndex(new THREE.BufferAttribute(o.idx, 1));
    const c = o.mesh.geometry.attributes.color;
    if (c) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(c.array), 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, o.mesh.material);
    m.matrixAutoUpdate = false; m.userData.n = o.pos.length; m.userData.pup = o;
    scene.add(m);
    return (o._pm = m);
  }
  function skin(o, pose) {
    const m = puppetMesh(o), S = solve(o, pose), B = o.skel.bones, w = weights(o);
    const M = B.map((b, i) => new THREE.Matrix4().compose(S.H[i], S.W[i], new V3(1, 1, 1)).multiply(new THREE.Matrix4().makeTranslation(-b.head[0], -b.head[1], -b.head[2])).elements);
    const P = o.pos, out = m.geometry.attributes.position.array, n = P.length / 3, bi = w.bi, bw = w.bw;
    for (let v = 0; v < n; v++) {
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      let ox = 0, oy = 0, oz = 0;
      for (let k = 0; k < 4; k++) {
        const ww = bw[v * 4 + k]; if (!ww) continue;
        const e = M[bi[v * 4 + k]];
        ox += ww * (e[0] * x + e[4] * y + e[8] * z + e[12]); oy += ww * (e[1] * x + e[5] * y + e[9] * z + e[13]); oz += ww * (e[2] * x + e[6] * y + e[10] * z + e[14]);
      }
      out[v * 3] = ox; out[v * 3 + 1] = oy; out[v * 3 + 2] = oz;
    }
    m.geometry.attributes.position.needsUpdate = true;
    m.geometry.computeVertexNormals();
    o.mesh.updateMatrixWorld(true);
    m.matrix.copy(o.mesh.matrixWorld); m.matrixWorld.copy(o.mesh.matrixWorld);
    o._solved = S;
    return S;
  }

  // ---------------------------------------------------------------- keys and time
  const animOf = (o) => (o.anim = o.anim || { keys: [] });
  function poseAt(o, t) {
    const K = o.anim && o.anim.keys;
    if (!K || !K.length) return o.pose || null;
    if (t <= K[0].t || K.length === 1) return K[0];
    if (t >= K[K.length - 1].t) return K[K.length - 1];
    let i = 0; while (i < K.length - 1 && K[i + 1].t <= t) i++;
    const a = K[i], b = K[i + 1];
    let u = (t - a.t) / Math.max(1e-6, b.t - a.t);
    if (a.ease !== false) u = u * u * (3 - 2 * u);
    const q = {}, names = new Set([...Object.keys(a.q || {}), ...Object.keys(b.q || {})]);
    for (const nm of names) {
      const qa = a.q[nm] ? new Q(...a.q[nm]) : ID.clone(), qb = b.q[nm] ? new Q(...b.q[nm]) : ID.clone();
      qa.slerp(qb, u); q[nm] = [qa.x, qa.y, qa.z, qa.w];
    }
    const ra = a.root || [0, 0, 0], rb = b.root || [0, 0, 0];
    return { q, root: [ra[0] + (rb[0] - ra[0]) * u, ra[1] + (rb[1] - ra[1]) * u, ra[2] + (rb[2] - ra[2]) * u] };
  }
  const clonePose = (p) => ({ q: JSON.parse(JSON.stringify((p && p.q) || {})), root: ((p && p.root) || [0, 0, 0]).slice() });
  function setKey(o, t, pose = o.pose) {
    const A = animOf(o), tol = 0.5 / P.fps;
    const k = { t: Math.round(t * P.fps) / P.fps, ease: true, ...clonePose(pose) };
    const i = A.keys.findIndex((x) => Math.abs(x.t - k.t) < tol);
    if (i >= 0) { k.ease = A.keys[i].ease; A.keys[i] = k; } else { A.keys.push(k); A.keys.sort((a, b) => a.t - b.t); }
    bump(o);
  }
  function seek(t) {
    P.t = Math.max(0, Math.min(P.dur, t));
    for (const o of rigged()) { const p = poseAt(o, P.t); if (p) o.pose = clonePose(p); }
    dirty = true; req(); if (!P.exporting) syncTimeline();
  }
  let dirty = true, rafPlay = 0, last = 0;
  function play(on = !P.playing) {
    P.playing = on;
    cancelAnimationFrame(rafPlay);
    if (on) {
      if (P.t >= P.dur - 1e-3) P.t = 0;
      last = performance.now();
      const step = (now) => {
        if (!P.playing) return;
        let t = P.t + (now - last) / 1000; last = now;
        if (t > P.dur) { if (P.loop) t = t % P.dur; else { t = P.dur; P.playing = false; } }
        seek(t);
        if (P.playing) rafPlay = requestAnimationFrame(step); else syncTimeline();
      };
      rafPlay = requestAnimationFrame(step);
    }
    syncTimeline();
  }

  // ---------------------------------------------------------------- the animation library
  // f(t, H) -> { boneName: [x, y, z] degrees, ..., root: [x, y, z] (fraction of the height) }
  const S1 = (t, c, ph = 0) => Math.sin(((t / c) + ph) * Math.PI * 2);
  const C1 = (t, c, ph = 0) => Math.cos(((t / c) + ph) * Math.PI * 2);
  const LIB = {
    humanoid: [
      { id: 'idle', name: 'Idle (breathing)', len: 3, f: (t) => ({ chest: [2 * S1(t, 3), 0, 0], spine: [0, 0, 1.5 * S1(t, 3, 0.25)], head: [2 * S1(t, 3, 0.5), 6 * S1(t, 6), 0], 'upperArm.L': [0, 0, -2 * S1(t, 3)], 'upperArm.R': [0, 0, 2 * S1(t, 3)] }) },
      { id: 'walk', name: 'Walk', len: 2, cycle: 1, f: (t) => { const s = S1(t, 1), c = C1(t, 1); return { 'upperLeg.L': [-25 * s, 0, 0], 'upperLeg.R': [25 * s, 0, 0], 'lowerLeg.L': [Math.max(0, 40 * C1(t, 1, 0.1)), 0, 0], 'lowerLeg.R': [Math.max(0, -40 * C1(t, 1, 0.1)), 0, 0], 'foot.L': [-10 * s, 0, 0], 'foot.R': [10 * s, 0, 0], 'upperArm.L': [22 * s, 0, -8], 'upperArm.R': [-22 * s, 0, 8], 'lowerArm.L': [-15 - 8 * s, 0, 0], 'lowerArm.R': [-15 + 8 * s, 0, 0], hips: [0, 6 * s, 0], chest: [3, -6 * s, 0], head: [0, 3 * s, 0], root: [0, 0.012 * Math.abs(c), 0] }; } },
      { id: 'run', name: 'Run', len: 2, cycle: 0.66, f: (t) => { const s = S1(t, 0.66), c = C1(t, 0.66); return { 'upperLeg.L': [-45 * s, 0, 0], 'upperLeg.R': [45 * s, 0, 0], 'lowerLeg.L': [Math.max(10, 80 * C1(t, 0.66, 0.1)), 0, 0], 'lowerLeg.R': [Math.max(10, -80 * C1(t, 0.66, 0.1)), 0, 0], 'upperArm.L': [40 * s, 0, -12], 'upperArm.R': [-40 * s, 0, 12], 'lowerArm.L': [-70, 0, 0], 'lowerArm.R': [-70, 0, 0], spine: [12, 0, 0], hips: [0, 10 * s, 0], chest: [4, -10 * s, 0], root: [0, 0.03 * Math.abs(c), 0] }; } },
      { id: 'wave', name: 'Wave', len: 2.5, f: (t) => { const up = Math.min(1, t / 0.4, (2.5 - t) / 0.4); return { 'upperArm.R': [-20 * up, 0, -150 * up], 'lowerArm.R': [0, 0, (-25 + 25 * S1(t, 0.5)) * up], 'hand.R': [0, 0, 10 * S1(t, 0.5) * up], head: [0, -10 * up, -6 * up], chest: [0, -5 * up, 3 * up] }; } },
      { id: 'jump', name: 'Jump', len: 1.8, keys: [
        [0, {}, [0, 0, 0]],
        [0.4, { 'upperLeg.L': [-55, 0, 0], 'upperLeg.R': [-55, 0, 0], 'lowerLeg.L': [95, 0, 0], 'lowerLeg.R': [95, 0, 0], 'foot.L': [-35, 0, 0], 'foot.R': [-35, 0, 0], spine: [20, 0, 0], 'upperArm.L': [35, 0, -5], 'upperArm.R': [35, 0, 5] }, [0, -0.1, 0]],
        [0.75, { 'upperArm.L': [-30, 0, 150], 'upperArm.R': [-30, 0, -150], 'foot.L': [25, 0, 0], 'foot.R': [25, 0, 0] }, [0, 0.32, 0]],
        [1.0, { 'upperLeg.L': [-30, 0, 0], 'upperLeg.R': [-30, 0, 0], 'lowerLeg.L': [50, 0, 0], 'lowerLeg.R': [50, 0, 0], 'upperArm.L': [-20, 0, 110], 'upperArm.R': [-20, 0, -110] }, [0, 0.36, 0]],
        [1.3, { 'upperLeg.L': [-45, 0, 0], 'upperLeg.R': [-45, 0, 0], 'lowerLeg.L': [80, 0, 0], 'lowerLeg.R': [80, 0, 0], 'foot.L': [-30, 0, 0], 'foot.R': [-30, 0, 0], spine: [15, 0, 0], 'upperArm.L': [10, 0, 30], 'upperArm.R': [10, 0, -30] }, [0, -0.08, 0]],
        [1.8, {}, [0, 0, 0]]] },
      { id: 'dance', name: 'Dance', len: 4, cycle: 1, f: (t) => { const s = S1(t, 1), s2 = S1(t, 0.5); return { hips: [0, 0, 8 * s], spine: [0, 0, -6 * s], chest: [0, 10 * s, 0], 'upperArm.L': [-20, 0, 70 + 50 * s], 'upperArm.R': [-20, 0, -70 + 50 * s], 'lowerArm.L': [-40 * Math.max(0, s), 0, 30], 'lowerArm.R': [-40 * Math.max(0, -s), 0, -30], 'upperLeg.L': [-15 * Math.max(0, s2), 0, 0], 'upperLeg.R': [-15 * Math.max(0, -s2), 0, 0], 'lowerLeg.L': [30 * Math.max(0, s2), 0, 0], 'lowerLeg.R': [30 * Math.max(0, -s2), 0, 0], head: [0, 0, 12 * s], root: [0.025 * s, -0.015 * Math.abs(s2), 0] }; } },
      { id: 'nod', name: 'Nod "yes"', len: 2, f: (t) => ({ head: [18 * Math.max(0, S1(t, 0.66)), 0, 0], neck: [6 * Math.max(0, S1(t, 0.66)), 0, 0] }) },
      { id: 'shake', name: 'Shake "no"', len: 2, f: (t) => ({ head: [0, 28 * S1(t, 0.6), 0], neck: [0, 8 * S1(t, 0.6), 0] }) },
      { id: 'look', name: 'Look around', len: 4, f: (t) => ({ head: [6 * S1(t, 4, 0.25), 45 * S1(t, 4), 0], neck: [0, 15 * S1(t, 4), 0], chest: [0, 10 * S1(t, 4), 0] }) },
      { id: 'cheer', name: 'Cheer', len: 2, cycle: 0.5, f: (t) => { const s = Math.max(0, S1(t, 0.5)); return { 'upperArm.L': [-15, 0, 140 + 20 * s], 'upperArm.R': [-15, 0, -140 - 20 * s], 'lowerArm.L': [0, 0, 10], 'lowerArm.R': [0, 0, -10], head: [-10, 0, 0], root: [0, 0.06 * s, 0] }; } },
    ],
    quadruped: [
      { id: 'walk', name: 'Walk', len: 2.4, cycle: 0.8, f: (t) => { const s = S1(t, 0.8), c = C1(t, 0.8); return { 'frontUpper.L': [-20 * s, 0, 0], 'backUpper.R': [-20 * s, 0, 0], 'frontUpper.R': [20 * s, 0, 0], 'backUpper.L': [20 * s, 0, 0], 'frontLower.L': [-Math.max(0, 25 * c), 0, 0], 'frontLower.R': [-Math.max(0, -25 * c), 0, 0], 'backLower.L': [Math.max(0, 25 * c), 0, 0], 'backLower.R': [Math.max(0, -25 * c), 0, 0], tail1: [0, 12 * s, 0], tail2: [0, 10 * S1(t, 0.8, 0.2), 0], head: [3 * c, 0, 0], spine: [0, 3 * s, 0], root: [0, 0.01 * Math.abs(c), 0] }; } },
      { id: 'trot', name: 'Trot', len: 2, cycle: 0.5, f: (t) => { const s = S1(t, 0.5), c = C1(t, 0.5); return { 'frontUpper.L': [-35 * s, 0, 0], 'backUpper.R': [-35 * s, 0, 0], 'frontUpper.R': [35 * s, 0, 0], 'backUpper.L': [35 * s, 0, 0], 'frontLower.L': [-Math.max(0, 45 * c), 0, 0], 'frontLower.R': [-Math.max(0, -45 * c), 0, 0], 'backLower.L': [Math.max(0, 45 * c), 0, 0], 'backLower.R': [Math.max(0, -45 * c), 0, 0], tail1: [-10, 18 * s, 0], head: [5 * c, 0, 0], root: [0, 0.025 * Math.abs(c), 0] }; } },
      { id: 'wag', name: 'Wag tail', len: 2, f: (t) => ({ tail1: [-15, 35 * S1(t, 0.35), 0], tail2: [0, 30 * S1(t, 0.35, 0.15), 0], head: [0, 0, 8 * S1(t, 2)], hips: [0, 4 * S1(t, 0.35, 0.5), 0] }) },
      { id: 'look', name: 'Look around', len: 4, f: (t) => ({ neck: [0, 30 * S1(t, 4), 0], head: [10 * S1(t, 4, 0.25), 15 * S1(t, 4), 0], tail1: [0, 10 * S1(t, 1), 0] }) },
      { id: 'hop', name: 'Hop', len: 2, cycle: 0.67, f: (t) => { const s = Math.max(0, S1(t, 0.67)); return { 'frontUpper.L': [-30 * s, 0, 0], 'frontUpper.R': [-30 * s, 0, 0], 'backUpper.L': [30 * s, 0, 0], 'backUpper.R': [30 * s, 0, 0], spine: [-10 * s, 0, 0], root: [0, 0.18 * s, 0] }; } },
    ],
    bird: [
      { id: 'flap', name: 'Flap wings', len: 2, cycle: 0.4, f: (t) => { const s = S1(t, 0.4); return { 'wing.L': [0, 0, 45 * s + 20], 'wing.R': [0, 0, -45 * s - 20], tail: [10 * s, 0, 0], head: [-5 * s, 0, 0], root: [0, 0.04 * (s + 1), 0] }; } },
      { id: 'hop', name: 'Hop', len: 2, cycle: 0.5, f: (t) => { const s = Math.max(0, S1(t, 0.5)); return { 'leg.L': [-20 * s, 0, 0], 'leg.R': [-20 * s, 0, 0], 'wing.L': [0, 0, 15 * s], 'wing.R': [0, 0, -15 * s], root: [0, 0.2 * s, 0] }; } },
      { id: 'peck', name: 'Peck', len: 2, f: (t) => { const s = Math.max(0, S1(t, 0.5)); return { body: [25 * s, 0, 0], head: [30 * s, 0, 0], tail: [-20 * s, 0, 0] }; } },
    ],
    chain: [
      { id: 'swim', name: 'Swim / wiggle', len: 2, cycle: 1, f: (t) => ({ front: [0, 6 * S1(t, 1), 0], middle: [0, -14 * S1(t, 1, 0.12), 0], tail: [0, 28 * S1(t, 1, 0.25), 0], root: [0.02 * S1(t, 1, 0.5), 0, 0] }) },
    ],
    tentacles: [
      { id: 'wiggle', name: 'Wiggle', len: 3, cycle: 1.5, f: (t) => { const o = { body: [0, 8 * S1(t, 3), 0], root: [0, 0.04 * S1(t, 1.5), 0] }; for (let i = 1; i <= 6; i++) for (let j = 1; j <= 3; j++) o['tentacle' + i + '.' + j] = [14 * S1(t, 1.5, i / 6 + j * 0.12), 0, 14 * C1(t, 1.5, i / 6 + j * 0.12)]; return o; } },
      { id: 'float', name: 'Float', len: 4, f: (t) => { const o = { root: [0, 0.12 + 0.06 * S1(t, 2), 0], body: [0, 20 * S1(t, 4), 0] }; for (let i = 1; i <= 6; i++) for (let j = 1; j <= 3; j++) o['tentacle' + i + '.' + j] = [10 + 10 * S1(t, 2, j * 0.15), 0, 0]; return o; } },
    ],
    head: [
      { id: 'nod', name: 'Nod "yes"', len: 2, f: (t) => ({ head: [15 * Math.max(0, S1(t, 0.66)), 0, 0] }) },
      { id: 'shake', name: 'Shake "no"', len: 2, f: (t) => ({ head: [0, 28 * S1(t, 0.6), 0] }) },
      { id: 'tilt', name: 'Tilt', len: 2, f: (t) => ({ head: [0, 0, 18 * S1(t, 2)] }) },
      { id: 'look', name: 'Look around', len: 4, f: (t) => ({ head: [8 * S1(t, 4, 0.25), 45 * S1(t, 4), 0], neck: [0, 10 * S1(t, 4), 0] }) },
    ],
    generic: [
      { id: 'bounce', name: 'Bounce', len: 2, cycle: 0.5, f: (t) => ({ root: [0, 0.2 * Math.abs(S1(t, 1)), 0] }) },
      { id: 'spin', name: 'Spin', len: 2, f: (t) => ({ _rootSpin: (t / 2) * 360 }) },
      { id: 'wiggle', name: 'Wiggle', len: 2, cycle: 1, f: (t, names) => { const o = {}; names.forEach((n, j) => { if (j) o[n] = [10 * S1(t, 1, j * 0.15), 0, 14 * S1(t, 1, j * 0.15 + 0.25)]; }); return o; } },
    ],
  };
  function libFor(o) { const r = (o.skel && o.skel.rig) || 'generic'; return r === 'generic' ? LIB.generic : [...(LIB[r] || []), ...LIB.generic.filter((a) => a.id !== 'wiggle')]; }
  function height(o) { let y0 = 1e9, y1 = -1e9; const P = o.pos; for (let i = 1; i < P.length; i += 3) { if (P[i] < y0) y0 = P[i]; if (P[i] > y1) y1 = P[i]; } return y1 - y0 || 1; }
  // bake a library animation into keys (8 per second, linear between them; posed ones ease)
  function applyLib(o, a) {
    const H = height(o), names = o.skel.bones.map((b) => b.name), rootName = o.skel.bones.find((b) => b.parent == null)?.name;
    const keys = [];
    const toKey = (t, f, ease) => {
      const q = {}; let root = [0, 0, 0];
      for (const [k, v] of Object.entries(f)) {
        if (k === 'root') root = [v[0] * H, v[1] * H, v[2] * H];
        else if (k === '_rootSpin') { if (rootName) { const qq = eq(0, v, 0); q[rootName] = [qq.x, qq.y, qq.z, qq.w]; } }
        else if (names.includes(k)) { const qq = eq(v[0], v[1], v[2]); q[k] = [qq.x, qq.y, qq.z, qq.w]; }
      }
      keys.push({ t: Math.round(t * P.fps) / P.fps, ease, q, root });
    };
    const len = Math.min(10, a.len);
    if (a.keys) for (const [t, f, r] of a.keys) toKey(t, { ...f, root: r }, true);
    else { const n = Math.max(2, Math.round(len * 8)); for (let i = 0; i <= n; i++) { const t = (i / n) * len; toKey(t, a.f(t, names), false); } }
    o.anim = { keys };
    P.dur = Math.max(1, Math.min(10, Math.ceil(len * 10) / 10));
    for (const x of rigged()) if (x.anim) x.anim.dur = P.dur;
    bump(o);
  }

  // ---------------------------------------------------------------- my animations (this device)
  const MY_KEY = 'jumpstart.puppet.anims';
  const myList = () => { try { return JSON.parse(localStorage.getItem(MY_KEY) || '[]'); } catch (e) { return []; } };
  const mySave = (l) => { try { localStorage.setItem(MY_KEY, JSON.stringify(l)); return true; } catch (e) { return false; } };

  // ---------------------------------------------------------------- skeleton templates
  function fitBones(o, bones, rig) {
    const P = o.pos; const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
    const bl = [1e9, 1e9, 1e9], bh = [-1e9, -1e9, -1e9];
    for (const b of bones) for (const p of [b.head, b.tail]) for (let k = 0; k < 3; k++) { bl[k] = Math.min(bl[k], p[k]); bh[k] = Math.max(bh[k], p[k]); }
    const shrink = rig === 'humanoid' ? [0.92, 0.97, 0.5] : [0.85, 0.85, 0.85];
    const map = (p) => p.map((v, k) => { const c = (lo[k] + hi[k]) / 2, half = ((hi[k] - lo[k]) / 2) * shrink[k], bc = (bl[k] + bh[k]) / 2, bhalf = Math.max(1e-6, (bh[k] - bl[k]) / 2); return c + ((v - bc) / bhalf) * half; });
    return bones.map((b) => ({ ...b, head: map(b.head), tail: map(b.tail) }));
  }
  function addSkeleton(o, kind) {
    pushUndo();
    let bones, rig;
    if (kind === 'humanoid') { const c = CHARS.build('human', 0); bones = c.bones; rig = 'humanoid'; }
    else if (kind === 'quadruped') { const c = CHARS.build('dog', 0); bones = c.bones; rig = 'quadruped'; }
    else {
      const P = o.pos, lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
      const ax = [0, 1, 2].reduce((a, k) => (hi[k] - lo[k] > hi[a] - lo[a] ? k : a), 1);
      const n = kind === 'chain' ? 4 : 1, pt = (u) => [0, 1, 2].map((k) => (k === ax ? lo[k] + (hi[k] - lo[k]) * (0.06 + 0.88 * u) : (lo[k] + hi[k]) / 2));
      bones = Array.from({ length: n }, (_, i) => ({ name: n === 1 ? 'body' : 'part' + (i + 1), parent: i ? 'part' + i : null, head: pt(i / n), tail: pt((i + 1) / n) }));
      rig = kind === 'chain' ? 'generic' : 'generic';
      o.skel = { rig, ver: Date.now(), bones };
      o.pose = null; o.anim = { keys: [] }; bump(o); afterRig(o); return;
    }
    o.skel = { rig, ver: Date.now(), bones: fitBones(o, bones, rig) };
    o.pose = null; o.anim = { keys: [] }; bump(o); afterRig(o);
  }
  function afterRig(o) { o._w = null; if (P.on) { dirty = true; markers(); renderPanel(); renderTimeline(); req(); } }

  // ---------------------------------------------------------------- the view: markers, set
  const grp = new THREE.Group(); grp.renderOrder = 999; scene.add(grp); grp.visible = false;
  const jointGeo = new THREE.SphereGeometry(1, 14, 10);
  const matJ = new THREE.MeshBasicMaterial({ color: 0xffc23d, depthTest: false, transparent: true, opacity: 0.95 });
  const matJh = new THREE.MeshBasicMaterial({ color: 0xff5a36, depthTest: false });
  const matR = new THREE.MeshBasicMaterial({ color: 0x3dd6ff, depthTest: false, transparent: true, opacity: 0.95 });
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.8 });
  let pts = []; // { kind: 'bone'|'root'|'joint', i, world V3 }
  let hot = null, drag = null;
  function markers() {
    while (grp.children.length) { const c = grp.children.pop(); if (c.geometry && c.geometry !== jointGeo) c.geometry.dispose(); }
    pts = [];
    const o = P.on && sel && sel.skel ? sel : null;
    grp.visible = !!o && !P.playing && !P.exporting;
    if (!o) return;
    const S = o._solved || solve(o, o.pose), B = o.skel.bones, M = o.mesh.matrixWorld;
    const r = worldPerPx(camera.position.distanceTo(new V3().setFromMatrixPosition(M))) * 7;
    const L = [];
    const add = (pos, kind, i, mat, k = 1) => { const w = pos.clone().applyMatrix4(M); const m = new THREE.Mesh(jointGeo, mat); m.position.copy(w); m.scale.setScalar(r * k); m.renderOrder = 1000; grp.add(m); pts.push({ kind, i, w, m }); };
    B.forEach((b, i) => { L.push(S.H[i].clone().applyMatrix4(M), S.T[i].clone().applyMatrix4(M)); });
    const lg = new THREE.BufferGeometry().setFromPoints(L); const ls = new THREE.LineSegments(lg, lineMat); ls.renderOrder = 999; grp.add(ls);
    if (P.tool === 'rig') {
      // every joint (shared ends drawn once)
      const seen = [];
      B.forEach((b, i) => { for (const [end, pos] of [['h', b.head], ['t', b.tail]]) { if (seen.some((s) => Math.hypot(s[0] - pos[0], s[1] - pos[1], s[2] - pos[2]) < 1e-4)) continue; seen.push(pos); add(new V3(...pos), 'joint', { i, end }, matJ, 0.9); } });
    } else {
      B.forEach((b, i) => add(S.T[i], 'bone', i, hot && hot.kind === 'bone' && hot.i === i ? matJh : matJ));
      const ri = B.findIndex((b) => b.parent == null);
      if (ri >= 0) add(S.H[ri], 'root', ri, matR, 1.25);
    }
  }
  function nearMarker(p) {
    let best = null, bd = coarse ? 22 : 13;
    for (const q of pts) { const s = q.w.clone().project(camera), r = glc.getBoundingClientRect(); const x = (s.x + 1) / 2 * r.width, y = (1 - s.y) / 2 * r.height; const d = Math.hypot(x - p.x, y - p.y); if (d < bd) { bd = d; best = q; } }
    return best;
  }
  const coarse = matchMedia('(pointer: coarse)').matches;
  // floor and soft round shadows under each character
  const floorMat = new THREE.MeshBasicMaterial({ color: P.set.floorColor });
  const setFloor = new THREE.Mesh(new THREE.CircleGeometry(9, 96).rotateX(-Math.PI / 2), floorMat);
  setFloor.position.y = -1.002; setFloor.renderOrder = -2; setFloor.visible = false; scene.add(setFloor);
  const blobTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
  const blobs = new THREE.Group(); scene.add(blobs); blobs.visible = false;
  function updateBlobs() {
    while (blobs.children.length) blobs.remove(blobs.children[0]);
    if (!P.on || !P.set.shadows) { blobs.visible = false; return; }
    blobs.visible = true;
    for (const o of objects) {
      if (!o.visible) continue;
      const m = o._pm && o.skel ? o._pm : o.mesh;
      const b = new THREE.Box3().setFromObject(m);
      if (b.isEmpty() || b.min.y > -0.2) continue; // only things standing near the floor
      const w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 0.75;
      const s = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
      s.position.set((b.min.x + b.max.x) / 2, -0.999, (b.min.z + b.max.z) / 2); s.scale.set(w, 1, w * 0.8); s.renderOrder = -1;
      blobs.add(s);
    }
  }
  // the 16:9 camera frame and the background inside it
  const frameEl = document.createElement('div'); frameEl.id = 'pupFrame'; frameEl.hidden = true; view.append(frameEl);
  function frameRect() {
    const vw = view.clientWidth || 1, vh = view.clientHeight || 1, A = 16 / 9;
    let fw = vw - 24, fh = fw / A; if (fh > vh - 24 - (P.on ? 96 : 0)) { fh = vh - 24 - (P.on ? 96 : 0); fw = fh * A; }
    return { x: (vw - fw) / 2, y: Math.max(12, (vh - 96 - fh) / 2), w: fw, h: fh, vw, vh };
  }
  function layoutSet() {
    if (!P.on) { frameEl.hidden = true; view.style.background = ''; return; }
    const r = frameRect();
    frameEl.hidden = !P.set.frame;
    Object.assign(frameEl.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    const bg = P.set.bg === 'image' && P.set.img ? `url(${P.set.img}) ${r.x}px ${r.y}px / ${r.w}px ${r.h}px no-repeat, ` : '';
    const col = P.set.bg === 'none' ? '' : P.set.color;
    view.style.background = P.set.bg === 'none' ? '' : `${bg}linear-gradient(${col}, ${col})`;
    floorMat.color.set(P.set.floorColor);
  }
  new ResizeObserver(() => { if (P.on) layoutSet(); }).observe(view);

  // ---------------------------------------------------------------- enter / leave
  function enter() {
    if (P.on) return;
    if (typeof CAD !== 'undefined' && CAD.sk && CAD.sk.active) CAD.exitSketch && CAD.exitSketch();
    P.on = true; document.body.classList.add('puppet');
    const ds = objects.map((o) => o.anim && o.anim.keys && o.anim.keys.length && o.anim.dur).filter(Boolean);
    P.dur = ds.length ? Math.max(1, Math.min(MAX_DUR, Math.max(...ds))) : P.dur || 4;
    if (!sel) { const r = rigged()[0]; if (r) select(r); }
    seek(P.t);
    P.gridWas = grid.visible; grid.visible = false; setFloor.visible = P.set.floor;
    $('#pupBtn') && $('#pupBtn').setAttribute('aria-pressed', 'true');
    layoutSet(); renderPanel(); renderTimeline(); markers(); try { HIST.render(); } catch (e) {} req();
    toast(rigged().length ? 'Puppet Animator: drag the yellow joints to pose, then add keys on the timeline' : 'Puppet Animator: pick a model and give it a skeleton (right panel), or add a character');
  }
  function leave() {
    if (!P.on) return;
    play(false);
    P.on = false; document.body.classList.remove('puppet');
    for (const o of objects) { if (o._pm) { scene.remove(o._pm); o._pm.geometry.dispose(); o._pm = null; } o.mesh.visible = o.visible; }
    grid.visible = P.gridWas !== false; setFloor.visible = false; blobs.visible = false; grp.visible = false;
    $('#pupBtn') && $('#pupBtn').setAttribute('aria-pressed', 'false');
    layoutSet(); renderTimeline(); refreshAll(); try { HIST.render(); } catch (e) {} req();
  }
  // every frame while on: posed copies instead of the sculpts
  function frame() {
    if (!P.on) return;
    const R = new Set(rigged());
    for (const o of objects) {
      if (R.has(o)) {
        o.mesh.visible = false; if (o.wire) o.wire.visible = false;
        if (dirty || !o._pm) skin(o, o.pose);
        else { o.mesh.updateMatrixWorld(true); o._pm.matrix.copy(o.mesh.matrixWorld); o._pm.matrixWorld.copy(o.mesh.matrixWorld); }
        o._pm.visible = true;
      } else { if (o._pm) o._pm.visible = false; o.mesh.visible = o.visible; }
    }
    if (dirty) { dirty = false; markers(); updateBlobs(); }
  }

  // ---------------------------------------------------------------- pointer
  function local(o, w) { return w.clone().applyMatrix4(new THREE.Matrix4().copy(o.mesh.matrixWorld).invert()); }
  function rayPoint(p, through) { const n = new V3(); camera.getWorldDirection(n); const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(n, through); const hit = new V3(); return worldRay(p.x, p.y).intersectPlane(pl, hit) ? hit : null; }
  function down(p, e) {
    if (P.exporting) return true;
    const m = sel && sel.skel ? nearMarker(p) : null;
    if (m) {
      pushUndo(); play(false);
      drag = { m, o: sel, through: m.w.clone() };
      return true;
    }
    // click a character: select it
    const meshes = objects.filter((o) => o.visible).map((o) => (o._pm && o._pm.visible ? o._pm : o.mesh));
    const ndc = new THREE.Vector2(p.x / view.clientWidth * 2 - 1, -(p.y / view.clientHeight) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, camera);
    const h = rc.intersectObjects(meshes, false)[0];
    if (h) { const o = objects.find((x) => x.mesh === h.object || x._pm === h.object); if (o && o !== sel) { select(o); dirty = true; renderPanel(); renderTimeline(); req(); return true; } }
    return false;
  }
  function move(p) {
    if (!drag) return;
    const o = drag.o, w = rayPoint(p, drag.through); if (!w) return;
    const T = local(o, w), m = drag.m, B = o.skel.bones;
    if (m.kind === 'joint') {
      const pos = m.i.end === 'h' ? B[m.i.i].head : B[m.i.i].tail, old = pos.slice();
      for (const b of B) for (const k of ['head', 'tail']) if (Math.hypot(b[k][0] - old[0], b[k][1] - old[1], b[k][2] - old[2]) < 1e-4) b[k] = [T.x, T.y, T.z];
      o.skel.ver = Date.now(); o._w = null; bump(o);
    } else {
      o.pose = clonePose(o.pose);
      const S = solve(o, o.pose), i = m.i, b = B[i];
      if (m.kind === 'root') {
        o.pose.root = [T.x - b.head[0], T.y - b.head[1], T.z - b.head[2]];
      } else {
        const d0 = S.T[i].clone().sub(S.H[i]).normalize(), d1 = T.clone().sub(S.H[i]);
        if (d1.lengthSq() < 1e-10) return;
        d1.normalize();
        const delta = new Q().setFromUnitVectors(d0, d1), Wn = delta.multiply(S.W[i]);
        const pi = o.skel._pi[i], qn = pi < 0 ? Wn : S.W[pi].clone().invert().multiply(Wn);
        o.pose.q[b.name] = [qn.x, qn.y, qn.z, qn.w];
      }
    }
    dirty = true; req();
  }
  function up() {
    if (!drag) return;
    const o = drag.o, kind = drag.m.kind; drag = null;
    if (kind !== 'joint' && P.autoKey) setKey(o, P.t);
    bump(o); dirty = true; renderTimeline(); req();
  }
  function hover(p) {
    const m = P.on && sel && sel.skel ? nearMarker(p) : null;
    const was = hot; hot = m && m.kind === 'bone' ? m : null;
    glc.style.cursor = m ? 'grab' : '';
    if ((was && was.i) !== (hot && hot.i)) { markers(); req(); }
    return true;
  }
  function key(e) {
    if (!P.on) return false;
    if (e.ctrlKey || e.metaKey) return false; // undo / redo etc.
    if (e.key === ' ') { e.preventDefault(); play(); return true; }
    if (e.key === 'k' || e.key === 'K') { addKeyNow(); return true; }
    if (e.key === ',' || e.key === '<') { jumpKey(-1); return true; }
    if (e.key === '.' || e.key === '>') { jumpKey(1); return true; }
    if (e.key === 'Delete' || e.key === 'Backspace') { removeKeyNow(); return true; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); play(false); seek(P.t + (e.key === 'ArrowRight' ? 1 : -1) / P.fps); return true; }
    if (e.key === 'Home') { play(false); seek(0); return true; }
    if (e.key === 'Escape') { leave(); return true; }
    return e.key.length === 1; // no sculpt shortcuts while animating
  }

  // Any model can be moved and turned over time without building a skeleton first: it gets one
  // hidden bone through its middle, so the whole model moves as one piece.
  function ensureMotionRig(o) {
    if (o.skel) return;
    const Pp = o.pos, lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let i = 0; i < Pp.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], Pp[i + k]); hi[k] = Math.max(hi[k], Pp[i + k]); }
    const c = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
    o.skel = { rig: 'generic', ver: Date.now(), motion: true, bones: [{ name: 'body', parent: null, head: c, tail: [c[0], hi[1], c[2]] }] };
    o.pose = null; o.anim = { keys: [] }; bump(o); o._w = null; P.tool = 'pose';
    dirty = true; markers(); renderPanel(); req();
  }
  const rootBone = (o) => o.skel && o.skel.bones.find((b) => b.parent == null);
  // the whole model's move (offset) and turn (degrees) in the current pose
  function motionOf(o) {
    const p = o.pose || (o.anim && o.anim.keys.length ? poseAt(o, P.t) : null) || { q: {}, root: [0, 0, 0] };
    const rb = rootBone(o), qa = rb && p.q && p.q[rb.name];
    const e = qa ? new THREE.Euler().setFromQuaternion(new Q(qa[0], qa[1], qa[2], qa[3]), 'XYZ') : new THREE.Euler();
    const r = p.root || [0, 0, 0];
    return { move: r.slice(), turn: [e.x / deg, e.y / deg, e.z / deg] };
  }
  function setMotion(o, which, i, v) {
    ensureMotionRig(o);
    pushUndo(); if (P.playing) play(false);
    const pose = clonePose(o.pose || poseAt(o, P.t));
    const m = motionOf(o);
    if (which === 'move') { m.move[i] = v; pose.root = m.move; }
    else { m.turn[i] = v; const rb = rootBone(o), qq = eq(m.turn[0], m.turn[1], m.turn[2]); pose.q[rb.name] = [qq.x, qq.y, qq.z, qq.w]; }
    o.pose = pose;
    if (P.autoKey) setKey(o, P.t);
    bump(o); dirty = true; req(); renderTimeline();
  }
  function syncMotionFields() {
    if (!sel || !sec.querySelector('#pmMove0')) return;
    const m = motionOf(sel);
    for (let i = 0; i < 3; i++) {
      const a = sec.querySelector('#pmMove' + i), b = sec.querySelector('#pmTurn' + i);
      if (a && document.activeElement !== a) a.value = +m.move[i].toFixed(2);
      if (b && document.activeElement !== b) b.value = Math.round(m.turn[i]);
    }
  }
  // add (or update) a key at the playhead; while playing, the animation pauses there first so
  // the student can see and change the pose that was keyed
  function addKeyNow() {
    if (sel && !sel.skel) ensureMotionRig(sel);
    const o = sel && sel.skel ? sel : null; if (!o) { toast('Select a model first (click it)'); return; }
    if (P.playing) play(false);
    pushUndo(); setKey(o, P.t); renderTimeline();
    toast(`Key set at ${P.t.toFixed(2)} s`);
  }
  function removeKeyNow() {
    const o = sel && sel.skel ? sel : null; if (!o || !o.anim) return;
    const K = o.anim.keys, i = keyAtNow(K);
    if (i < 0) { toast('No key at the playhead: click a ◆ (or use ◀◆ ◆▶) to go to one'); return; }
    pushUndo(); K.splice(i, 1); bump(o); seek(P.t); renderTimeline();
  }
  // ---------------------------------------------------------------- the timeline
  const tl = document.createElement('div'); tl.id = 'ptl'; tl.hidden = true; view.append(tl);
  // The bar is only rebuilt when something on it changes (keys, length, selection). While it
  // plays, just the playhead, the time and the buttons' states move: rebuilding the bar on every
  // frame replaced the buttons under the mouse, so Pause, ⏮ and ◆ Key could not be clicked.
  let tlSig = '';
  const keysOf = () => { const o = sel && sel.skel ? sel : null; return { o, K: (o && o.anim && o.anim.keys) || [] }; };
  const keyAtNow = (K) => K.findIndex((k) => Math.abs(k.t - P.t) < 0.5 / P.fps);
  function syncTimeline() {
    if (!P.on) { tl.hidden = true; return; }
    const { o, K } = keysOf();
    const sig = [o ? o.id || o.name : '', K.map((k) => k.t.toFixed(3)).join(','), P.dur, P.loop, P.autoKey].join('|');
    if (sig !== tlSig || !tl.querySelector('#ptlTrack')) { renderTimeline(); return; }
    const head = tl.querySelector('.ptl-head'); if (head) head.style.left = (P.t / P.dur) * 100 + '%';
    const tm = tl.querySelector('.ptl-time'); if (tm) tm.textContent = `${P.t.toFixed(2)} / ${P.dur.toFixed(1)} s`;
    const pb = tl.querySelector('#ptlPlay'); if (pb) { pb.textContent = P.playing ? '❚❚' : '▶'; pb.title = P.playing ? 'Pause (Space)' : 'Play (Space)'; }
    const at = keyAtNow(K);
    tl.querySelectorAll('.ptl-key').forEach((el) => el.classList.toggle('on', +el.dataset.k === at));
    const del = tl.querySelector('#ptlDel'); if (del) del.disabled = !(o && at >= 0);
    const kb = tl.querySelector('#ptlKey'); if (kb) kb.textContent = at >= 0 ? '◆ Update key' : '◆ Add key';
    if (!P.playing) syncMotionFields();
  }
  function jumpKey(dir) {
    const { K } = keysOf(); if (!K.length) return;
    play(false);
    const eps = 0.5 / P.fps;
    const k = dir > 0 ? K.find((x) => x.t > P.t + eps) : [...K].reverse().find((x) => x.t < P.t - eps);
    seek(k ? k.t : dir > 0 ? K[K.length - 1].t : K[0].t);
  }
  function renderTimeline() {
    if (!P.on) { tl.hidden = true; return; }
    tl.hidden = false;
    const { o, K } = keysOf();
    tlSig = [o ? o.id || o.name : '', K.map((k) => k.t.toFixed(3)).join(','), P.dur, P.loop, P.autoKey].join('|');
    const at = keyAtNow(K);
    // tick marks: every half second on short animations, every second on long ones; labels thin out too
    const tick = P.dur > 10 ? 1 : 0.5, lab = P.dur > 20 ? 5 : P.dur > 10 ? 2 : 1;
    const ticks = []; for (let i = 0; i * tick <= P.dur + 1e-6; i++) { const s = +(i * tick).toFixed(2), big = Math.abs(s / lab - Math.round(s / lab)) < 1e-6; ticks.push(`<i class="${big ? 'big' : ''}" style="left:${(s / P.dur) * 100}%">${big ? s + 's' : ''}</i>`); }
    tl.innerHTML = `<div class="ptl-row">
      <button class="btn" id="ptlStart" title="Back to the start (Home)">⏮</button>
      <button class="btn" id="ptlPrev" ${K.length ? '' : 'disabled'} title="Go to the previous key (,)">◀◆</button>
      <button class="btn ptl-play" id="ptlPlay" title="${P.playing ? 'Pause' : 'Play'} (Space)">${P.playing ? '❚❚' : '▶'}</button>
      <button class="btn" id="ptlStop" title="Stop: pause and go back to the start">■</button>
      <button class="btn" id="ptlNext" ${K.length ? '' : 'disabled'} title="Go to the next key (.)">◆▶</button>
      <span class="ptl-time">${P.t.toFixed(2)} / ${P.dur.toFixed(1)} s</span>
      <button class="btn ptl-addkey" id="ptlKey" ${sel ? '' : 'disabled'} title="Remember the pose at the playhead as a key (K). Works any time, even while playing.">${at >= 0 ? '◆ Update key' : '◆ Add key'}</button>
      <button class="btn" id="ptlDel" ${o && at >= 0 ? '' : 'disabled'} title="Remove the key at the playhead (Delete)">Remove key</button>
      <span class="ptl-sp"></span>
      <label class="ptl-len">Length <select id="ptlLen">${(LENGTHS.includes(Math.round(P.dur)) ? LENGTHS : [...LENGTHS, Math.round(P.dur)].sort((a, b) => a - b)).map((s) => `<option value="${s}" ${Math.round(P.dur) === s ? 'selected' : ''}>${s} s</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" id="ptlLoop" ${P.loop ? 'checked' : ''}>Loop</label>
      <label class="check" title="Changing the pose at a time sets a key there"><input type="checkbox" id="ptlAuto" ${P.autoKey ? 'checked' : ''}>Auto key</label>
    </div>
    <div class="ptl-track" id="ptlTrack" title="Click or drag to move the playhead · double-click to add a key there · drag a ◆ to move it">${ticks.join('')}${K.map((k, i) => `<b class="ptl-key${i === at ? ' on' : ''}" data-k="${i}" style="left:${(k.t / P.dur) * 100}%" title="Key at ${k.t.toFixed(2)} s (drag to move)"></b>`).join('')}<u class="ptl-head" style="left:${(P.t / P.dur) * 100}%"></u></div>
    <div class="ptl-help">${!sel ? 'Select a model to animate it.' : K.length < 2 ? 'Make an animation: pose the model (or change <b>Move &amp; turn</b> in the panel), move the playhead, change it again… Each change makes a ◆ key, and the frames in between are filled in smoothly.' : `${K.length} keys · the frames between keys are filled in smoothly`}</div>`;
    $('#ptlPlay').onclick = () => play();
    $('#ptlStart').onclick = () => { play(false); seek(0); };
    $('#ptlStop').onclick = () => { play(false); seek(0); };
    $('#ptlPrev').onclick = () => jumpKey(-1);
    $('#ptlNext').onclick = () => jumpKey(1);
    $('#ptlKey').onclick = () => addKeyNow();
    $('#ptlDel').onclick = () => removeKeyNow();
    $('#ptlLen').onchange = (e) => { P.dur = Math.min(MAX_DUR, +e.target.value); for (const x of rigged()) if (x.anim) { x.anim.dur = P.dur; bump(x); } seek(Math.min(P.t, P.dur)); renderPanel(); };
    $('#ptlLoop').onchange = (e) => { P.loop = e.target.checked; };
    $('#ptlAuto').onchange = (e) => { P.autoKey = e.target.checked; };
    const track = $('#ptlTrack');
    if (!P.playing) setTimeout(syncMotionFields, 0);
    track.ondblclick = (ev) => { if (ev.target.closest('.ptl-key')) return; seek(timeAt(ev)); addKeyNow(); };
    const timeAt = (ev) => { const r = track.getBoundingClientRect(); return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * P.dur; };
    track.onpointerdown = (ev) => {
      ev.preventDefault(); play(false);
      if (document.activeElement && document.activeElement.blur && document.activeElement !== document.body) document.activeElement.blur();
      const kEl = ev.target.closest('.ptl-key');
      if (kEl && o) {
        const k = K[+kEl.dataset.k]; let moved = false; pushUndo();
        const mv = (e2) => { moved = true; k.t = Math.round(timeAt(e2) * P.fps) / P.fps; kEl.style.left = (k.t / P.dur) * 100 + '%'; };
        const upk = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', upk); K.sort((a, b) => a.t - b.t); if (moved) bump(o); seek(k.t); renderTimeline(); };
        addEventListener('pointermove', mv); addEventListener('pointerup', upk);
        return;
      }
      seek(timeAt(ev));
      const mv = (e2) => seek(timeAt(e2));
      const upt = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', upt); };
      addEventListener('pointermove', mv); addEventListener('pointerup', upt);
    };
  }

  // ---------------------------------------------------------------- the panel
  const sec = document.createElement('section'); sec.className = 'sec'; sec.id = 'pupSec';
  $('#panel').prepend(sec);
  function renderPanel() {
    if (!P.on) { sec.innerHTML = ''; return; }
    const o = sel;
    let h = `<h2><span class="dot"></span>Puppet Animator<em>${o ? esc(o.name) : ''}</em></h2>`;
    if (o) {
      const m = motionOf(o), st = +(Math.max(0.01, height(o) / 20)).toFixed(2);
      const f = (id, v, step, title) => `<label title="${title}">${id.slice(-1) === '0' ? 'X' : id.slice(-1) === '1' ? 'Y' : 'Z'}<input type="number" class="num" id="${id}" value="${v}" step="${step}"></label>`;
      h += `<div class="sub-h">Move &amp; turn${o.skel && !o.skel.motion ? ' (whole model)' : ''}</div>
        <p class="hint">Move the playhead, then change these: each change is a key${P.autoKey ? '' : ' (turn on Auto key, or press ◆ Add key)'}. No skeleton needed.</p>
        <div class="pm-row"><span>Move</span>${[0, 1, 2].map((i) => f('pmMove' + i, +m.move[i].toFixed(2), st, 'Slide the whole model')).join('')}</div>
        <div class="pm-row"><span>Turn °</span>${[0, 1, 2].map((i) => f('pmTurn' + i, Math.round(m.turn[i]), 15, 'Spin the whole model (degrees)')).join('')}</div>`;
    }
    if (!o) h += `<p class="hint">Add a character (Person, Cat…) or select a model.</p>`;
    else if (!o.skel || o.skel.motion) {
      h += `<div class="sub-h">Bend it (optional)</div><p class="hint">To bend arms, legs or a tail, give <b>${esc(o.name)}</b> a skeleton, then adjust its joints to fit.</p><div class="acts two">` +
        [['humanoid', 'Person'], ['quadruped', 'Four legs'], ['chain', 'Tail / tentacle'], ['single', 'One bone']].map(([k, n]) => `<button class="action" data-skel="${k}">${n}</button>`).join('') + `</div>`;
    } else {
      h += `<div class="seg pup-tools"><button data-ptool="pose" aria-pressed="${P.tool === 'pose'}">Pose</button><button data-ptool="rig" aria-pressed="${P.tool === 'rig'}">Adjust joints</button></div>`;
      h += `<p class="hint">${P.tool === 'pose' ? 'Drag a <b>yellow</b> joint to bend its bone, the <b>blue</b> one to move the whole character. Each pose becomes a key at the playhead.' : 'Drag joints to where they belong inside the model (knees in the knees…). The posed copy follows.'}</p>`;
      h += `<div class="sub-h">Animations</div><div class="pup-lib">${libFor(o).map((a) => `<button class="action sm" data-lib="${a.id}">${esc(a.name)}</button>`).join('')}</div>`;
      const mine = myList().filter((a) => a.rig === o.skel.rig);
      if (mine.length) h += `<div class="sub-h">My animations</div><div class="pup-lib">${mine.map((a, i) => `<span class="pup-my"><button class="action sm" data-my="${i}">${esc(a.name)}</button><button class="mini" data-mydel="${i}" title="Delete">×</button></span>`).join('')}</div>`;
      h += `<div class="acts two"><button class="action" id="pupSaveMy" ${o.anim && o.anim.keys.length ? '' : 'disabled'}>Save to my animations</button><button class="action" id="pupClear" ${o.anim && o.anim.keys.length ? '' : 'disabled'}>Clear keys</button></div>`;
      h += `<button class="action sm" id="pupUnrig" style="width:100%;margin-top:4px">Remove skeleton</button>`;
    }
    const s = P.set;
    h += `<div class="sub-h">Virtual set</div>
      <div class="seg" id="pupBg"><button data-bg="none" aria-pressed="${s.bg === 'none'}">None</button><button data-bg="color" aria-pressed="${s.bg === 'color'}">Color</button><button data-bg="image" aria-pressed="${s.bg === 'image'}">Picture</button></div>
      ${s.bg === 'color' ? `<div class="colorrow"><span>Background</span><input type="color" id="pupBgCol" value="${s.color}"></div>` : ''}
      ${s.bg === 'image' ? `<button class="action" id="pupBgImg" style="width:100%">${s.img ? 'Change picture (' + esc(s.imgName) + ')' : 'Choose a picture…'}</button>` : ''}
      <label class="check"><input type="checkbox" id="pupFloor" ${s.floor ? 'checked' : ''}>Stage floor</label>
      <label class="check"><input type="checkbox" id="pupShadows" ${s.shadows ? 'checked' : ''}>Soft shadows</label>
      ${s.floor ? `<div class="colorrow"><span>Floor</span><input type="color" id="pupFloorCol" value="${s.floorColor}"></div>` : ''}
      <label class="check"><input type="checkbox" id="pupFrameChk" ${s.frame ? 'checked' : ''}>Show the camera frame (what the video sees)</label>`;
    h += `<div class="sub-h">Export video</div>
      <div class="seg" id="pupRes"><button data-res="720" aria-pressed="${P.res === 720}">720p</button><button data-res="1080" aria-pressed="${P.res === 1080}">1080p</button></div>
      <button class="action primary" id="pupExport" style="width:100%;margin-top:6px" ${P.exporting ? 'disabled' : ''}>${P.exporting ? 'Exporting…' : `Export MP4 (${P.dur.toFixed(1)} s)`}</button>
      <div class="pup-prog" id="pupProg" hidden><i></i></div>
      <p class="hint">The video shows what's inside the camera frame, from the current view, at 30 frames a second.</p>
      <button class="action" id="pupBack" style="width:100%;margin-top:8px">← Back to sculpting</button>`;
    sec.innerHTML = h;
    for (let i = 0; i < 3; i++) for (const w of ['Move', 'Turn']) {
      const inp = sec.querySelector('#pm' + w + i); if (!inp) continue;
      inp.addEventListener('keydown', (e) => e.stopPropagation());
      inp.onchange = () => { const v = parseFloat(inp.value); if (isFinite(v)) setMotion(o, w.toLowerCase(), i, v); };
    }
    sec.querySelectorAll('[data-skel]').forEach((b) => b.onclick = () => { addSkeleton(o, b.dataset.skel); P.tool = 'rig'; renderPanel(); markers(); toast('Skeleton added: drag the joints to fit, then press Pose'); });
    sec.querySelectorAll('[data-ptool]').forEach((b) => b.onclick = () => { P.tool = b.dataset.ptool; dirty = true; renderPanel(); markers(); req(); });
    sec.querySelectorAll('[data-lib]').forEach((b) => b.onclick = () => { const a = libFor(o).find((x) => x.id === b.dataset.lib); pushUndo(); applyLib(o, a); seek(0); renderPanel(); play(true); });
    sec.querySelectorAll('[data-my]').forEach((b) => b.onclick = () => { const a = myList().filter((x) => x.rig === o.skel.rig)[+b.dataset.my]; pushUndo(); o.anim = JSON.parse(JSON.stringify(a.anim)); P.dur = a.anim.dur || P.dur; bump(o); seek(0); renderPanel(); play(true); });
    sec.querySelectorAll('[data-mydel]').forEach((b) => b.onclick = () => { const all = myList(), mine = all.filter((x) => x.rig === o.skel.rig), a = mine[+b.dataset.mydel]; mySave(all.filter((x) => x !== a && JSON.stringify(x) !== JSON.stringify(a))); renderPanel(); });
    const sv = $('#pupSaveMy'); if (sv) sv.onclick = () => { const name = prompt('Name this animation:', 'My animation'); if (!name) return; const all = myList(); all.push({ name: name.slice(0, 40), rig: o.skel.rig, anim: { ...JSON.parse(JSON.stringify(o.anim)), dur: P.dur } }); toast(mySave(all) ? 'Saved to My animations (on this computer)' : "Couldn't save on this computer", !mySave); renderPanel(); };
    const cl = $('#pupClear'); if (cl) cl.onclick = () => { pushUndo(); o.anim = { keys: [] }; o.pose = null; bump(o); seek(P.t); renderPanel(); };
    const ur = $('#pupUnrig'); if (ur) ur.onclick = () => { pushUndo(); o.skel = null; o.anim = null; o.pose = null; if (o._pm) { scene.remove(o._pm); o._pm = null; } o.mesh.visible = o.visible; bump(o); dirty = true; renderPanel(); renderTimeline(); markers(); req(); };
    sec.querySelectorAll('[data-bg]').forEach((b) => b.onclick = () => { s.bg = b.dataset.bg; if (s.bg === 'image' && !s.img) pickBg(); layoutSet(); renderPanel(); });
    const bc = $('#pupBgCol'); if (bc) bc.oninput = () => { s.color = bc.value; layoutSet(); };
    const bi = $('#pupBgImg'); if (bi) bi.onclick = () => pickBg();
    $('#pupFloor').onchange = (e) => { s.floor = e.target.checked; setFloor.visible = s.floor; dirty = true; renderPanel(); req(); };
    $('#pupShadows').onchange = (e) => { s.shadows = e.target.checked; dirty = true; req(); };
    const fc = $('#pupFloorCol'); if (fc) fc.oninput = () => { s.floorColor = fc.value; floorMat.color.set(fc.value); req(); };
    $('#pupFrameChk').onchange = (e) => { s.frame = e.target.checked; layoutSet(); };
    sec.querySelectorAll('[data-res]').forEach((b) => b.onclick = () => { P.res = +b.dataset.res; renderPanel(); });
    $('#pupExport').onclick = () => exportVideo();
    $('#pupBack').onclick = () => leave();
  }
  function pickBg() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      const url = URL.createObjectURL(f), img = new Image();
      img.onload = () => {
        // cropped to the video's 16:9 shape (filling it), so the view and the video match
        const W = 1920, H = 1080, c = document.createElement('canvas'); c.width = W; c.height = H;
        const k = Math.max(W / img.naturalWidth, H / img.naturalHeight), w = img.naturalWidth * k, h = img.naturalHeight * k;
        c.getContext('2d').drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
        P.set.img = c.toDataURL('image/jpeg', 0.9); P.set.imgName = f.name; P.set.bg = 'image'; P.set._tex = null;
        P.set.floor = false; setFloor.visible = false; // the picture has its own ground: shadows only
        URL.revokeObjectURL(url); layoutSet(); renderPanel(); dirty = true; req();
      };
      img.src = url;
    };
    inp.click();
  }

  // ---------------------------------------------------------------- video export
  async function exportVideo() {
    if (P.exporting) return;
    const W = P.res === 1080 ? 1920 : 1280, H = P.res === 1080 ? 1080 : 720, fps = P.fps, frames = Math.max(1, Math.round(P.dur * fps));
    play(false);
    P.exporting = true; renderPanel(); markers(); req();
    const prog = $('#pupProg'), bar = prog && prog.firstElementChild; if (prog) prog.hidden = false;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    let r2;
    try { r2 = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }); }
    catch (e) { P.exporting = false; renderPanel(); toast("Couldn't start the video renderer here", true); return; }
    r2.outputColorSpace = renderer.outputColorSpace; r2.setPixelRatio(1); r2.setSize(W, H, false);
    // the set: background (picture or color), the characters and props, floor and shadows
    const es = new THREE.Scene();
    if (P.set.bg === 'image' && P.set.img) { const t = new THREE.TextureLoader().load(P.set.img); t.colorSpace = THREE.SRGBColorSpace; es.background = t; await new Promise((res) => { const i = new Image(); i.onload = res; i.onerror = res; i.src = P.set.img; }); t.needsUpdate = true; }
    else if (P.set.bg === 'color') es.background = new THREE.Color(P.set.color);
    else { const cs = getComputedStyle(document.documentElement); es.background = new THREE.Color(cs.getPropertyValue('--view-b').trim() || '#20242a'); }
    // the camera: the current view, cropped to the 16:9 frame
    const fr = frameRect(), cam = camera.clone();
    cam.aspect = W / H; cam.fov = 2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * (fr.h / fr.vh)) * 180 / Math.PI;
    cam.updateProjectionMatrix();
    const t0 = P.t;
    const draw = async (i) => {
      seek(i / fps); frame();
      while (es.children.length) es.remove(es.children[0]);
      for (const o of objects) {
        if (!o.visible) continue;
        const src = o.skel && o._pm ? o._pm : o.mesh;
        const m = new THREE.Mesh(src.geometry, src.material); m.matrixAutoUpdate = false; src.updateMatrixWorld(true); m.matrix.copy(src.matrixWorld); m.matrixWorld.copy(src.matrixWorld); es.add(m);
      }
      if (P.set.floor) { const f = setFloor.clone(); f.visible = true; es.add(f); }
      if (P.set.shadows) for (const b of blobs.children) es.add(b.clone());
      r2.render(es, cam);
      if (i % 3 === 0) { if (bar) bar.style.width = ((i + 1) / frames) * 100 + '%'; await new Promise((r) => setTimeout(r, 0)); }
    };
    let out = null, err = null;
    try { out = await MP4.record(canvas, frames, fps, draw, (f) => { if (bar) bar.style.width = f * 100 + '%'; }); }
    catch (e) { err = e; }
    if (!out && !err) {
      // no frame-by-frame encoder in this browser: record it as it plays instead
      try { out = await realTime(canvas, frames, fps, draw); } catch (e) { err = e; }
    }
    r2.dispose(); r2.forceContextLoss && r2.forceContextLoss();
    P.exporting = false; if (prog) prog.hidden = true; seek(t0); renderPanel(); markers(); req();
    if (err || !out) { toast("Couldn't make the video in this browser" + (err ? ': ' + (err.message || err) : ''), true); return; }
    const name = ((sel && sel.name) || 'animation').replace(/[^\w\- ]+/g, '').trim() || 'animation';
    const file = name + '.' + (out.ext || 'mp4');
    if (host && host.save) await host.save(file, out.bytes);
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out.bytes], { type: out.ext === 'webm' ? 'video/webm' : 'video/mp4' })); a.download = file; a.click(); }
    toast(`Video saved: ${file} (${W}×${H}, ${P.dur.toFixed(1)} s${out.codec ? ', ' + (out.codec === 'avc' ? 'H.264' : 'VP9') : ''})`);
  }
  async function realTime(canvas, frames, fps, draw) {
    if (!canvas.captureStream || typeof MediaRecorder === 'undefined') return null;
    const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    if (!type) return null;
    const stream = canvas.captureStream(fps), rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6e6 }), parts = [];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));
    rec.start();
    for (let i = 0; i < frames; i++) { const t = performance.now(); await draw(i); const wait = 1000 / fps - (performance.now() - t); if (wait > 0) await new Promise((r) => setTimeout(r, wait)); }
    rec.stop(); await done;
    return { bytes: new Uint8Array(await new Blob(parts).arrayBuffer()), ext: type.startsWith('video/mp4') ? 'mp4' : 'webm' };
  }

  // ---------------------------------------------------------------- saving with the sculpt
  const data = (o) => (o.skel ? { skel: { rig: o.skel.rig, motion: o.skel.motion || undefined, ver: o.skel.ver || 1, k: o.skel.k, parts: o.skel.parts || undefined, bones: o.skel.bones.map((b) => ({ name: b.name, parent: b.parent, head: b.head, tail: b.tail })) }, anim: o.anim ? { dur: o.anim.dur || P.dur, keys: o.anim.keys } : null } : null);
  function adopt(o, d) { if (!d || !d.skel) return; o.skel = JSON.parse(JSON.stringify(d.skel)); o.skel.ver = o.skel.ver || 1; o.anim = d.anim ? JSON.parse(JSON.stringify(d.anim)) : { keys: [] }; o._w = null; }

  // the top-bar button
  const btn = document.createElement('button'); btn.className = 'btn'; btn.id = 'pupBtn'; btn.setAttribute('aria-pressed', 'false');
  btn.title = 'Puppet Animator: rig, pose and animate your models, then export a video';
  btn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="3" r="1.6"/><path d="M8 4.6v5M5 6.5l3-1 3 1M8 9.6l-2 4M8 9.6l2 4M3 1.5h10" opacity=".9"/></svg><span class="hide-sm">Animate</span>';
  btn.onclick = () => (P.on ? leave() : enter());
  const fb = $('#frameBtn'); if (fb) fb.before(btn);

  return { P, enter, leave, frame, down, move, up, hover, key, data, adopt, seek, play, setKey, applyLib, addSkeleton, skin, solve, LIB, renderPanel, renderTimeline, get on() { return P.on; }, exportVideo, poseAt };
})();

// ---- History: every sculpting step, on a strip under the view; click a dot to go back to it
const HIST = (() => {
  const el = document.createElement('div'); el.id = 'hist'; view.append(el);
  let open = false;
  function render() {
    if (PUP.on) { el.hidden = true; return; }
    const u = undoStack.length, r = redoStack.length;
    el.hidden = !(u + r);
    if (el.hidden) return;
    const when = (s) => (s && s.at ? new Date(s.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
    const label = (s) => (s && s.tool ? ((BRUSHES.find((b) => b.id === s.tool) || OTHER_TOOLS.find((b) => b.id === s.tool) || { name: s.tool }).name) : 'Step');
    let dots = '';
    for (let i = 0; i < u; i++) dots += `<button class="hd past" data-h="${i - u}" title="Go back to before: ${esc(label(undoStack[i]))} ${when(undoStack[i])}"></button>`;
    dots += `<span class="hd now" title="Now"></span>`;
    for (let i = r - 1; i >= 0; i--) dots += `<button class="hd future" data-h="${r - i}" title="Go forward: ${esc(label(redoStack[i]))}"></button>`;
    el.innerHTML = `<button class="hist-t" id="histT" title="History: click a dot to go back to that point">History</button>${open ? `<div class="hist-dots">${dots}</div>` : `<span class="hist-n">${u} step${u === 1 ? '' : 's'}</span>`}`;
    $('#histT').onclick = () => { open = !open; render(); };
    el.querySelectorAll('[data-h]').forEach((b) => b.onclick = () => { const n = +b.dataset.h; if (n < 0) for (let i = 0; i < -n; i++) undo(); else for (let i = 0; i < n; i++) redo(); render(); });
  }
  return { render };
})();
