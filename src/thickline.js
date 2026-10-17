// Thick screen-space lines (WebGL draws 1 px lines only): each segment becomes a quad that
// is widened in the vertex shader to w pixels.
import * as THREE from "three";
export function thickLines(seg, hex, w, depth) {
  const lin = (c) => (c < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const col = [lin(((hex >> 16) & 255) / 255), lin(((hex >> 8) & 255) / 255), lin((hex & 255) / 255)];
  const pos = [], oth = [], side = [];
  const push = (P, Q, s) => { pos.push(P[0], P[1], P[2]); oth.push(Q[0], Q[1], Q[2]); side.push(s); };
  for (let k = 0; k + 5 < seg.length; k += 6) {
    const A = [seg[k], seg[k + 1], seg[k + 2]], B = [seg[k + 3], seg[k + 4], seg[k + 5]];
    push(A, B, -1); push(A, B, 1); push(B, A, 1);
    push(A, B, 1); push(B, A, -1); push(B, A, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aOther", new THREE.Float32BufferAttribute(oth, 3));
  g.setAttribute("aSide", new THREE.Float32BufferAttribute(side, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uRes: { value: [800, 600] }, uW: { value: w }, uC: { value: col } },
    vertexShader: "uniform vec2 uRes;uniform float uW;attribute vec3 aOther;attribute float aSide;void main(){vec4 a=projectionMatrix*modelViewMatrix*vec4(position,1.0);vec4 b=projectionMatrix*modelViewMatrix*vec4(aOther,1.0);vec2 sa=a.xy/a.w*uRes*.5;vec2 sb=b.xy/b.w*uRes*.5;vec2 d=sa-sb;float l=length(d);d=l>1e-5?d/l:vec2(1.0,0.0);vec2 n=vec2(-d.y,d.x);vec2 o=(d+n*aSide)*uW*.5;gl_Position=vec4(a.xy+o*2.0/uRes*a.w,a.z,a.w);}",
    fragmentShader: "uniform vec3 uC;void main(){gl_FragColor=vec4(uC,1.0);\n#include <colorspace_fragment>\n}",
    depthTest: depth, depthWrite: false, side: THREE.DoubleSide,
  });
  const o = new THREE.Mesh(g, m);
  const tmp = new THREE.Vector2();
  o.frustumCulled = false;
  o.onBeforeRender = (r) => { r.getSize(tmp); m.uniforms.uRes.value = [tmp.x, tmp.y]; };
  // let callers recolor it like a line material
  o.setColor = (h) => { const c = new THREE.Color(h); m.uniforms.uC.value = [c.r, c.g, c.b]; };
  return o;
}
