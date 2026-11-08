import { test, expect } from "@playwright/test";
import { boot, watchErrors } from "./helpers.mjs";
let page, errors;
test.beforeAll(async ({browser}, info) => {
  page=await browser.newPage(); errors=watchErrors(page);
  await page.addInitScript(()=>localStorage.setItem("jumpstart.chisel.intro","1"));
  await boot(page,info);
});
test.afterAll(async()=>{await page.close();});
test.afterEach(()=>expect(errors).toEqual([]));

test("checkpoint, diff, full rollback and undo restore the newer design",async()=>{
  const result=await page.evaluate(async()=>{
    await JS3D.newDesign("beginner");
    const original=JS3D.doc(), c=JS3D.checkpoint("before box");
    const id=JS3D.add("box"); JS3D.setParam("width","30");
    const newer=JS3D.doc(), c2=JS3D.checkpoint("after box"), diff=JS3D.diff(c.id), between=JS3D.diff(c.id,c2.id);
    const depth=JS3D.internals.store.undoStack.length;
    const restored=JS3D.rollback(c.id), sync=!(restored instanceof Promise);
    const after=JS3D.doc(), list=JS3D.list(), steps=JS3D.internals.store.undoStack.length-depth;
    const unchanged=JS3D.diff(c.id); JS3D.undo(); const undone=JS3D.doc();
    await JS3D.ready();
    return {original,newer,after,undone,list,diff,between,steps,sync,unchanged,id,ids:JS3D.list().map(b=>b.id)};
  });
  expect(result.diff).toContain("Body added:"); expect(result.diff).toContain('Parameter width: (none) -> "30"');
  expect(result.between).toBe(result.diff); expect(result.after).toEqual(result.original); expect(result.list).toEqual([]);
  expect(result.steps).toBe(1); expect(result.sync).toBe(true); expect(result.unchanged).toBe("No changes.");
  expect(result.undone).toEqual(result.newer); expect(result.ids).toContain(result.id);
});
test("Chisel and wrong-design refusal",async()=>{
  const out=await page.evaluate(async()=>{
    const c=JS3D.checkpoint(); const app=JS3D.internals.app;
    app.setMode("chisel");
    let chisel,wrong;
    try {JS3D.rollback(c.id);} catch(e){chisel=e.message;}
    app.setMode("beginner"); await JS3D.newDesign("beginner");
    try {JS3D.rollback(c.id);} catch(e){wrong=e.message;}
    return {chisel,wrong,id:c.id};
  });
  expect(out.chisel).toBe("leave Chisel mode first");
  expect(out.wrong).toBe(`checkpoint ${out.id} belongs to another design; checkpoints are kept per design`);
});
test("retention and detached metadata",async()=>{
  const out=await page.evaluate(()=>{
    const first=JS3D.checkpoint(); for(let i=0;i<20;i++)JS3D.checkpoint();
    const list=JS3D.checkpoints(); list[0].label="changed"; let missing;
    try{JS3D.diff(first.id);}catch(e){missing=e.message;}
    return {list:JS3D.checkpoints(),missing,first:first.id};
  });
  expect(out.list).toHaveLength(20); expect(out.list[0].label).toBe("");
  expect(out.missing).toContain(`no checkpoint "${out.first}"; checkpoints:`);
});
