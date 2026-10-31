# Builds the extra Text-tool fonts: each one cut down to the letters the tool uses (the same set
# as the built-in fonts), a variable font fixed at a bold weight first, and renamed
# "JumpStart <style>" (the OFL lets modified fonts be shared, but not under a Reserved Font Name).
# Usage: python3 tools/make_fonts.py <google-fonts checkout> fontlist.txt
# fontlist.txt lines: key|path[@weight]|original name|style label|group
import sys, os, json, base64, io
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.varLib import instancer
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src, lst = sys.argv[1], sys.argv[2]
chars = sorted(TTFont(os.path.join(ROOT, "fontsub", "sans.ttf")).getBestCmap().keys())
out, credits = [], []
for line in open(lst):
    line = line.strip()
    if not line or line.startswith("#"): continue
    key, path, orig, label, group = line.split("|")
    wght = None
    if "@" in path: path, wght = path.split("@"); wght = float(wght)
    f = TTFont(os.path.join(src, path))
    if "fvar" in f:
        loc = {}
        for a in f["fvar"].axes:
            if a.axisTag == "wght": loc["wght"] = max(a.minValue, min(a.maxValue, wght or a.defaultValue))
            else: loc[a.axisTag] = a.defaultValue
        f = instancer.instantiateVariableFont(f, loc)
    opts = subset.Options(); opts.layout_features = ["kern", "liga"]; opts.name_IDs = ["*"]; opts.notdef_outline = True; opts.hinting = False; opts.drop_tables += ["DSIG", "FFTM"]
    sub = subset.Subsetter(opts); sub.populate(unicodes=chars); sub.subset(f)
    lic_dir = os.path.join(src, os.path.dirname(path))
    lic_file = next((os.path.join(lic_dir, n) for n in ("OFL.txt", "LICENSE.txt") if os.path.exists(os.path.join(lic_dir, n))), None)
    lic_text = open(lic_file, encoding="utf-8-sig").read() if lic_file else ""
    ofl = "SIL OPEN FONT LICENSE" in lic_text.upper()
    rfn = ofl and "reserved font name" in lic_text.split("PREAMBLE")[0].lower()
    copyright = str(f["name"].getDebugName(0) or "").strip()
    if not copyright and lic_text: copyright = lic_text.strip().split("\n")[0]
    new = "JumpStart " + label
    for rec in f["name"].names:
        if rec.nameID in (1, 4, 16, 18, 21): rec.string = new
        elif rec.nameID == 6 or rec.nameID == 20: rec.string = new.replace(" ", "")
        elif rec.nameID == 3: rec.string = new + " (subset)"
        elif rec.nameID in (2, 17, 22): rec.string = "Regular"
    b = io.BytesIO(); f.save(b); data = b.getvalue()
    open(os.path.join(ROOT, "fontsub", "more", key + ".ttf"), "wb").write(data)
    shown = label if rfn else f"{orig} ({label.lower()})"
    out.append({"key": key, "name": shown, "group": group, "data": base64.b64encode(data).decode()})
    credits.append({"key": key, "orig": orig, "rfn": rfn, "lic": "SIL Open Font License 1.1" if ofl else "Apache License 2.0", "copy": copyright, "src": "https://github.com/google/fonts/tree/main/" + os.path.dirname(path), "bytes": len(data)})
    print(f"{key:14s} {len(data):7d} bytes  {'RFN ' if rfn else '    '}{'OFL' if ofl else 'Apache'}  {shown}")
js = ["// More fonts for the Text tool (made by tools/make_fonts.py): subsets of open-licence fonts from",
      "// the Google Fonts collection, renamed \"JumpStart <style>\". Licences and copyrights: licenses.js.",
      "// Only the main page carries these; the geometry worker is sent the ones it needs.",
      "import { registerFont } from \"./fonts.js\";",
      "export const MORE_FONTS = " + json.dumps([{k: v for k, v in o.items() if k != "data"} for o in out]) + ";",
      "const DATA = {"]
for o in out: js.append(f'  {o["key"]}: "{o["data"]}",')
js += ["};", "for (const [k, b64] of Object.entries(DATA)) registerFont(k, b64);", ""]
open(os.path.join(ROOT, "src", "fonts_more.js"), "w").write("\n".join(js))
json.dump(credits, open(os.path.join(ROOT, "fontsub", "more", "credits.json"), "w"), indent=1)
print(len(out), "fonts,", sum(c["bytes"] for c in credits), "bytes")
