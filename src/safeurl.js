// Project pictures are embedded raster data, never addresses to fetch.
// Videos are runtime-only: their object URLs are created directly from picked
// files in media.js, never read from the document. Even same-origin blob URLs
// in a project cannot prove they were created by this page, so reject them.
export function isSafeMediaSrc(src, kind) {
  return kind === "image" && typeof src === "string" &&
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(src);
}

export function isSafeThumb(src) {
  return typeof src === "string" && src.length <= 200_000 &&
    /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(src);
}

export function warnUnsafeMedia(id) {
  console.warn("Left out unsafe media", id);
}

// Clean sources and body colors before load listeners render the document.
export function dropUnsafeMedia(doc) {
  let dropped = false;
  const removed = new Set();
  for (const [id, m] of Object.entries(doc.media || {})) {
    if (!m || typeof m !== "object" || Array.isArray(m) || (m.src !== undefined && !isSafeMediaSrc(m.src, m.kind))) {
      warnUnsafeMedia(id); delete doc.media[id]; removed.add(id); dropped = true;
    }
  }
  const cleanBody = (b) => {
    if (!b || typeof b !== "object") return;
    if (b.color !== undefined && (typeof b.color !== "string" || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(b.color))) b.color = "#a7b0ba";
    if (b.media && removed.has(b.media.id)) delete b.media;
    cleanNode(b.node);
  };
  const cleanNode = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.color !== undefined && (typeof node.color !== "string" || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(node.color))) node.color = "#a7b0ba";
    cleanNode(node.src);
    for (const child of node.children || []) cleanBody(child);
    for (const mod of node.mods || []) {
      cleanNode(mod.tool);
      for (const tool of mod.tools || []) cleanBody(tool);
    }
  };
  for (const b of doc.bodies || []) cleanBody(b);
  for (const sk of doc.sketches || []) {
    if (sk.image && sk.image.src !== null && !isSafeMediaSrc(sk.image.src, "image")) {
      warnUnsafeMedia(sk.id); sk.image.src = null; dropped = true;
    }
  }
  return dropped;
}
