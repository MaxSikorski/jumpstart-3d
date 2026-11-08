// Project pictures are embedded raster data, never addresses to fetch.
// Videos are runtime-only: their object URLs are created directly from picked
// files in media.js, never read from the document. Even same-origin blob URLs
// in a project cannot prove they were created by this page, so reject them.
export function isSafeMediaSrc(src, kind) {
  return kind === "image" && typeof src === "string" &&
    /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(src);
}

export function warnUnsafeMedia(id) {
  console.warn("Left out unsafe media", id);
}

// Keep body references so the existing missing-media placeholder is displayed.
export function dropUnsafeMedia(doc) {
  let dropped = false;
  for (const [id, m] of Object.entries(doc.media || {})) {
    if (m?.src !== undefined && !isSafeMediaSrc(m.src, m.kind)) {
      warnUnsafeMedia(id); delete doc.media[id]; dropped = true;
    }
  }
  for (const sk of doc.sketches || []) {
    if (sk.image && !isSafeMediaSrc(sk.image.src, "image")) {
      warnUnsafeMedia(sk.id); delete sk.image; dropped = true;
    }
  }
  return dropped;
}
