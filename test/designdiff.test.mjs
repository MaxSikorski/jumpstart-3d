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

test("assets and media are summarized per id without stringifying data", () => {
  const a=doc(), b=doc(); a.assets={old:{kind:"step",name:"Old",data:"x".repeat(2048)},same:{kind:"mesh",name:"S",data:"abc"},chg:{kind:"mesh",name:"C",data:"aa"}};
  b.assets={same:a.assets.same,chg:{kind:"mesh",name:"C",data:"aaaa"},fresh:{kind:"mesh",name:"Chip",data:"y".repeat(4096)}}; b.media={m1:{kind:"image",name:"Pic",data:"z"}};
  const out=designDiff(a,b);
  assert.match(out,/Asset added: fresh \(mesh, Chip, 4 KB\)/); assert.match(out,/Asset removed: old \(step, Old, 2 KB\)/);
  assert.match(out,/Asset changed: chg/); assert.match(out,/Media added: m1/); assert.doesNotMatch(out,/Asset \w+: same/);
  assert.ok(!out.includes("yyyy")); assert.ok(!out.includes("xxxx"));
});
test("other large keys only report that they changed", () => {
  const a=doc(), b=doc(); a.cosforge={big:"q".repeat(5000)}; b.cosforge={big:"r".repeat(5000)}; a.planes=[1]; b.planes=[2];
  const out=designDiff(a,b); assert.match(out,/^Design cosforge changed\.$/m); assert.match(out,/^Design planes changed\.$/m); assert.ok(out.length<100);
});
test("output is capped by lines, bytes and value length", () => {
  const a=doc(), b=doc(); for(let i=0;i<500;i++) b.bodies.push({id:"b"+i,name:"B"+i});
  const out=designDiff(a,b).split("\n"); assert.equal(out.length,201); assert.equal(out.at(-1),"...and 300 more changes");
  const c=doc(), d=doc(); for(let i=0;i<100;i++) d.bodies.push({id:"b"+i,name:"N".repeat(500)});
  const text=designDiff(c,d); assert.ok(text.length<=20*1024+60); assert.match(text,/more changes$/);
  const e=doc(), f=doc(); e.bodies.push(body()); f.bodies.push(body()); f.bodies[0].node.mods[0].note="L".repeat(5000); f.bodies[0].node.mods[0].r=9;
  const fx=designDiff(e,f); assert.ok(fx.length<500); assert.match(fx,/feature changed: fillet \(f1\): /); assert.match(fx,/r: 2 -> 9/); assert.match(fx,/note: \(none\) -> "L+\.\.\./);
});
test("checkpoint refuses in Chisel, caps labels, diff refuses another design", () => {
  const {api,store,block}=harness(); assert.throws(()=>api.checkpoint("x".repeat(201)),/200 characters/); api.checkpoint("x".repeat(200));
  const c=api.checkpoint(); store.doc.id="d2"; assert.throws(()=>api.diff(c.id),/belongs to another design/); assert.throws(()=>api.diff("c1",c.id),/belongs to another design/);
  store.doc.id="d1"; block(); assert.throws(()=>api.checkpoint(),/leave Chisel mode first/);
});
test("rollback keeps current mode, refuses in sim, skips __proto__, shares assets map entries", () => {
  const store={doc:{...doc(),mode:"beginner",assets:{a:{kind:"mesh",name:"A",data:"d"}}}, undo:[], update(fn,l){const n=structuredClone(this.doc);fn(n);this.undo.push(l);this.doc=n;}};
  let sim=false; const api=historyCalls({store,snapshot:()=>structuredClone(store.doc),edit(){},app:{get simLock(){return sim;}}});
  const c=api.checkpoint(); store.doc.mode="advanced"; store.doc.assets.b={kind:"mesh",name:"B",data:"e"};
  sim=true; assert.throws(()=>api.rollback(c.id),{message:"undo is off in the 3D Print Sim"}); assert.equal(store.undo.length,0);
  sim=false; api.rollback(c.id); assert.equal(store.doc.mode,"advanced"); assert.deepEqual(Object.keys(store.doc.assets),["a"]);
  Object.defineProperty(store.doc,"__proto__",{value:{polluted:1},enumerable:true,configurable:true,writable:true}); api.checkpoint();
  store.doc.bodies.push(body()); api.rollback("c2");
  assert.equal(Object.getPrototypeOf(store.doc),Object.prototype); assert.equal(store.doc.polluted,undefined); assert.equal(({}).polluted,undefined);
});
