// Inline SVG icons (stroke style) and shape tile drawings.
const S = (body, extra = "") => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;

export const ICON = {
  sketch: S('<rect x="3" y="3" width="18" height="18" rx="1" stroke-dasharray="2 2"/><path d="M7 16 12 7l5 9z"/>'),
  extrude: S('<path d="M5 17h10l4-3H9z" fill="#c9d8f2"/><path d="M5 17V9h10v8M15 9l4-3v8M5 9l4-3h10"/><path d="M12 3v4M10.5 4.5 12 3l1.5 1.5" stroke="#1f4fa8"/>'),
  revolve: S('<ellipse cx="12" cy="17" rx="7" ry="3"/><path d="M5 17V9M19 17V9"/><ellipse cx="12" cy="9" rx="7" ry="3"/><path d="M12 3v18" stroke-dasharray="2 2" stroke="#1f4fa8"/>'),
  fillet: S('<path d="M4 20V10a6 6 0 0 1 6-6h10"/><path d="M4 4h4M4 4v4" stroke-dasharray="1.5 2"/><path d="M8 8l-4-4" stroke="#1f4fa8"/>'),
  chamfer: S('<path d="M4 20V10l6-6h10"/><path d="M4 4h6M4 4v6" stroke-dasharray="1.5 2"/>'),
  hole: S('<path d="M3 9l9-4 9 4-9 4z"/><path d="M3 9v6l9 4 9-4V9"/><ellipse cx="12" cy="9" rx="3" ry="1.4" fill="#1f4fa8" stroke="#1f4fa8"/><path d="M9 9v5M15 9v5" stroke="#1f4fa8" stroke-dasharray="1.5 1.5"/>'),
  shell: S('<path d="M4 8v10h16V8"/><path d="M7 8v7h10V8"/><path d="M4 8h3M17 8h3"/>'),
  combine: S('<rect x="3" y="7" width="11" height="11" rx="1"/><circle cx="15" cy="10" r="6" fill="#c9d8f2" fill-opacity=".7"/>'),
  move: S('<path d="M12 3v18M3 12h18"/><path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>'),
  del: S('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  box: S('<path d="M4 8l8-4 8 4-8 4z"/><path d="M4 8v8l8 4 8-4V8M12 12v8"/>'),
  cylinder: S('<ellipse cx="12" cy="6" rx="7" ry="2.6"/><path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6"/>'),
  sphere: S('<circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="8" ry="3"/>'),
  torus: S('<ellipse cx="12" cy="12" rx="9" ry="5"/><ellipse cx="12" cy="11.5" rx="3.5" ry="1.6"/>'),
  cone: S('<path d="M12 3 5 18M12 3l7 15"/><ellipse cx="12" cy="18" rx="7" ry="2.6"/>'),
  flexigen: S('<rect x="2.5" y="9" width="5" height="6" rx="2"/><rect x="9.5" y="8" width="5" height="8" rx="2"/><rect x="16.5" y="9" width="5" height="6" rx="2"/><circle cx="8.5" cy="12" r="1" fill="currentColor"/><circle cx="15.5" cy="12" r="1" fill="currentColor"/>'),
  render: S('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3.2"/><path d="M8.5 3.5h7"/><path d="M17.5 8.5h.01"/>'),
  appearance: S('<path d="M5 13.5 12.5 6l5.5 5.5L10.5 19z"/><path d="M12.5 6 10 3.5"/><path d="M18 11.5h1.2c.8 0 1.3.9.9 1.6l-.8 1.4"/><path d="M20 17.5c0 1-.7 1.8-1.5 1.8s-1.5-.8-1.5-1.8 1.5-3 1.5-3 1.5 2 1.5 3z" fill="currentColor"/>'),
  prism: S('<path d="M6 7l3-3h6l3 3-3 3H9zM6 7v10l3 3h6l3-3V7M9 10v10M15 10v10"/>'),
  pyramid: S('<path d="M12 3 4 17l8 4 8-4zM12 3v18"/>'),
  tube: S('<ellipse cx="12" cy="6" rx="7" ry="2.6"/><ellipse cx="12" cy="6" rx="3.5" ry="1.2"/><path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6"/>'),
  capsule: S('<rect x="3" y="7" width="18" height="10" rx="5"/><path d="M8 10h8"/>'),
  line: S('<path d="M5 19 19 5"/><circle cx="5" cy="19" r="1.6" fill="currentColor"/><circle cx="19" cy="5" r="1.6" fill="currentColor"/>'),
  rect: S('<rect x="4" y="6" width="16" height="12"/><circle cx="4" cy="18" r="1.5" fill="currentColor"/><circle cx="20" cy="6" r="1.5" fill="currentColor"/>'),
  spline: S('<path d="M3 17c3-9 6-11 9-6s6 4 9-5"/><circle cx="3" cy="17" r="1.4" fill="currentColor"/><circle cx="12" cy="11" r="1.4" fill="currentColor"/><circle cx="21" cy="6" r="1.4" fill="currentColor"/>'),
  svgfile: S('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M8.5 16.5c1.5-4 3-4 4-2s2.5 2 3-1.5" stroke="#1f4fa8"/>'),
  dxffile: S('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 17v-5h5M9 12l5 5" stroke="#1f4fa8"/>'),
  image: S('<rect x="3" y="5" width="18" height="14" rx="1.5"/><circle cx="8.5" cy="10" r="1.6"/><path d="m4 18 5-5 3 3 3-4 5 6" stroke="#1f4fa8"/>'),
  import: S('<path d="M12 3v11M7.5 9.5 12 14l4.5-4.5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>'),
  rect3: S('<path d="M5 15 13 5l7 6-8 9z"/><circle cx="5" cy="15" r="1.5" fill="currentColor"/><circle cx="13" cy="5" r="1.5" fill="currentColor"/><circle cx="20" cy="11" r="1.5" fill="currentColor"/>'),
  rectc: S('<rect x="4" y="6" width="16" height="12"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="20" cy="6" r="1.5" fill="currentColor"/>'),
  circle: S('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><path d="M12 12h8" stroke-dasharray="1.5 1.5"/>'),
  arc3: S('<path d="M4 18a10 10 0 0 1 16 0"/><circle cx="4" cy="18" r="1.5" fill="currentColor"/><circle cx="20" cy="18" r="1.5" fill="currentColor"/><circle cx="12" cy="9.6" r="1.5" fill="currentColor"/>'),
  arcc: S('<path d="M20 12a8 8 0 0 0-8-8"/><path d="M12 12V4M12 12h8" stroke-dasharray="1.5 1.5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>'),
  polygon: S('<path d="M12 3l8 5v8l-8 5-8-5V8z"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>'),
  offset: S('<path d="M4 20h16M4 20V11h16v9" /><path d="M4 11V7h16v4" stroke-dasharray="2 2"/><path d="M12 9V2M9.5 4.5 12 2l2.5 2.5" stroke="#1f4fa8"/>'),
  lock: S('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  unlock: S('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>'),
  magnet: S('<path d="M6 3v8a6 6 0 0 0 12 0V3"/><path d="M6 3h4v8a2 2 0 0 0 4 0V3h4" /><path d="M6 7h4M14 7h4"/>'),
  theme: S('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor"/>'),
  keyboard: S('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
  pattern: S('<rect x="3" y="3" width="5" height="5" rx="1"/><rect x="10" y="3" width="5" height="5" rx="1" stroke-dasharray="2 1.5"/><rect x="17" y="3" width="4" height="5" rx="1" stroke-dasharray="2 1.5"/><rect x="3" y="11" width="5" height="5" rx="1" stroke-dasharray="2 1.5"/><rect x="10" y="11" width="5" height="5" rx="1" stroke-dasharray="2 1.5"/><circle cx="12" cy="20" r="1.5" fill="currentColor"/>'),
  text: S('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'),
  point: S('<path d="M12 7v10M7 12h10"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/>'),
  trim: S('<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M8 15 17 4M16 15 7 4"/>'),
  dim: S('<path d="M4 8v8M20 8v8M4 12h16"/><path d="m7 10-3 2 3 2M17 10l3 2-3 2"/>'),
  select: S('<path d="M5 3l14 8-6 2-3 6z"/>'),
  construction: S('<path d="M4 20 20 4" stroke-dasharray="3 2.5"/>'),
  finish: S('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>'),
  copy: S('<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  paste: S('<rect x="5" y="4" width="14" height="17" rx="1.5"/><rect x="9" y="2.5" width="6" height="3" rx="1"/>'),
  duplicate: S('<rect x="9" y="9" width="11" height="11" rx="1.5"/><rect x="4" y="4" width="11" height="11" rx="1.5"/><path d="M14.5 12v5M12 14.5h5"/>'),
  group: S('<rect x="3" y="3" width="10" height="10" rx="1"/><rect x="11" y="11" width="10" height="10" rx="1"/><path d="M2 2h3M2 2v3M22 22h-3M22 22v-3"/>'),
  ungroup: S('<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>'),
  planeOffset: S('<path d="M3 16l6-4h12l-6 4z"/><path d="M3 10l6-4h12l-6 4z" fill="#f6c58a" fill-opacity=".5" stroke="#c9790c"/><path d="M12 14V9" stroke="#1f4fa8"/>'),
  planeAngle: S('<path d="M3 18l6-4h12l-6 4z"/><path d="M6 17 10 5h10l-4 12" fill="#f6c58a" fill-opacity=".5" stroke="#c9790c"/>'),
  planeMid: S('<path d="M3 19l6-3h12l-6 3z"/><path d="M3 6l6-3h12l-6 3z"/><path d="M3 12.5l6-3h12l-6 3z" fill="#f6c58a" fill-opacity=".5" stroke="#c9790c"/>'),
  joint: S('<circle cx="8" cy="15" r="4"/><circle cx="8" cy="15" r="1.2" fill="currentColor"/><path d="M11 12.5 19 5"/><path d="M16 4.5 20 4l-.5 4" stroke="#1f4fa8"/><path d="M3 21h10"/>'),
  drive: S('<circle cx="12" cy="12" r="8"/><path d="M12 12l4-5" stroke="#1f4fa8"/><path d="M10 4.5a8 8 0 0 1 9 4" stroke="#1f4fa8" stroke-dasharray="2 1.6"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>'),
  motion: S('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9v6l5-3z" fill="#1f4fa8" stroke="#1f4fa8"/>'),
  stress: S('<path d="M4 18h16"/><path d="M6 18V9l6-3 6 3v9"/><path d="M6 12h12" stroke="#d9534f"/><path d="M6 15h12" stroke="#e8a317"/><path d="M12 2v3M10 3.5 12 5l2-1.5" stroke="#1f4fa8"/>'),
  printer3d: S('<path d="M4 4h16v4H4z"/><path d="M12 8v3"/><path d="M10.5 11h3l-1.5 2z" fill="currentColor"/><path d="M5 20h14"/><path d="M8 20v-3h8v3" stroke="#1f4fa8"/><path d="M8 17.5h8M8 18.7h8" stroke="#1f4fa8" stroke-width="1"/>'),
  clearSim: S('<circle cx="12" cy="12" r="8"/><path d="M8 8l8 8M16 8l-8 8"/>'),
  sweep: S('<path d="M4 19c4 0 5-3 7-7s4-7 9-7" stroke="#1f4fa8" stroke-dasharray="2 1.6"/><ellipse cx="5" cy="17" rx="2" ry="3.2"/><path d="M5 13.8c4 0 5-3 7-6.8s4-5 7.5-5.4M5 20.2c4.5 0 6-3.2 8-7s3.4-5.8 7-6"/>'),
  thread: S('<path d="M8 3h8v18H8z"/><path d="M8 6l8-2M8 10l8-2M8 14l8-2M8 18l8-2" stroke="#1f4fa8"/>'),
  texture: S('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9l6-6M3 15 15 3M3 21 21 3M9 21l12-12M15 21l6-6" stroke="#1f4fa8" stroke-width="1.3"/>'),
  scale: S('<rect x="3" y="11" width="10" height="10" rx="1"/><path d="M13 11V5h6v6h-6" stroke-dasharray="2 1.6"/><path d="M14 10l6-6M16 4h4v4" stroke="#1f4fa8"/>'),
  align: S('<path d="M4 3v18"/><rect x="7" y="5" width="12" height="5" rx="1"/><rect x="7" y="14" width="7" height="5" rx="1"/>'),
  splitBody: S('<path d="M4 9l8-4 8 4v7l-8 4-8-4z"/><path d="M3 13.5 21 10.5" stroke="#d9534f" stroke-dasharray="2 1.6"/>'),
  splitFace: S('<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M12 5v14" stroke="#d9534f" stroke-dasharray="2 1.6"/>'),
  loft: S('<rect x="5" y="16" width="14" height="5" rx="1" transform="skewX(-20) translate(5 0)"/><circle cx="12" cy="5" r="2.6"/><path d="M9.4 5.5 7 16M14.6 5.5 17 16"/>'),
  mirror: S('<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 6 3 18h6zM15 6l6 12h-6z"/>'),
  holeToggle: S('<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2"/>'),
  drop: S('<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>'),
  eye: S('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: S('<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/>'),
  close: S('<path d="M6 6l12 12M18 6 6 18"/>'),
  body: S('<path d="M4 8l8-4 8 4-8 4z"/><path d="M4 8v8l8 4 8-4V8"/>'),
  combineIcon: S('<rect x="3" y="7" width="11" height="11" rx="1"/><circle cx="15" cy="10" r="6"/>'),
  lathe: S('<path d="M1.5 12h3M19.5 12h3"/><path d="M4.5 8.5c3 0 3.5 2 6 2s3-2.5 5.5-2.5c2 0 3.5.8 3.5.8v6.4s-1.5.8-3.5.8c-2.5 0-3-2.5-5.5-2.5s-3 2-6 2z"/><path d="M12 22l2.5-6.5" stroke="#1f4fa8" stroke-width="2.2"/>'),
  bricks: S('<rect x="3" y="13" width="18" height="7" rx="1"/><rect x="7" y="6" width="10" height="7" rx="1" stroke="#1f4fa8"/><path d="M6 13v-1.6h3V13M15 13v-1.6h3V13M9 6V4.4h2V6M13 6V4.4h2V6"/>'),
  pipe: S('<path d="M4 20V11a7 7 0 0 1 7-7h9" stroke-width="5.5" stroke="#1f4fa8" opacity=".25"/><path d="M4 20V11a7 7 0 0 1 7-7h9"/><ellipse cx="4" cy="20" rx="2.6" ry="1"/><ellipse cx="20" cy="4" rx="1" ry="2.6"/>'),
  coil: S('<path d="M6 19c0 1.2 2.7 2 6 2s6-.8 6-2-2.7-2-6-2-6-.8-6-2 2.7-2 6-2 6-.8 6-2-2.7-2-6-2-6-.8-6-2 2.7-2 6-2 6 .8 6 2"/><path d="M12 3v18" stroke="#1f4fa8" stroke-dasharray="1.5 2"/>'),
  constraints: S('<path d="M4 20 20 4" /><path d="M4 4v16h16" stroke="#1f4fa8"/><circle cx="12" cy="12" r="2" fill="currentColor"/>'),
  cCoincident: S('<path d="M3 19 13 9"/><path d="M11 21 21 11" stroke="#1f4fa8"/><circle cx="12" cy="10" r="2.6" fill="currentColor"/>'),
  cHorizontal: S('<path d="M3 12h18"/><circle cx="3.5" cy="12" r="1.6" fill="currentColor"/><circle cx="20.5" cy="12" r="1.6" fill="currentColor"/><path d="M9 6h6M12 6v12" stroke="#1f4fa8" stroke-width="1.4"/>'),
  cVertical: S('<path d="M12 3v18"/><circle cx="12" cy="3.5" r="1.6" fill="currentColor"/><circle cx="12" cy="20.5" r="1.6" fill="currentColor"/><path d="M6 8l3 8 3-8" stroke="#1f4fa8" stroke-width="1.4" fill="none" transform="translate(6 0)"/>'),
  cParallel: S('<path d="M4 18 16 4"/><path d="M9 20 21 6" stroke="#1f4fa8"/>'),
  cPerpendicular: S('<path d="M4 20h16"/><path d="M12 20V4" stroke="#1f4fa8"/><path d="M12 16h4v4" stroke-width="1.3"/>'),
  cTangent: S('<circle cx="11" cy="13" r="6"/><path d="M3 7h18" stroke="#1f4fa8"/>'),
  cConcentric: S('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4" stroke="#1f4fa8"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
  cMidpoint: S('<path d="M3 17h18"/><path d="M12 8.5 15.5 14h-7z" fill="#1f4fa8" stroke="#1f4fa8" stroke-linejoin="round"/><path d="M3 15v4M21 15v4" stroke-width="1.3"/>'),
  cEqual: S('<path d="M4 9h16M4 15h16" stroke="#1f4fa8"/><path d="M4 5v8M20 5v8" stroke-width="1.3" transform="translate(0 2)"/>'),
  features: S('<path d="M5 19c0-6 3-11 7-11s7 5 7 11"/><path d="M12 8V3M9.5 5.5 12 3l2.5 2.5" stroke="#1f4fa8"/><path d="M3 19h18"/>'),
  copy2: S('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>'),
  paste2: S('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2.5h6V4" /><path d="M9 11h6M9 15h4" stroke="#1f4fa8"/>'),
  printsim: S('<path d="M4 4h16v4H4z"/><path d="M12 8v3"/><path d="M10.5 11h3l-1.5 2z" fill="currentColor"/><path d="M5 20h14"/><path d="M8 20v-3h8v3" stroke="#1f4fa8"/><circle cx="18.5" cy="14.5" r="3" stroke="#1f4fa8"/><path d="M17.7 13.4v2.2l1.8-1.1z" fill="#1f4fa8" stroke="none"/>'),
  emboss: S('<path d="M3 19h18" /><path d="M6 16 11 4h2l5 12" /><path d="M8.5 11h7" /><path d="M4 21.5h16" stroke="#1f4fa8" stroke-dasharray="2 1.5"/>'),
  section: S('<path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5z"/><path d="M12 4v16" stroke="#1f4fa8" stroke-width="2.2"/><path d="M12 8.2 16 10.4M12 12l4 2.2M12 15.8l4 2.2" stroke="#1f4fa8" stroke-width="1.2"/>'),
  measure: S('<path d="M3 16.5 16.5 3 21 7.5 7.5 21z"/><path d="M7 13l2 2M10 10l1.5 1.5M13 7l2 2M16 4l1.5 1.5" stroke="#1f4fa8"/>'),
  prim: S('<path d="M4 8l8-4 8 4-8 4z"/><path d="M4 8v8l8 4 8-4V8M12 12v8"/>'),
};

// isometric-ish tile drawings for the beginner shape panel
const T = (body, fill = "#e4572e") => `<svg viewBox="0 0 48 42" aria-hidden="true"><g fill="${fill}" stroke="#2b333d" stroke-width="1" stroke-linejoin="round">${body}</g></svg>`;
const shade = (c, k) => {
  const n = parseInt(c.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
};
function tile(kind, c) {
  const L = shade(c, 1.12), D = shade(c, 0.78);
  switch (kind) {
    case "box": return T(`<path d="M8 14 24 7l16 7-16 7z" fill="${L}"/><path d="M8 14v15l16 8V21z" fill="${c}"/><path d="M40 14v15l-16 8V21z" fill="${D}"/>`);
    case "cylinder": return T(`<path d="M9 11v19c0 3 7 5.5 15 5.5s15-2.5 15-5.5V11" fill="${c}"/><ellipse cx="24" cy="11" rx="15" ry="5.5" fill="${L}"/>`);
    case "sphere": return T(`<circle cx="24" cy="21" r="16" fill="${c}"/><ellipse cx="19" cy="15" rx="6" ry="4" fill="${L}" stroke="none" opacity=".8"/>`);
    case "cone": return T(`<path d="M24 4 9 31c0 3 7 5.5 15 5.5S39 34 39 31z" fill="${c}"/><path d="M24 4 39 31c0 3-7 5.5-15 5.5" fill="${D}" stroke="none" opacity=".45"/>`);
    case "pyramid": return T(`<path d="M24 4 8 27l16 9z" fill="${c}"/><path d="M24 4l16 23-16 9z" fill="${D}"/>`);
    case "wedge": return T(`<path d="M8 14 24 21v16L8 29z" fill="${c}"/><path d="M8 14l16 7 16-7-16-7z" fill="${L}" opacity="0"/><path d="M24 21 40 29v0l-16 8z" fill="${D}"/><path d="M8 14l16 7 16 8-16-7z" fill="${L}"/>`);
    case "torus": return T(`<ellipse cx="24" cy="23" rx="18" ry="10" fill="${c}"/><ellipse cx="24" cy="21" rx="7" ry="3.3" fill="#f7f8fa"/>`);
    case "tube": return T(`<path d="M9 11v19c0 3 7 5.5 15 5.5s15-2.5 15-5.5V11" fill="${c}"/><ellipse cx="24" cy="11" rx="15" ry="5.5" fill="${L}"/><ellipse cx="24" cy="11" rx="9" ry="3.2" fill="${D}"/>`);
    case "hemisphere": return T(`<path d="M8 26a16 16 0 0 1 32 0c0 3-7 5.5-16 5.5S8 29 8 26z" fill="${c}"/><ellipse cx="24" cy="26" rx="16" ry="5.5" fill="${D}" opacity=".35"/>`);
    case "prism": return T(`<path d="M10 12l7-5h14l7 5v17l-7 5H17l-7-5z" fill="${c}"/><path d="M10 12l7 4h14l7-4-7-5H17z" fill="${L}"/><path d="M17 16v18M31 16v18" fill="none"/>`);
    case "text": return T(`<path d="M7 8h20v6h-6v20h-8V14H7z" fill="${D}" transform="translate(3 2)"/><path d="M7 8h20v6h-6v20h-8V14H7z" fill="${c}"/><path d="M30 34l5-15 5 15h-3l-1-4h-2l-1 4z" fill="${c}"/>`);
    case "star": return T(`<path d="M24 5l5 10.5 11.5 1.5-8.4 8 2.1 11.5L24 31l-10.2 5.5 2.1-11.5-8.4-8L19 15.5z" fill="${c}"/><path d="M24 31v6l-10.2 5.5" fill="none" stroke="none"/>`);
    case "heart": return T(`<path d="M24 37C14 30 7 24 7 16.5 7 11 11 7.5 15.5 7.5c3.6 0 6.5 2.2 8.5 5 2-2.8 4.9-5 8.5-5C37 7.5 41 11 41 16.5 41 24 34 30 24 37z" fill="${c}"/><path d="M14 13c1.5-2 4-2.4 5.5-1.5" fill="none" stroke="${L}" stroke-width="2.2" stroke-linecap="round"/>`);
    case "roof": return T(`<path d="M8 29 L16.0 15.25 L32.0 8.25 L24 22z" fill="${D}"/><path d="M24 36 L40 29 L32.0 8.25 L16.0 15.25z" fill="${L}"/><path d="M8 29 L24 36 L16.0 15.25z" fill="${c}"/>`);
    case "roundroof": return T(`<path d="M8.0 29.0 L8.15 26.14 L8.61 23.53 L9.35 21.26 L10.34 19.42 L11.56 18.08 L12.94 17.3 L28.94 10.3 L30.44 10.11 L32.0 10.5 L33.56 11.47 L35.06 12.98 L36.44 14.97 L37.66 17.37 L38.65 20.08 L39.39 22.99 L39.85 26.01 L40.0 29.0 L24.0 36.0z" fill="${L}"/><path d="M24.0 36.0 L23.85 33.01 L23.39 29.99 L22.65 27.08 L21.66 24.37 L20.44 21.97 L19.06 19.98 L17.56 18.47 L16.0 17.5 L14.44 17.11 L12.94 17.3 L11.56 18.08 L10.34 19.42 L9.35 21.26 L8.61 23.53 L8.15 26.14 L8.0 29.0z" fill="${c}"/>`);
    case "paraboloid": return T(`<path d="M8 32C12 14 18 5 24 5s12 9 16 27c0 3-7 5-16 5S8 35 8 32z" fill="${c}"/><ellipse cx="24" cy="32" rx="16" ry="5" fill="${D}" opacity=".35"/>`);
    case "gem": return T(`<path d="M24 4 8 16l4 14 12 8 12-8 4-14z" fill="${c}"/><path d="M24 4l-8 13h16zM16 17 8 16l4 14 4-13zM32 17l8-1-4 14-4-13z" fill="${L}"/><path d="M16 17l8 21 8-21z" fill="${D}"/>`);
    case "spring": return T(`<g fill="none" stroke="${c}" stroke-width="3.2" stroke-linecap="round"><path d="M10 34c0 2.4 6 4 14 4s14-1.6 14-4-6-4-14-4-14-1.6-14-4 6-4 14-4 14-1.6 14-4-6-4-14-4-14-1.6-14-4 6-4 14-4 14 1.6 14 4"/></g><g fill="none" stroke="#2b333d" stroke-width=".8" opacity=".55"><path d="M10 34c0 2.4 6 4 14 4s14-1.6 14-4M10 26c0 2.4 6 4 14 4M38 22c0-2.4-6-4-14-4"/></g>`);
    case "capsule": return T(`<path d="M14 13h20a10 10 0 0 1 0 20H14a10 10 0 0 1 0-20z" fill="${c}"/><path d="M14 15h20a7 4 0 0 1 0 6H14a7 4 0 0 1 0-6z" fill="${L}" stroke="none" opacity=".75"/>`);
    case "arrow": return T(`<path d="M5 20h22v-8l16 12-16 12v-8H5z" fill="${D}" transform="translate(0 3)"/><path d="M5 18h22v-8l16 12-16 12v-8H5z" fill="${c}"/>`);
    default: return T("");
  }
}
export function shapeTile(kind, color, hole = false) {
  if (hole) {
    const svg = tile(kind, "#c9d0d8");
    return svg.replace('stroke="#2b333d"', 'stroke="#6b7682" stroke-dasharray="2 1.5"');
  }
  return tile(kind, color);
}
