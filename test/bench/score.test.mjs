import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { loadFixture, validateFixture, selectCases, topology, plannedRow, compare, formatReport, updateSummary, exitCode, TOLERANCE, PREAMBLE, sha256 } from "./score.mjs";
import { redact } from "./driver.mjs";
import { createReport, reportDirectory, persistReport, parseArgs, ollamaURL, preflight, runCases, startServer, ROOT } from "../../tools/chat-bench.mjs";

const { fixture, casesSha256 } = await loadFixture();
const clone = () => structuredClone(fixture);
const oracle = [
  ["box", [[40,30,20],[20,20,20],[50,25,8],[32,18,12],[100,60,2]]],
  ["cylinder", [[20,10],[10,5],[30,12],[16,40],[50,3]]],
  ["central-bore", [[40,30,20,8],[30,20,10,6],[50,40,8,10],[24,24,12,4],[70,50,6,12]]],
  ["offset-bore", [[60,40,4,6,15,0],[50,30,3,4,10,0],[70,50,6,8,-15,5],[40,40,4,6,8,-8],[90,60,5,10,20,10]]],
  ["two-bores", [[60,40,5,8,15],[50,30,4,6,12],[80,40,6,10,20],[40,30,3,4,10],[100,60,8,12,25]]],
  ["four-bores", [[80,60,6,6,25,15],[60,50,4,4,20,15],[100,70,8,8,35,20],[70,50,5,6,20,15],[120,80,6,10,40,25]]],
  ["tube", [[30,20,25],[20,10,10],[40,30,5],[50,20,12],[24,12,30]]],
  ["side-bore", [[40,30,20,8],[30,24,16,6],[60,40,20,10],[24,20,12,4],[80,50,30,12]]],
  ["boss", [[40,30,5,20,10],[30,30,4,12,8],[60,40,6,24,12],[50,30,5,18,10],[80,60,8,30,16]]],
  ["scale-move", [[20,2,10,-5],[10,2,20,10],[30,0.5,-15,5],[12,3,0,20],[25,1.2,10,-10]]],
];

for (const [fi, [family, parameters]] of oracle.entries()) for (const [pi, p] of parameters.entries()) {
  const number = pi === 0 ? fi + 1 : 10 + 4 * fi + pi, id = `J3-${String(number).padStart(3, "0")}`;
  test(`independent arithmetic and request audit ${id}`, () => {
    const c = fixture.cases[number - 1], [w,d,h,dia,a,b] = p;
    let volume, holes = 0, min = [-w/2,-d/2,0], max = [w/2,d/2,h], arithmetic, request;
    const disk = (diameter) => Math.PI * (diameter / 2) ** 2;
    if (family === "box") {
      volume = w*d*h; arithmetic = `${w} × ${d} × ${h}`;
      request = `Make a plain rectangular block ${w} wide, ${d} deep and ${h} high, with sharp edges.`;
    } else if (family === "cylinder") {
      volume = disk(w)*d; min=[-w/2,-w/2,0]; max=[w/2,w/2,d]; arithmetic=`π × ${w}² × ${d} / 4`;
      request = `Make a solid round cylinder ${w} in diameter and ${d} high, standing upright.`;
    } else if (family === "tube") {
      volume = (disk(w)-disk(d))*h; holes=1; min=[-w/2,-w/2,0];max=[w/2,w/2,h]; arithmetic=`π × (${w}² − ${d}²) × ${h} / 4`;
      request = `Make a round tube standing upright, outside diameter ${w}, inside diameter ${d} and height ${h}, open all the way through at both ends.`;
    } else if (family === "boss") {
      volume = w*d*h + disk(dia)*(a-1); max[2]=h+a-1; arithmetic=`${w} × ${d} × ${h} + π × ${dia}² × (${a} − 1) / 4; top = ${h} − 1 + ${a}`;
      request = `Join a sharp-edged plate ${w} wide, ${d} deep and ${h} thick to a central upright solid round boss ${dia} in diameter and ${a} high. Put the boss's base at z=${h-1} so it overlaps the plate by 1; leave one fused solid.`;
    } else if (family === "scale-move") {
      const side=w*d; volume=side*side*side;min=[h-side/2,dia-side/2,0];max=[h+side/2,dia+side/2,side];
      arithmetic=`S = ${w} × ${d} = ${side}; volume = ${side}³; x = ${h} ± ${side/2}, y = ${dia} ± ${side/2}, z = 0..${side}`;
      request = `Make a sharp-edged cube with side ${w}, ${pi === 0 ? "double every dimension" : `multiply every dimension by ${d}`} about the centre of its bottom face so the base stays at z=0, then move it ${h} along x and ${dia} along y.`;
    } else {
      holes = family === "two-bores" ? 2 : family === "four-bores" ? 4 : 1;
      const length=family === "side-bore" ? w : h;
      volume=w*d*h-holes*disk(dia)*length;
      arithmetic=`${w} × ${d} × ${h} − ${holes === 1 ? "" : holes + " × "}π × ${dia}² × ${length} / 4`;
      if (family === "central-bore") request=`Make a sharp-edged block ${w} wide, ${d} deep and ${h} high, with one round ${dia}-diameter hole straight through from top to bottom at x=0, y=0.`;
      if (family === "offset-bore") request=`Make a sharp-edged plate ${w} wide, ${d} deep and ${h} thick, with one round ${dia}-diameter hole straight through from top to bottom at x=${a}, y=${b}.`;
      if (family === "two-bores") request=`Make a sharp-edged plate ${w} wide, ${d} deep and ${h} thick, with two separate round ${dia}-diameter holes straight through from top to bottom, centred at x=${-a} and x=${a}, both at y=0.`;
      if (family === "four-bores") request=`Make a sharp-edged plate ${w} wide, ${d} deep and ${h} thick, with four separate round ${dia}-diameter holes straight through from top to bottom, one at each combination of x=${-a} or ${a} and y=${-b} or ${b}.`;
      if (family === "side-bore") request=`Make a sharp-edged block ${w} wide, ${d} deep and ${h} high, with one round ${dia}-diameter hole straight through along x, from the left face to the right face, with its axis at y=0, z=${h/2}.`;
    }
    assert.equal(c.id, id); assert.equal(c.family, family); assert.equal(c.request, request);
    assert.deepEqual(c.expected, { bodies:1, volumeMm3:Number(volume.toFixed(6)), bboxMm:{min,max}, holes });
    assert.equal(c.calculation, `${arithmetic}; volume = ${volume.toFixed(6)} mm³`);
  });
}

