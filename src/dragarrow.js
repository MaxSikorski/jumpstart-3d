// jumpstart-3d: shared, outlined pull arrow for Extrude and Offset face.
import * as THREE from "three";
import { thickLines } from "./thickline.js";
import { theme } from "./theme.js";

// Every core, hover and cut colour is at least 3:1 against its theme’s 3D background and workplane (THEMES[name].bg and .wp.bg in theme.js).
const COLORS = {
  light: { core: 0x1d4ed8, outline: 0xffffff, hover: 0xb45309, cut: 0xc81e1e },
  dark: { core: 0x6ea8ff, outline: 0x0b0e12, hover: 0xffb43a, cut: 0xff6b6e },
  contrast: { core: 0xffd400, outline: 0x000000, hover: 0x00e5ff, cut: 0xff5c5c },
};
export function arrowColors() { return COLORS[theme.name]; }

export function drawDragArrow(group, vp, { origin, n, len, hot, cut, touch }) {
  const colors = arrowColors(), color = hot ? colors.hover : cut ? colors.cut : colors.core;
  const size = touch ? 1.4 : 1, sign = Math.sign(len) || 1;
  const tip = origin.clone().addScaledVector(n, len), head = tip.clone();
  // Resolve pixel size at the head, including its offset in perspective views.
  for (let i = 0; i < 6; i++) {
    const px = vp.pixelSize(head);
    head.copy(tip).addScaledVector(n, sign * 72 * size * px);
  }
  const px = vp.pixelSize(head) * size, seg = [...origin.toArray(), ...head.toArray()];
  const outline = thickLines(seg, colors.outline, 13 * size, false);
  const core = thickLines(seg, color, 8 * size, false);
  // The workplane uses the transparent pass; all four arrow meshes must follow it.
  outline.material.transparent = core.material.transparent = true;
  outline.renderOrder = 998; core.renderOrder = 999;
  group.add(outline, core);
  const cone = (hex, scale, order) => {
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(1, 2.6, 16), new THREE.MeshBasicMaterial({ color: hex, depthTest: false, depthWrite: false, transparent: true }));
    mesh.position.copy(head);
    mesh.scale.setScalar(scale * px * (hot ? 1.15 : 1));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.clone().multiplyScalar(sign));
    mesh.renderOrder = order;
    group.add(mesh);
    return mesh;
  };
  const headOutline = cone(colors.outline, 18, 1000), headCore = cone(color, 15, 1001);
  // thickLines stores linear RGB uniforms; retain the intended sRGB hex as well.
  return { origin, n, tip, head, core, outline, headCore, headOutline, colors, color, outlineColor: colors.outline };
}

export function overDragArrow(vp, arrow, e) {
  if (!arrow) return null;
  const [mx, my] = vp.local(e), h = vp.project(arrow.head), o = vp.project(arrow.origin);
  if (Math.hypot(h[0] - mx, h[1] - my) < vp.tol(36)) return arrow;
  const dx = h[0] - o[0], dy = h[1] - o[1];
  const t = Math.max(0, Math.min(1, ((mx - o[0]) * dx + (my - o[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(o[0] + t * dx - mx, o[1] + t * dy - my) < vp.tol(16) ? arrow : null;
}
