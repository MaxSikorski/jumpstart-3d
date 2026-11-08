// Helpers kept separate from the CLI entry point so they can be tested without starting it.
export function safe(s) {
  return String(s).replace(/[\x00-\x1f\x7f-\x9f]/g, (c) => {
    if (c === "\n") return "\\n";
    if (c === "\r") return "\\r";
    if (c === "\t") return "\\t";
    return "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0");
  });
}

export function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino;
}
