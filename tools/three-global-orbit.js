// three.js as a global (THREE), plus a small OrbitControls (rotate, pan, zoom, damping) for
// embedded tools written against the old examples/js build.
import * as T from "three";
class OrbitControls extends T.EventDispatcher {
  constructor(camera, dom) {
    super();
    this.object = camera; this.domElement = dom;
    this.target = new T.Vector3();
    this.enableDamping = false; this.dampingFactor = 0.05; this.screenSpacePanning = true;
    this.rotateSpeed = 1; this.zoomSpeed = 1;
    const sph = new T.Spherical(), dSph = new T.Spherical(0, 0, 0), pan = new T.Vector3();
    let scale = 1, state = null, last = [0, 0];
    const pointers = new Map();
    // orbit about the camera's up direction (Z-up scenes too)
    const q = new T.Quaternion(), qi = new T.Quaternion();
    const sync = () => { q.setFromUnitVectors(camera.up.clone().normalize(), new T.Vector3(0, 1, 0)); qi.copy(q).invert(); const off = camera.position.clone().sub(this.target).applyQuaternion(q); sph.setFromVector3(off); };
    this.update = () => {
      sync();
      sph.theta += dSph.theta; sph.phi += dSph.phi;
      sph.phi = Math.max(1e-4, Math.min(Math.PI - 1e-4, sph.phi));
      sph.radius = Math.max(1e-6, sph.radius * scale);
      this.target.add(pan);
      camera.position.copy(this.target).add(new T.Vector3().setFromSpherical(sph).applyQuaternion(qi));
      camera.lookAt(this.target);
      const moved = Math.abs(dSph.theta) > 1e-6 || Math.abs(dSph.phi) > 1e-6 || Math.abs(scale - 1) > 1e-6 || pan.lengthSq() > 1e-12;
      if (this.enableDamping) { dSph.theta *= 1 - this.dampingFactor; dSph.phi *= 1 - this.dampingFactor; pan.multiplyScalar(1 - this.dampingFactor); }
      else { dSph.theta = 0; dSph.phi = 0; pan.set(0, 0, 0); }
      scale = 1;
      if (moved) this.dispatchEvent({ type: "change" });
      return moved;
    };
    const panBy = (dx, dy) => {
      const h = dom.clientHeight || 1;
      const dist = camera.position.distanceTo(this.target) * Math.tan(((camera.fov || 50) / 2) * Math.PI / 180) * 2 / h;
      const x = new T.Vector3().setFromMatrixColumn(camera.matrix, 0).multiplyScalar(-dx * dist);
      const y = new T.Vector3().setFromMatrixColumn(camera.matrix, 1).multiplyScalar(dy * dist);
      pan.add(x).add(y);
    };
    dom.style.touchAction = "none";
    dom.addEventListener("contextmenu", (e) => e.preventDefault());
    dom.addEventListener("pointerdown", (e) => {
      dom.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      state = pointers.size > 1 ? "pan" : e.button === 2 || e.button === 1 || e.shiftKey || e.ctrlKey ? "pan" : "rotate";
      last = [e.clientX, e.clientY];
    });
    dom.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      const dx = e.clientX - last[0], dy = e.clientY - last[1];
      last = [e.clientX, e.clientY];
      const h = dom.clientHeight || 1;
      if (state === "rotate") { dSph.theta -= (2 * Math.PI * dx / h) * this.rotateSpeed; dSph.phi -= (2 * Math.PI * dy / h) * this.rotateSpeed; }
      else if (state === "pan") panBy(dx, dy);
      this.dispatchEvent({ type: "change" });
    });
    const end = (e) => { pointers.delete(e.pointerId); if (!pointers.size) state = null; };
    dom.addEventListener("pointerup", end);
    dom.addEventListener("pointercancel", end);
    dom.addEventListener("wheel", (e) => { e.preventDefault(); scale *= Math.pow(0.95, -Math.sign(e.deltaY) * this.zoomSpeed); this.dispatchEvent({ type: "change" }); }, { passive: false });
  }
}
window.THREE = Object.assign({}, T, { OrbitControls });
