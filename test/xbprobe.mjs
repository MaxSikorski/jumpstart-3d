import { firefox } from "@playwright/test";
const base = { "webgl.force-enabled": true, "webgl.disable-fail-if-major-performance-caveat": true };
const variants = {
  A_force: { prefs: base, headless: true },
  B_force_sw: { prefs: { ...base, "gfx.webrender.software": true, "layers.acceleration.disabled": true }, headless: true },
  C_force_noangle: { prefs: { ...base, "webgl.disable-angle": true }, headless: true },
  D_egl: { prefs: { ...base, "gfx.x11-egl.force-enabled": true, "gfx.webrender.all": true }, headless: true },
  E_swgl_env: { prefs: base, headless: true, env: { LIBGL_ALWAYS_SOFTWARE: "1", MOZ_WEBRENDER: "0" } },
  F_headed: { prefs: base, headless: false },
  G_headed_sw: { prefs: { ...base, "gfx.webrender.software": true }, headless: false },
};
for (const [name, v] of Object.entries(variants)) {
  try {
    const b = await firefox.launch({ headless: v.headless, firefoxUserPrefs: v.prefs, env: { ...process.env, ...(v.env || {}) } });
    const p = await b.newPage();
    const r = await p.evaluate(() => { const c = document.createElement("canvas"); const g = c.getContext("webgl2", { stencil: true }) || c.getContext("webgl"); return g ? g.getParameter(g.VERSION) : "NONE"; });
    console.log(name, "->", r);
    await b.close();
  } catch (e) { console.log(name, "ERR", String(e).slice(0, 200)); }
}
