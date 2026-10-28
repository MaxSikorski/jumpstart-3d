// jumpstart-3d: self-hosted fonts. A srcdoc helper page (FlexiGen, Mesh to STEP, Chisel) cannot see the page's @font-face rules,
// so it gets a copy. build.mjs puts the rules in <style id="js3d-fonts">; the site's urls are made absolute so a blob: tab finds the files too.
// The three pages also share one three.js (helper-three.html, the orbit build), put in here when a page opens, so app.js carries it once
// instead of three times. Each page still runs its own copy: typed arrays from the host window do not work with a frame's three.js.
import THREE_PAGE from "./helper-three.html";
export function withFonts(html) {
  html = html.replace("<script>/*js3d:three*/</script>", () => THREE_PAGE);
  const rules = document.getElementById("js3d-fonts");
  if (!rules) return html;
  const style = "<style>" + rules.textContent.split("url(fonts/").join("url(" + new URL("fonts/", document.baseURI).href) + "</style>";
  return /<head[\s>]/i.test(html) ? html.replace(/<head(\s[^>]*)?>/i, (m) => m + style) : style + html;
}
