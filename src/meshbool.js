// Joins, cuts and combines that involve an imported mesh run on Manifold (a small triangle-mesh geometry engine) instead of OpenCascade.
// OpenCascade has to turn every triangle of a mesh into a CAD face first (seconds, and fragile where faces touch); Manifold works on the
// triangles directly. See .claude/plans/manifold-booleans-design.md. This file is ours (not J.Siwek's); kernel.js calls it from a few
// marked places.
//
// Loading: the engine is part of the geometry worker's file (third_party/manifold-3d/, about 225 KB gzipped) and starts only when a
// design has an imported mesh: worker.js calls startManifold() on a mesh "asset" message and waits for manifoldReady() before a build.
// A failed start leaves Manifold unavailable and every operation runs on OpenCascade, as before.
import loadManifold from "../third_party/manifold-3d/index.js";

let M = null, loading = null, loadError = null;
export function startManifold() {
  if (!loading) loading = loadManifold().then((m) => { M = m; }, (e) => { M = null; loadError = e; loading = null; });
  return loading;
}
export const manifoldReady = () => loading; // the promise while a start is under way or done, else null (nothing asked for Manifold yet)
export const manifoldModule = () => M;
export const manifoldError = () => loadError;