test("fixture schema rejects changed contracts before subset selection", async () => {
  assert.equal(validateFixture(fixture), fixture); assert.equal(fixture.preamble, PREAMBLE);
  const invalid = [
    [f=>f.version=2,"unsupported version"], [f=>f.extra=1,"unexpected or missing fields"],
    [f=>f.cases.pop(),"expected 50 ordered unique cases"], [f=>f.cases[1].id="J3-001","expected 50 ordered unique cases"],
    [f=>f.cases[0].family="unknown","expected five cases per family"],
    [f=>f.preamble="Use inches","invalid preamble or tolerance"], [f=>f.tolerance.bboxAbsMm=1,"invalid preamble or tolerance"],
    [f=>f.tolerance.extra=1,"invalid preamble or tolerance"], [f=>f.cases[0].request="","invalid request or calculation"],
    [f=>f.cases[0].request="x".repeat(2001),"invalid request or calculation"], [f=>f.cases[0].calculation=null,"invalid request or calculation"],
    [f=>f.cases[0].expected.volumeMm3=NaN,"invalid expected geometry"], [f=>f.cases[0].expected.volumeMm3=null,"invalid expected geometry"],
    [f=>delete f.cases[0].expected.volumeMm3,"unexpected or missing fields"], [f=>delete f.cases[0].expected.bboxMm.min,"unexpected or missing fields"],
    [f=>f.cases[0].expected.bboxMm.min[0]=null,"invalid expected geometry"], [f=>f.cases[0].expected.bboxMm.max[0]=-21,"invalid expected geometry"],
    [f=>f.cases[0].expected.bboxMm.max=[NaN,1,2],"invalid expected geometry"], [f=>f.cases[0].expected.bodies=2,"invalid expected geometry"],
    [f=>f.cases[0].expected.holes=1.5,"invalid expected geometry"], [f=>f.cases[0].expected.holes=5,"invalid expected geometry"],
  ];
  for (const [mutate, reason] of invalid) { const f=clone();mutate(f);assert.throws(()=>validateFixture(f,"fixture"), {message:`chat judge: invalid benchmark at fixture: ${reason}`}); }
  const dir=await mkdtemp(join(tmpdir(),"chat-fixture-"));
  try {
    const path=join(dir,"cases.json"); await writeFile(path," ".repeat(1048577));
    await assert.rejects(loadFixture(path),/unexpected or missing fields/);
    await writeFile(path,"{"); await assert.rejects(loadFixture(path),/unexpected or missing fields/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("selection is unique, known and in fixture order", () => {
  assert.deepEqual(selectCases(fixture,"J3-005,J3-001").map(c=>c.id),["J3-001","J3-005"]);
  for (const ids of ["", "J3-001,J3-001", "J3-999", "J3-001,", " J3-001"]) assert.throws(()=>selectCases(fixture,ids),/cases must be unique known IDs/);
});

const observed = (c = fixture.cases[0]) => ({ bodies:1, volumeMm3:c.expected.volumeMm3, bboxMm:structuredClone(c.expected.bboxMm), holes:c.expected.holes, topology:null });
test("inclusive volume and bbox tolerance edges use unrounded numbers", () => {
  const c = structuredClone(fixture.cases[0]); c.expected.bboxMm.min[0]=0;c.expected.bboxMm.max[0]=1;
  for (const sign of [-1,1]) {
    const o=observed(c); o.volumeMm3+=sign*24;o.bboxMm.min[0]=sign*0.1;
    assert.equal(compare(plannedRow(c),o).status,"pass");
    o.volumeMm3+=sign*0.000001;assert.equal(compare(plannedRow(c),o).metrics.volume,false);
    o.bboxMm.min[0]=sign*0.100001;assert.equal(compare(plannedRow(c),o).metrics.bbox,false);
  }
  c.expected.volumeMm3=100;const o=observed(c);o.volumeMm3=101;assert.equal(compare(plannedRow(c),o).status,"pass");
});
test("independent metrics and missing geometry cannot pass", () => {
  const c=fixture.cases[0];
  for (const [key, change] of [["volume",o=>o.volumeMm3+=30],["bbox",o=>o.bboxMm.max[2]+=0.2],["holes",o=>o.holes=1]]) {
    const o=observed(c);change(o);const r=compare(plannedRow(c),o);
    assert.equal(r.status,"fail");assert.deepEqual(r.metrics,{body:true,volume:key!=="volume",bbox:key!=="bbox",holes:key!=="holes"});
  }
  assert.equal(compare(plannedRow(c),null).status,"error");
  for (const value of [null,NaN,0,-1]) {const o=observed(c);o.volumeMm3=value;assert.equal(compare(plannedRow(c),o).status,"error");}
  assert.equal(compare(plannedRow(c),observed(c),TOLERANCE,false).status,"fail");
  const o=observed(c);o.bodies=2;assert.equal(compare(plannedRow(c),o).metrics.body,false);
});

function stl(triangles) {
  const bytes=Buffer.alloc(84+triangles.length*50);bytes.writeUInt32LE(triangles.length,80);
  triangles.forEach((face,i)=>face.flat().forEach((n,j)=>bytes.writeFloatLE(n,84+i*50+12+j*4)));
  return bytes;
}
function prism(width=1, depth=1, gaps=[]) {
  const cells=new Set();for(let x=0;x<width;x++)for(let y=0;y<depth;y++)if(!gaps.some(([a,b])=>a===x&&b===y))cells.add(`${x},${y}`);
  const triangles=[],quad=(q)=>triangles.push([q[0],q[1],q[2]],[q[0],q[2],q[3]]);
  for(const cell of cells) {
    const [x,y]=cell.split(",").map(Number);
    quad([[x,y,0],[x,y+1,0],[x+1,y+1,0],[x+1,y,0]]);quad([[x,y,1],[x+1,y,1],[x+1,y+1,1],[x,y+1,1]]);
    if(!cells.has(`${x-1},${y}`))quad([[x,y,0],[x,y,1],[x,y+1,1],[x,y+1,0]]);
    if(!cells.has(`${x+1},${y}`))quad([[x+1,y,0],[x+1,y+1,0],[x+1,y+1,1],[x+1,y,1]]);
    if(!cells.has(`${x},${y-1}`))quad([[x,y,0],[x+1,y,0],[x+1,y,1],[x,y,1]]);
    if(!cells.has(`${x},${y+1}`))quad([[x,y+1,0],[x,y+1,1],[x+1,y+1,1],[x+1,y+1,0]]);
  }
  return triangles;
}
const cube=prism(), transform=(mesh,fn)=>mesh.map(face=>face.map(fn));
test("closed cube, annulus prism and two-tunnel prism have genus 0, 1, 2", () => {
  for (const [mesh,holes] of [[cube,0],[prism(3,3,[[1,1]]),1],[prism(5,3,[[1,1],[3,1]]),2]]) {
    const t=topology(stl(mesh));assert.equal(t.holes,holes);assert.equal(t.chi,2-2*holes);assert.equal(t.components,1);assert.equal(t.discardedDegenerates,0);
  }
});
for (const [name,mesh,detail] of [
  ["reversed facet",[...cube.slice(1),[...cube[0]].reverse()],"inconsistent winding"],
  ["removed facet",cube.slice(1),"open or non-manifold edge"],
  ["duplicate facet",[...cube,cube[0]],"duplicate triangle"],
  ["zero area",[...cube,[[4,0,0],[5,0,0],[6,0,0]]],"zero-area triangle"],
  ["pinched vertex",[...cube,...transform(cube,p=>p.map(n=>n+1))],"non-manifold vertex link"],
]) test(`topology rejects ${name}`,()=>assert.throws(()=>topology(stl(mesh)),e=>e.message==="chat judge: mesh is not a closed oriented manifold"&&e.detail===detail));
test("disconnected solids and nested cavity shells fail connected-boundary requirement", () => {
  for(const mesh of [[...cube,...transform(cube,p=>p.map(n=>n+3))],[...cube,...transform(cube,p=>p.map(n=>n*0.5+0.25)).map(f=>f.reverse())]]) {
    assert.throws(()=>topology(stl(mesh)),e=>e.message==="chat judge: expected one connected boundary, got 2"&&e.detail.components===2);
  }
});
test("weld checks neighbouring cells and drops only repeated-index triangles", () => {
  const seam=transform(cube,p=>p.map(n=>n+0.000009));seam[0]=seam[0].map(p=>p.map(n=>n+0.000002));
  const t=topology(stl([...seam,[[0,0,0],[0,0,0],[1,0,0]]]));
  assert.equal(t.holes,0);assert.equal(t.V,8);assert.equal(t.F,12);assert.equal(t.discardedDegenerates,1);
});
test("malformed binary STL, NaN and oversize count are refused", () => {
  const nan=stl(cube);nan.writeFloatLE(NaN,96);
  for(const bytes of [Buffer.alloc(83),Buffer.alloc(84),stl(cube).subarray(0,-1),Buffer.concat([stl(cube),Buffer.alloc(1)]),nan]) assert.throws(()=>topology(bytes),/invalid binary STL/);
  const large=Buffer.alloc(84);large.writeUInt32LE(200001,80);assert.throws(()=>topology(large),/STL exceeds 200000 triangles/);
});

const newReport = () => createReport({mode:"mock",build:"site",fixture,selected:fixture.cases.slice(0,2),casesSha256});
test("report format, denominator, partial rows and exit rules",()=>{
  const r=newReport();assert.equal(r.complete,false);assert.deepEqual(r.summary,{pass:0,fail:0,error:0,notRun:2,denominator:2,percent:0});
  r.cases[0]=compare(plannedRow(fixture.cases[0]),observed());updateSummary(r);
  assert.equal(r.summary.percent,50);assert.equal(exitCode(r),2);assert.equal(exitCode(r,true),130);
  const md=formatReport(r);assert.match(md,/Chat geometry scorer regression \(mock\)/);assert.match(md,/Passed 1\/2 \(50.0%\).*coverage 2\/50/);assert.match(md,/Bbox max error/);
  r.cases[1].status="fail";assert.equal(exitCode(r),0);assert.equal(r.complete,true);
  r.cases[0].status="fail";assert.equal(exitCode(r),0);assert.equal(r.summary.percent,0);
  r.cases[0].status="error";assert.equal(exitCode(r),2);
  r.cases[0].status="pass";r.runError={message:"setup failed",detail:null};assert.equal(exitCode(r),2);
});
test("unique directories, atomic per-case persistence and round trip",async()=>{
  const root=await mkdtemp(join(tmpdir(),"chat-report-"));
  try {
    const r=newReport(),a=await reportDirectory(r,root,0),b=await reportDirectory(r,root,0);assert.notEqual(a,b);
    await persistReport(a,r);assert.deepEqual(JSON.parse(await readFile(join(a,"score.json"))),r);
    let calls=0;
    await runCases({report:r,dir:a,fixture,selected:fixture.cases.slice(0,2),driver:async({case:c})=>({row:compare(plannedRow(c),observed(c)),metadata:{systemSha256:sha256("system")}}),onResult:async()=>{
      calls++;const saved=JSON.parse(await readFile(join(a,"score.json")));assert.equal(saved.summary.pass,calls);assert.equal(saved.summary.notRun,2-calls);
      assert.deepEqual((await readdir(a)).sort(),["score.json","score.md"]);
    }});
    assert.equal(r.complete,true);assert.equal(exitCode(r),0);assert.ok(r.finishedAt);
    assert.match(await readFile(join(a,"score.md"),"utf8"),/Passed 2\/2/);
    await assert.rejects(persistReport(join(root,"missing"),r),/chat judge: could not write report:/);
  } finally {await rm(root,{recursive:true,force:true});}
});
test("cap and interruption preserve measured rows and all unstarted rows",async()=>{
  const root=await mkdtemp(join(tmpdir(),"chat-cap-"));
  try {
    for(const reason of ["chat judge: run exceeded 8 minutes","chat judge: interrupted before case ran"]){
      const r=newReport(),dir=await reportDirectory(r,root),controller=new AbortController();
      await runCases({report:r,dir,fixture,selected:fixture.cases.slice(0,2),signal:controller.signal,
        driver:async({case:c})=>({row:compare(plannedRow(c),observed(c)),metadata:{}}),onResult:()=>controller.abort(new Error(reason))});
      assert.equal(r.cases[0].status,"pass");assert.equal(r.cases[1].status,"not_run");assert.deepEqual(r.cases[1].messages,[reason]);assert.equal(r.summary.denominator,2);assert.equal(exitCode(r),2);
    }
  } finally {await rm(root,{recursive:true,force:true});}
});

test("CLI accepts only specified options and HTTP loopback origins",()=>{
  assert.deepEqual(parseArgs([]),{build:"site",model:"qwen3:14b"});assert.deepEqual(parseArgs(["--build","both","--model","x:tag","--cases","J3-001"]),{build:"both",model:"x:tag",cases:"J3-001"});
  assert.equal(parseArgs(["--help"]).help,true);
  for(const args of [["--api-key","x"],["--real"],["--output","x"],["--help","--help"]])assert.throws(()=>parseArgs(args),/unknown option/);
  assert.throws(()=>parseArgs(["--build","other"]),/build must be/);assert.throws(()=>parseArgs(["--model"," "]),/model must be/);assert.throws(()=>parseArgs(["--model"]),/model must be/);
  for(const u of ["https://localhost","http://example.com","http://127.0.0.1/path","http://localhost/?x=1","http://localhost/#x","http://user:password@localhost","http://127.1","http://2130706433","http://localhost/foo/.."])
    assert.throws(()=>ollamaURL(u),/Ollama URL must be an HTTP loopback address/);
  for(const u of ["http://localhost:11434/","http://127.0.0.1:1234","http://[::1]:11434"])assert.equal(ollamaURL(u),u.replace(/\/$/,""));
});
async function stub(handler) {
  const server=createServer(handler);await new Promise((done,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",done);});
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(done=>{server.closeAllConnections();server.close(done);})};
}
test("Ollama preflight exact installed tag, full digest, metadata and deadlines",async()=>{
  let version={version:"stub-1"},tags={models:[{name:"test:tag",digest:"a".repeat(64)}]},status=200,hang=false;
  const server=await stub((req,res)=>{if(hang)return;res.writeHead(status,{"content-type":"application/json"});res.end(JSON.stringify(req.url==="/api/version"?version:tags));});
  try {
    assert.deepEqual(await preflight(server.url,"test:tag"),{ollamaVersion:"stub-1",modelDigest:"a".repeat(64)});
    await assert.rejects(preflight(server.url,"test"),/model "test" is not installed/);
    tags.models[0].digest="short";await assert.rejects(preflight(server.url,"test:tag"),/metadata is incomplete/);
    version={};await assert.rejects(preflight(server.url,"test:tag"),/metadata is incomplete/);
    status=500;await assert.rejects(preflight(server.url,"test:tag"),/could not reach Ollama within 5 s/);
    status=200;hang=true;await assert.rejects(preflight(server.url,"test:tag",{timeoutMs:30}),/could not reach Ollama within 5 s/);
  } finally {await server.close();}
});
test("CLI preflight failure exits 2 and persists all planned rows without a browser or real model",async()=>{
  const server=await stub((_req,res)=>{res.writeHead(503);res.end();});
  let directory;
  try {
    const child=spawn(process.execPath,["tools/chat-bench.mjs","--cases","J3-001,J3-003"],{cwd:ROOT,env:{...process.env,JS3D_BENCH_URL:server.url},stdio:["ignore","pipe","pipe"]});
    let stdout="",stderr="";child.stdout.on("data",c=>stdout+=c);child.stderr.on("data",c=>stderr+=c);
    const code=await new Promise((done,reject)=>{child.once("error",reject);child.once("exit",done);});
    assert.equal(code,2);assert.match(stderr,/could not reach Ollama within 5 s/);
    directory=stdout.match(/Report: (.+)/)?.[1];assert.ok(directory);
    const report=JSON.parse(await readFile(join(directory,"score.json")));assert.equal(report.summary.notRun,2);assert.equal(report.summary.denominator,2);assert.equal(report.systemSha256,null);assert.equal(report.complete,false);
  } finally {await server.close();if(directory)await rm(directory,{recursive:true,force:true});}
});
test("static server uses a free loopback port and serves no fixture outside docs",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"chat-server-"));await writeFile(join(dir,"index.html"),"local");
  let server;
  try {server=await startServer(dir);assert.match(server.url,/^http:\/\/127\.0\.0\.1:\d+\/$/);assert.equal(await (await fetch(server.url)).text(),"local");assert.equal((await fetch(server.url+"test/bench/chat-cases.json")).status,404);}
  finally {if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});
test("diagnostics redact credentials and headers",()=>{
  const text=redact("authorization: Bearer secret\nx-api-key: hidden\nhttp://user:password@localhost:11434/?key=token#fragment");
  for(const secret of ["secret","hidden","password","token","fragment"])assert.ok(!text.includes(secret));
});

function command(args, env = {}) {
  const child = spawn(process.execPath, ["tools/chat-bench.mjs", ...args], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", (c) => stdout += c); child.stderr.on("data", (c) => stderr += c);
  const done = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code) => resolve({ code, stdout, stderr })); });
  return { child, done };
}
test("CLI help and invalid options exit without contacting a provider", async () => {
  const help = await command(["--help"], { JS3D_BENCH_URL: "invalid" }).done;
  assert.equal(help.code, 0); assert.match(help.stdout, /local Ollama only/); assert.equal(help.stderr, "");
  const bad = await command(["--real"]).done;
  assert.equal(bad.code, 2); assert.equal(bad.stderr.trim(), 'chat judge: unknown option "--real"');
});
test("invalid endpoint setup preserves both builds and their denominators", async () => {
  const result = await command(["--build", "both", "--cases", "J3-001"], { JS3D_BENCH_URL: "https://example.com" }).done;
  const dirs = [...result.stdout.matchAll(/Report: (.+)/g)].map((m) => m[1]);
  try {
    assert.equal(result.code, 2); assert.equal(dirs.length, 2);
    for (const dir of dirs) {
      const r = JSON.parse(await readFile(join(dir, "score.json")));
      assert.equal(r.summary.denominator, 1); assert.equal(r.summary.notRun, 1); assert.equal(r.systemSha256, null); assert.equal(r.toolsSha256, null);
      assert.equal(r.runError.message, "chat judge: Ollama URL must be an HTTP loopback address");
    }
  } finally { for (const dir of dirs) await rm(dir, { recursive: true, force: true }); }
});
test("Ctrl-C during preflight exits 130 with unstarted rows saved", async () => {
  let reached;
  const request = new Promise((resolve) => reached = resolve);
  const server = await stub(() => reached());
  let dirs = [], child;
  try {
    const running = command(["--cases", "J3-001,J3-003"], { JS3D_BENCH_URL: server.url }); child = running.child;
    await request; child.kill("SIGINT");
    const result = await running.done; dirs = [...result.stdout.matchAll(/Report: (.+)/g)].map((m) => m[1]);
    assert.equal(result.code, 130); assert.equal(dirs.length, 1);
    const r = JSON.parse(await readFile(join(dirs[0], "score.json")));
    assert.equal(r.summary.notRun, 2); assert.equal(r.complete, false);
    assert.ok(r.cases.every((c) => c.messages[0] === "chat judge: interrupted before case ran"));
  } finally { child?.kill(); await server.close(); for (const dir of dirs) await rm(dir, { recursive: true, force: true }); }
});
