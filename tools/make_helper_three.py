import os as _os
ROOT = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
three = open(ROOT + '/tools/three-global-orbit.min.js').read().replace('</script', '<\\/script')
s = '<script>' + three + '</script>'
open(ROOT + '/src/helper-three.html', 'w').write(s)
print('helper-three.html', len(s))
