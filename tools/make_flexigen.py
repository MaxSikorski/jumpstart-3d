import os as _os
ROOT = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
# Builds src/flexigen.html from the Super Flexi Builder source: runs inside JumpStart 3D as "FlexiGen"
import re
src = open(ROOT + '/tools/flexi-source.html').read()
s = src
def R(a, b, count=1):
    global s
    assert a in s, a[:100]
    s = s.replace(a, b, count)
# three.js comes from JumpStart 3D (no network needed)
# its own copy of three.js (bundled, no network): the viewer's typed arrays must come from the same window
three = open(ROOT + '/tools/three-global.min.js').read().replace('</script', '<\\/script')
R('<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>',
  '<script>' + three + '</script>')
# brand
R('<title>Super Flexi Builder</title>', '<title>FlexiGen</title>')
R('<div><h1>Super <span>Flexi</span> <em>Builder</em></h1><p>Print-in-place articulation for any STL or 3MF</p></div></div>',
  '<div><h1>Flexi<span>Gen</span></h1><p>Print-in-place articulation for your JumpStart 3D model</p></div></div>\n    <button class="btn primary" id="jsBack" type="button" title="Close FlexiGen. Your design is not changed.">&larr; Back to JumpStart 3D</button>')
R("const hdr = 'Super Flexi Builder print-in-place export';", "const hdr = 'JumpStart 3D FlexiGen print-in-place export';")
# no file picking or brand downloads here: the model comes from the design
css = '''<style id="js3d">
#drop, .theme { display: none !important; }
.js3d-hide { display: none !important; }
#jsBack { margin-left: auto; white-space: nowrap; }
.js3d-note { margin: 6px 0 0; font-size: 12.5px; line-height: 1.45; opacity: .85; }
</style>'''
R('</head>', css + '</head>')
# saving goes through JumpStart 3D (works in claude.ai and in the downloaded file)
R('async function saveFile(filename, bytes, opts = {}) {',
  'async function saveFile(filename, bytes, opts = {}) {\n  if (parent && parent.__JS3D_SAVE__) { try { await parent.__JS3D_SAVE__(filename, bytes); toast(\'Saved \' + filename); } catch (e) { toast(\'Could not save the file.\'); } return; }')
# start empty; JumpStart 3D hands over the model
R("loadSoup(makeSampleSoup(), 'sample-salamander').then(() => { requestAnimationFrame(frame); });",
  """requestAnimationFrame(frame);
// --- JumpStart 3D bridge
document.querySelectorAll('[data-logo]').forEach((b) => { const blk = b.closest('.sub-block'); if (blk) blk.classList.add('js3d-hide'); });
$('jsBack').addEventListener('click', () => parent.__JS3D_FLEXI_CLOSE__ && parent.__JS3D_FLEXI_CLOSE__());
window.__flexi = {
  load: async (soup, name) => {
    await loadSoup(soup, name);
    const note = document.createElement('p'); note.className = 'js3d-note';
    note.textContent = 'This is a copy of “' + name + '”. Nothing you do here changes your design.';
    const ls = $('loadStatus'); if (ls && !document.querySelector('.js3d-note')) ls.after(note);
  },
  theme: (t) => setAppTheme(t),
};
if (parent && parent.__JS3D_FLEXI_READY__) parent.__JS3D_FLEXI_READY__();""")
# newer three.js lights are dimmer at the same numbers: scale them up
R("scene.add(new THREE.HemisphereLight(0xffffff, 0x445048, 0.75));", "scene.add(new THREE.HemisphereLight(0xffffff, 0x445048, 0.75 * Math.PI));")
R("const sun = new THREE.DirectionalLight(0xffffff, 0.75);", "const sun = new THREE.DirectionalLight(0xffffff, 0.75 * Math.PI);")
R("const fill = new THREE.DirectionalLight(0xffffff, 0.25);", "const fill = new THREE.DirectionalLight(0xffffff, 0.25 * Math.PI);")
# theme comes from JumpStart 3D, not its own saved choice
s = s.replace("try { localStorage.setItem('superFlexiTheme', v); } catch (e) { /* storage unavailable */ }", "")
# Safari before 16.4 has no DecompressionStream: borrow JumpStart 3D's own unzipper
R("const ds = new DecompressionStream('deflate-raw');", "if (typeof DecompressionStream === 'undefined' && parent && parent.__JS3D_INFLATE__) return parent.__JS3D_INFLATE__(u8);\n    const ds = new DecompressionStream('deflate-raw');")
open(ROOT + '/src/flexigen.html', 'w').write(s)
print("written", len(s))
