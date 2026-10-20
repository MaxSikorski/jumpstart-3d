import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectTriangleMesh, sectionTriangleMesh, sampleSolidIntervals, selectGeometry } from '../src/mcp-geometry.js';
const cube={vertices:[0,0,0, 2,0,0, 2,2,0, 0,2,0, 0,0,2, 2,0,2, 2,2,2, 0,2,2],triangles:[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7]};
test('closed mesh dimensions, winding, components and volume use generated triangles',()=>{
 const r=inspectTriangleMesh(cube);assert.deepEqual(r.bounds.dimensions,[2,2,2]);assert.equal(r.boundaryEdges,0);assert.equal(r.nonManifoldEdges,0);assert.equal(r.inconsistentWindingEdges,0);assert.equal(r.disconnectedComponents,1);assert.ok(Math.abs(r.signedVolume-8)<1e-10);
 const transformed=inspectTriangleMesh({...cube,matrix:[2,0,0,0,0,1,0,0,0,0,1,0,4,0,0,1]});assert.deepEqual(transformed.bounds.min,[4,0,0]);assert.deepEqual(transformed.bounds.dimensions,[4,2,2]);
});
test('mesh defects are independently counted',()=>{
 assert.equal(inspectTriangleMesh({...cube,triangles:cube.triangles.slice(3)}).boundaryEdges,3);
 assert.equal(inspectTriangleMesh({...cube,triangles:[...cube.triangles,0,0,1]}).degenerateTriangles,1);
 assert.equal(inspectTriangleMesh({...cube,triangles:[...cube.triangles,0,2,1]}).nonManifoldEdges,3);
 const two={vertices:[...cube.vertices,...cube.vertices.map((v,i)=>v+(i%3===0?5:0))],triangles:[...cube.triangles,...cube.triangles.map(i=>i+8)]};assert.equal(inspectTriangleMesh(two).disconnectedComponents,2);
});
test('sections and solid samples are measured from triangle intersections',()=>{
 const s=sectionTriangleMesh(cube,{axis:'X',offset:1});assert.equal(s.segments.length,8);assert.ok(s.segments.flat().every(p=>p[0]===1));
 assert.deepEqual(sampleSolidIntervals(cube,{point:[.7,.8,0]}).intervals,[[0,2]]);
 assert.deepEqual(sampleSolidIntervals(cube,{point:[3,3,0]}).intervals,[]);
 assert.equal(sectionTriangleMesh(cube,{offset:0}).coplanarTriangles,2);
 assert.throws(()=>sectionTriangleMesh(cube,{offset:1,maxSegments:1}),/limit/);
});
test('validation rejects unbounded and malformed inputs',()=>{
 assert.throws(()=>inspectTriangleMesh({...cube,vertices:[NaN,0,0]}),/non-finite/);
 assert.throws(()=>inspectTriangleMesh({...cube,triangles:[0,1,100]}),/index/);
 assert.throws(()=>inspectTriangleMesh(cube,{tolerance:0}),/tolerance/);
 assert.throws(()=>sampleSolidIntervals(cube,{point:[0,0]}),/point/);
 assert.throws(()=>sectionTriangleMesh(cube,{axis:'q',offset:1}),/axis/);
});
test('semantic queries reject stale references and never silently choose ambiguity',()=>{
 const selectors={edges:[{index:0,t:'CIRCLE',m:[0,0,0]},{index:1,t:'CIRCLE',m:[0,0,2]}]};
 const opts={kind:'edge',expectedFingerprint:'abc',currentFingerprint:'abc'};
 assert.equal(selectGeometry(selectors,{...opts,predicate:{type:'CIRCLE',axis:'Z',extreme:'max'}}).selected.index,1);
 assert.equal(selectGeometry(selectors,opts).status,'ambiguous');
 assert.equal(selectGeometry({...selectors,truncated:true},{...opts,predicate:{extreme:'max'}}).status,'incomplete');
 assert.equal(selectGeometry(selectors,{...opts,predicate:{near:[0,0,0]}}).selected.index,0);
 assert.throws(()=>selectGeometry(selectors,{...opts,currentFingerprint:'changed'}),/Stale/);
 assert.throws(()=>selectGeometry(selectors,{...opts,predicate:{execute:'bad'}}),/Unsupported/);
 const faces={faces:[{index:0,t:'CYLINDRE',r:12,ext:true,c:[0,0,5]},{index:1,t:'CYLINDRE',r:10,ext:false,c:[0,0,5]},{index:2,t:'PLANE',n:[0,0,1],c:[0,0,10]}]};
 assert.equal(selectGeometry(faces,{...opts,kind:'face',predicate:{type:'CYLINDRE',external:false,radius:10}}).selected.index,1);
 assert.equal(selectGeometry(faces,{...opts,kind:'face',predicate:{normal:[0,0,1]}}).selected.index,2);
});
