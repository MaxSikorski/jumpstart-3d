// Inside a frame on another page, the app is always a temporary workspace (Max, 2026-11-14), so a framing website never sees the
// person's designs or settings. Only ?embed=<origins> lets those websites control it (embedInvited).
export function embedActive() {
  return typeof window !== "undefined" && window.parent !== window && /^(https?:)$/.test(location.protocol);
}
export function embedInvited() {
  return embedActive() && new URLSearchParams(location.search).has("embed");
}
