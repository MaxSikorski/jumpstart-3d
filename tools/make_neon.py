import os as _os
ROOT = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
# Builds src/neon.html: the Neon Sign Builder (Simulate tab), with its own three.js and geometry code inlined
s = open(ROOT + '/tools/neon-source.html').read()
three = open(ROOT + '/tools/three-global-orbit.min.js').read().replace('</script', '<\\/script')
geo = open(ROOT + '/tools/neon_geo.js').read().replace('</script', '<\\/script')
assert '<!--THREE-->' in s and '/*NEON_GEO*/' in s
# jumpstart-3d: the shared three.js (src/helper-three.html, the same orbit build) goes in when the page opens (src/helperfonts.js), as for Chisel
s = s.replace('<!--THREE-->', '<script>/*js3d:three*/</script>', 1).replace('/*NEON_GEO*/', geo, 1)
open(ROOT + '/src/neon.html', 'w').write(s)
print("written", len(s))
