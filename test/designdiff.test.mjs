import { test } from "node:test";
import assert from "node:assert/strict";
import { designDiff } from "../src/designdiff.js";
import { historyCalls } from "../src/bridgehistory.js";
const doc = () => ({ id: "d1", bodies: [], sketches: [], params: [] });
const body = () => ({ id: "b1", name: "Box", node: { t: "prim", kind: "box", mods: [{ id: "f1", t: "fillet", r: 2 }] }, m: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] });

test("empty and reordered objects compare equally without mutation", () => {
  const a = doc(), b = { params: [], sketches: [], bodies: [], id: "d1" };
  assert.equal(designDiff(a, b), "No changes.");
  assert.deepEqual(a, doc());
});
test("bodies, sketches and parameter additions and removals", () => {
  const a = doc(), b = doc(); b.bodies.push(body()); b.sketches.push({id:"s1",name:"Outline"}); b.params.push({name:"width",expr:"20"});
  assert.match(designDiff(a,b), /Body added: Box \(b1\)/);
  assert.match(designDiff(a,b), /Sketch added: Outline/);
  assert.match(designDiff(a,b), /Parameter width: \(none\) -> "20"/);
  assert.match(designDiff(b,a), /Body removed/);
  assert.match(designDiff(b,a), /Sketch removed/);
  assert.match(designDiff(b,a), /"20" -> \(none\)/);
});
test("body edits, feature types, translation and parameter expressions", () => {
  const a=doc(); a.bodies.push(body()); a.params.push({name:"width",expr:"20"});
  const b=structuredClone(a), box=b.bodies[0]; box.name="Lid"; box.m[12]=5; box.m[14]=-2;
  box.color="#ffffff"; box.hole=true; box.hidden=true; box.node.mods[0].r=3; box.node.mods.push({id:"f2",t:"shell"}); b.params[0].expr="40";
  const out=designDiff(a,b);
  for(const re of [/renamed: "Box" -> "Lid"/, /delta \[5, 0, -2\]/, /color:/, /hole: false -> true/, /hidden: false -> true/, /feature changed: fillet/, /feature added: shell/, /"20" -> "40"/]) assert.match(out,re);
  assert.match(designDiff(b,a),/feature removed: shell/);
  assert.equal(a.bodies[0].node.mods[0].r,2);
});
test("cache is ignored; shape, sketch, feature order and other fields are visible", () => {
  const a=doc(); a.bodies.push(body()); a.sketches.push({id:"s",curves:[]});
  const b=structuredClone(a); b.bodies[0]._key="cache";
  assert.equal(designDiff(a,b),"No changes.");
  b.bodies[0].node.kind="sphere"; b.sketches[0].curves.push({id:"line"}); b.grid=2;
  assert.match(designDiff(a,b),/shape definition changed/); assert.match(designDiff(a,b),/Sketch changed/); assert.match(designDiff(a,b),/Design grid changed/);
  a.bodies[0].node.mods.push({id:"f2",t:"shell"}); b.bodies[0].node.mods=structuredClone(a.bodies[0].node.mods).reverse();
  assert.match(designDiff(a,b),/feature order changed/);
});
function harness() {
  const store={doc:doc(), undo:[], update(fn,label) { const next=structuredClone(this.doc); fn(next); this.undo.push({doc:this.doc,label}); this.doc=next; }};
  let blocked=false;
  const api=historyCalls({store,snapshot:()=>structuredClone(store.doc),edit:()=>{if(blocked)throw Error("leave Chisel mode first");}});
  return {store,api,block:()=>{blocked=true;}};
}
test("snapshot isolation, whole-doc restoration and one undo step", () => {
  const {store,api}=harness(); store.doc.sketches.push({id:"s",curves:[]}); const original=structuredClone(store.doc);
  const c=api.checkpoint("safe"); c.label="mutated"; api.checkpoints()[0].bodies=99;
  store.doc.bodies.push(body()); store.doc.params.push({name:"w",expr:"4"}); store.doc.sketches[0].curves.push(1); store.doc.extra=true;
  const newer=structuredClone(store.doc), c2=api.checkpoint();
  assert.match(api.diff(c.id,c2.id),/Body added/);
  assert.deepEqual(api.rollback(c.id),{...c,label:"safe"});
  assert.deepEqual(store.doc,original); assert.equal(store.undo.length,1); assert.deepEqual(store.undo[0].doc,newer);
  store.doc.sketches[0].curves.push(2); api.rollback(c.id); assert.deepEqual(store.doc,original);
});
test("monotonic ids, FIFO cap, helpful errors and label validation", () => {
  const {api}=harness(); assert.throws(()=>api.diff("c9"),/no checkpoint "c9"; none yet: call checkpoint first/);
  assert.throws(()=>api.checkpoint({}),/label must be a string/);
  for(let i=0;i<22;i++)api.checkpoint();
  const list=api.checkpoints(); assert.equal(list.length,20); assert.equal(list[0].id,"c3"); assert.equal(list.at(-1).id,"c22"); assert.ok(Number.isFinite(Date.parse(list[0].at)));
  assert.throws(()=>api.rollback("c1"),/no checkpoint "c1"; checkpoints: c3, c4/);
  assert.throws(()=>api.diff("c3","c99"),/no checkpoint "c99"/);
});
test("wrong design and edit guard refuse without a mutation", () => {
  const {api,store,block}=harness(); const c=api.checkpoint(); store.doc.id="d2";
  assert.throws(()=>api.rollback(c.id),{message:"checkpoint c1 belongs to another design; checkpoints are kept per design"});
  block(); assert.throws(()=>api.rollback(c.id),/leave Chisel mode first/); assert.equal(store.undo.length,0);
});
