// jumpstart-3d: self-hosted fonts. A srcdoc helper page (FlexiGen, Mesh to STEP) cannot see the page's @font-face rules,
// so it gets a copy. build.mjs puts the rules in <style id="js3d-fonts">; the site's urls are made absolute so a blob: tab finds the files too.
export function withFonts(html) {
  const rules = document.getElementById("js3d-fonts");
  if (!rules) return html;
  const style = "<style>" + rules.textContent.split("url(fonts/").join("url(" + new URL("fonts/", document.baseURI).href) + "</style>";
  return /<head[\s>]/i.test(html) ? html.replace(/<head(\s[^>]*)?>/i, (m) => m + style) : style + html;
}
