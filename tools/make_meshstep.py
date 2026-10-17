import os as _os
ROOT = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
# Builds src/meshstep.html from the Mesh to STEP Helper: runs inside JumpStart 3D (Simulate tab)
src = open(ROOT + '/tools/meshstep-source.html').read()
s = src
def R(a, b, count=1):
    global s
    assert a in s, a[:100]
    s = s.replace(a, b, count)
# its own three.js (with orbit controls), bundled so it works offline
three = open(ROOT + '/tools/three-global-orbit.min.js').read().replace('</script', '<\\/script')
R('<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>', '<script>' + three + '</script>')
R('<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>', '')
# newer three.js lights are dimmer at the same numbers
R("scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.75));", "scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.75 * Math.PI));")
R("const key = new THREE.DirectionalLight(0xffffff, 0.65);", "const key = new THREE.DirectionalLight(0xffffff, 0.65 * Math.PI);")
R("const fill = new THREE.DirectionalLight(0xffffff, 0.25);", "const fill = new THREE.DirectionalLight(0xffffff, 0.25 * Math.PI);")
# JumpStart 3D is a place the STEP can go too
R("'Saves a .zip containing your .step file. Unzip it, then import the .step into Fusion 360, Onshape or Inventor.'",
  "'Saves a .zip containing your .step file. Unzip it, then import the .step into JumpStart 3D, Fusion 360, Onshape or Inventor.'")
R("'Saves a .step file (AP214). Import it into Fusion 360, Onshape or Inventor as a solid body.'",
  "'Saves a .step file (AP214). Import it into JumpStart 3D, Fusion 360, Onshape or Inventor as a solid body.'")
# inside JumpStart 3D: a back button, and "Open in JumpStart 3D" that hands the STEP straight over
R('<div class="brand"><h1>Mesh to Step Helper</h1>', '<div class="brand"><h1>Mesh to Step Helper</h1>')
R('<p class="hint" id="dlHint"></p>', '''<p class="hint" id="dlHint"></p>
      <button class="btn" id="toJs3d" disabled hidden style="width:100%;margin-top:8px">Open in JumpStart 3D for CAD editing</button>''')
css = '''<style id="js3d">
#jsBack { margin-left: auto; white-space: nowrap; }
.top { gap: 12px; }
</style>'''
R('<header class="top">', css + '\n<header class="top">')
R("""// ---------- boot with sample ----------""", """// ---------- JumpStart 3D bridge ----------
(function(){
  const host = (() => { try { return parent !== window && parent.__JS3D_STEP_IMPORT__ ? parent : null; } catch (e) { return null; } })();
  if (!host) return;
  const top = document.querySelector('header.top');
  const back = document.createElement('button');
  back.className = 'btn'; back.id = 'jsBack'; back.type = 'button';
  back.innerHTML = '&larr; Back to JumpStart 3D';
  back.title = 'Close the helper';
  back.onclick = () => host.__JS3D_STEP_CLOSE__ && host.__JS3D_STEP_CLOSE__();
  top.appendChild(back);
  const btn = $('toJs3d');
  btn.hidden = false;
  const sync = () => { btn.disabled = !state.result; };
  setInterval(sync, 400);
  btn.onclick = async () => {
    if (!state.result) return;
    const blob = new Blob(state.result.stepChunks, { type: 'application/step' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    host.__JS3D_STEP_IMPORT__(bytes, state.name + '.step');
  };
})();
// theme from JumpStart 3D
// a file handed over from JumpStart 3D's Import dialog (waits for the sample to finish)
window.__meshstep = {
  theme: (t) => document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark'),
  load: (buf, name) => { window.__meshstepPending = { buf, name }; if (window.__meshstepBooted) window.__meshstepTake(); },
};
window.__meshstepTake = () => {
  const p = window.__meshstepPending; if (!p) return;
  window.__meshstepPending = null;
  loadBuffer(p.buf, p.name).then(() => { $('fname').textContent = p.name; document.querySelectorAll('[data-sample]').forEach(b => b.setAttribute('aria-pressed', 'false')); });
};

// ---------- boot with sample ----------""")
R("""document.querySelectorAll('[data-sample]').forEach(b => b.onclick = () => loadSample(b.dataset.sample));
loadSample('boss');""", """document.querySelectorAll('[data-sample]').forEach(b => b.onclick = () => loadSample(b.dataset.sample));
window.__meshstepBooted = true;
(() => {
  let waiting = null;
  try { waiting = parent !== window && parent.__JS3D_STEP_PENDING__; if (waiting) parent.__JS3D_STEP_PENDING__ = null; } catch (e) {}
  if (waiting) { window.__meshstepPending = waiting; window.__meshstepTake(); } else loadSample('boss');
})();""")
# Safari before 16.4 has no DecompressionStream: borrow JumpStart 3D's own unzipper
R("if (typeof DecompressionStream === 'undefined') throw new", "if (typeof DecompressionStream === 'undefined' && parent && parent.__JS3D_INFLATE__) return parent.__JS3D_INFLATE__(u8);\n    if (typeof DecompressionStream === 'undefined') throw new")
open(ROOT + '/src/meshstep.html', 'w').write(s)
# the stand-alone helper, with JumpStart 3D named under Download STEP
t = src.replace("'Saves a .zip containing your .step file. Unzip it, then import the .step into Fusion 360, Onshape or Inventor.'",
  "'Saves a .zip containing your .step file. Unzip it, then import the .step into JumpStart 3D, Fusion 360, Onshape or Inventor.'").replace(
  "'Saves a .step file (AP214). Import it into Fusion 360, Onshape or Inventor as a solid body.'",
  "'Saves a .step file (AP214). Import it into JumpStart 3D, Fusion 360, Onshape or Inventor as a solid body.'")
assert t != src
open(ROOT + '/mesh-to-step-helper.html', 'w').write(t)
print("written", len(s))
