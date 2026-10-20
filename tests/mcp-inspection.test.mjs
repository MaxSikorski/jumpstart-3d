import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectGeometry, measureParallelChannels } from '../src/mcp-inspection.js';

// Independently construct a stepped solid from exposed grid-cell faces, without CAD plans.
function groovedMesh() {
 const xs=[-12,12], ys=[-10,-7,-5,-1,1,5,7,10], zs=[0,3,6], vertices=[],triangles=[];
 const solid=(x,y,z)=>x===0&&y>=0&&y<ys.length-1&&z>=0&&z<2&&(z===0||y%2===0);
 const quad=(points)=>{const at=vertices.length/3;vertices.push(...points.flat());triangles.push(at,at+1,at+2,at,at+2,at+3);};
 for(let y=0;y<ys.length-1;y++)for(let z=0;z<2;z++)if(solid(0,y,z)) {
  const [a,b]=xs,[c,d]=ys.slice(y,y+2),[e,f]=zs.slice(z,z+2);
  quad([[a,c,e],[a,c,f],[a,d,f],[a,d,e]]);quad([[b,c,e],[b,d,e],[b,d,f],[b,c,f]]);
  if(!solid(0,y-1,z))quad([[a,c,e],[b,c,e],[b,c,f],[a,c,f]]);
  if(!solid(0,y+1,z))quad([[a,d,e],[a,d,f],[b,d,f],[b,d,e]]);
  if(!solid(0,y,z-1))quad([[a,c,e],[a,d,e],[b,d,e],[b,c,e]]);
  if(!solid(0,y,z+1))quad([[a,c,f],[b,c,f],[b,d,f],[a,d,f]]);
 }
 return {vertices,triangles};
}
test('channel measurements derive from triangle intersections, with wrong expected values failing',()=>{
 const mesh=groovedMesh(),actual=measureParallelChannels(mesh,{axis:'Y',crossAt:0});
 assert.equal(actual.count,3);assert.deepEqual(actual.widths,[2,2,2]);assert.deepEqual(actual.spacings,[6,6]);assert.equal(actual.depth,3);assert.equal(actual.floor,3);assert.equal(actual.openEnds,true);assert.equal(actual.symmetric,true);
 const check={id:'grooves',kind:'channels',axis:'Y',crossAt:0,expected:{count:3,width:2,depth:3,floor:3,spacing:6,symmetric:true,openEnds:true},tolerance:.01};
 assert.equal(inspectGeometry(mesh,{checks:[check]}).checks[0].pass,true);
 assert.equal(inspectGeometry(mesh,{checks:[{...check,expected:{width:4}}]}).checks[0].pass,false);
 assert.equal(inspectGeometry(mesh,{checks:[{...check,expected:{count:4},tolerance:1}]}).checks[0].pass,false);
 assert.equal(inspectGeometry(mesh,{checks:[{id:'x',kind:'dimension',axis:'X',expected:25,tolerance:.01}]}).checks[0].pass,false);
});
test('unsupported sections fail explicitly rather than trusting submitted dimensions',()=>{
 assert.throws(()=>measureParallelChannels(groovedMesh(),{axis:'Z'}),/supports/);
 const result=inspectGeometry(groovedMesh(),{checks:[{id:'outside',kind:'channels',axis:'Y',crossAt:30,expected:{count:3}}]});
 assert.equal(result.checks[0].pass,false);assert.equal(result.physicalFit,'unverified');
 const mesh=groovedMesh();
 assert.throws(()=>inspectGeometry({...mesh,triangles:Array.from({length:600000},()=>0)},{checks:[{kind:'channels'}]}),/budget/);
});
