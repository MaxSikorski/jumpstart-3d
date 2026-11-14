export function embedActive() {
  return typeof window !== "undefined" && window.parent !== window && /^(https?:)$/.test(location.protocol) && new URLSearchParams(location.search).has("embed");
}
