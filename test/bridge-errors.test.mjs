import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bridge } from './bridgenode.mjs';
const { initFasteners } = await import('../src/fasteners.js');
const { initGears } = await import('../src/gears.js');
const { initNamePlate } = await import('../src/nameplate.js');
const { initKnurl } = await import('../src/knurl.js');
const { initSpring } = await import('../src/spring.js');
const advanced = {
  addFastener: initFasteners({}, {STD: [['M8 × 1.25', 8, 1.25, 'iso']]}).add,
  addGear: initGears({}, {}).add,
  addNamePlate: initNamePlate({}, {}).add,
  addKnurl: initKnurl({}, {}).add,
  addSpring: initSpring({}, {}).add,
};
const existing = [
  ['get', a => a.get('b9'), ['no body', '"b9"']],
  ['kind', a => a.add('bad'), ['kind', '"bad"']],
  ['size', a => a.add('box', {size: {w: 0}}), ['w', '0']],
  ['position', a => a.add('box', {at: [1, 2]}), ['at', '[1,2]']],
  ['color', a => a.add('box', {color: 'red'}), ['color', '"red"']],
  ['parameter', a => a.removeParam('x'), ['parameter', '"x"']],
  ['mode', a => a.setMode('bad'), ['mode', '"bad"']],
  ['url', a => a.connect('bad'), ['url', '"bad"']],
  ['call', a => a.invoke('bad'), ['call', '"bad"']],
  ['args', a => a.invoke('list', 4), ['args', '4']],
  ['empty ids', a => a.remove([]), ['ids', '[]']],
  ['size type', a => a.add('box', {size: 4}), ['size', '4']],
  ['size key', a => a.add('box', {size: {bad: 1}}), ['size', '"bad"']],
  ['group size', a => { const id = a.add('box'); return a.group([id]); }, ['group', 'at least two']],
  ['axis', a => { const id = a.add('box'); return a.rotate(id, 'q', 4); }, ['axis', '"q"']],
  ['degrees', a => { const id = a.add('box'); return a.rotate(id, 'z', 'q'); }, ['degrees', '"q"']],
  ['scale', a => { const id = a.add('box'); return a.scale(id, -1); }, ['k', '-1']],
  ['hole', a => { const id = a.add('box'); return a.setHole(id, 'yes'); }, ['hole', '"yes"']],
  ['name', a => { const id = a.add('box'); return a.rename(id, ''); }, ['name', '""']],
  ['hidden', a => { const id = a.add('box'); return a.setHidden(id, 'yes'); }, ['hidden', '"yes"']],
  ['parameter name', a => a.setParam(4, '1'), ['name', '4']],
  ['parameter unit', a => a.setParam('width', '1', {unit: 'cm'}), ['unit', '"cm"']],
  ['parameter expression', a => a.setParam('width', ''), ['expr', '""']],
  ['new design mode', a => a.newDesign('bad'), ['mode', '"bad"']],
  ['export kind', a => a.export('bad'), ['kind', '"bad"']],
  ['script', a => a.run(4), ['run', '4']],
  ['checkpoint label', a => a.checkpoint(4), ['label', '4']],
  ['missing checkpoint', a => a.diff('c9'), ['checkpoint', '"c9"']],

];
const cases = existing.map(([name, run, mentions]) => ({name, run, mentions}));
const body = api => api.add('box');
cases.push(
  {name: 'array size', run: a => a.add('box', {size: [1, 2]}), mentions: ['size', '[1,2]'], allowed: /w.*d.*h/},
  {name: 'text size', run: a => a.add('text', {size: {text: 4}}), mentions: ['text', '4']},
  {name: 'integer size', run: a => a.add('pyramid', {size: {sides: 2}}), mentions: ['sides', '2'], allowed: /3/},
  {name: 'group op', setup: a => [body(a), body(a)], run: (a, ids) => a.group(ids, {op: 'bad'}), mentions: ['op', '"bad"'], allowed: /intersect.*cut/},
  {name: 'ungroup plain', setup: body, run: (a, id) => a.ungroup(id), mentions: ['body'], dynamicId: true},
  {name: 'resize group', setup: a => a.group([body(a), body(a)]), run: (a, id) => a.resize(id, {}), mentions: ['id'], dynamicId: true},
  {name: 'bind group', setup: a => a.group([body(a), body(a)]), run: (a, id) => a.bind(id, 'w', '2'), mentions: ['id'], dynamicId: true},
  {name: 'bind key', setup: body, run: (a, id) => a.bind(id, 'bad', '2'), mentions: ['size', '"bad"']},
  {name: 'bind expression', setup: body, run: (a, id) => a.bind(id, 'w', 'bad'), mentions: ['expr', '"bad"'], allowed: /0\.01/},
  {name: 'parameter invalid name', run: a => a.setParam('1bad', '1'), mentions: ['name', '"1bad"']},
  {name: 'parameter invalid expression', run: a => a.setParam('width', 'bad'), mentions: ['expr', '"bad"']},
  {name: 'unbuilt centre', setup: body, run: (a, id) => a.rotate(id, 'z', 10), mentions: ['opts.about']},
  {name: 'ready timeout', app: {kernel: {ready: false, inflight: false, queue: new Set()}}, run: a => a.ready(-1), mentions: ['ready', '-1']},
  {name: 'group features', setup: (a, _, store) => { const id = a.group([body(a), body(a)]); store.doc.bodies.find(b => b.id === id).node.mods = [{t: 'fillet'}]; return id; }, run: (a, id) => a.ungroup(id), mentions: ['group', 'features']},
  {name: 'group angled scale', setup: (a, _, store) => { const id = a.group([body(a), body(a)]); const node = store.doc.bodies.find(b => b.id === id).node; node.mods = [{t: 'scale', k: [2, 1, 1], o: [0, 0, 0]}]; node.children[0].m[0] = 0.7; return id; }, run: (a, id) => a.ungroup(id), mentions: ['group']},
  {name: 'empty screenshot', app: {vp: {render() {}, canvas: {toDataURL: () => ''}}}, run: a => a.screenshotDataURL(), mentions: ['3D view']},
  {name: 'screenshot width', run: a => a.screenshotDataURL({width: 0}), mentions: ['width', '0'], allowed: /1.*8192/},
  {name: 'export build error', setup: (a, app) => { const id = body(a); app.scene.errors.set(id, 'bad build'); return id; }, run: a => a.export('stl'), mentions: ['build error', 'bad build']},
  {name: 'empty export', run: a => a.export('stl'), mentions: ['export']},
  {name: 'invalid project', run: a => a.load('bad'), mentions: ['json', '"bad"']},
  {name: 'invalid project body', run: a => a.load({bodies: [4], sketches: []}), mentions: ['body', '4']},
  {name: 'long checkpoint', run: a => a.checkpoint('x'.repeat(201)), mentions: ['label', '"' + 'x'.repeat(58) + '…'], allowed: /200/},
  {name: 'checkpoint other design diff', setup: (a, _, store) => { const id = a.checkpoint().id; store.doc.id = 'other'; return id; }, run: (a, id) => a.diff(id), mentions: ['checkpoint'], dynamicId: true},
  {name: 'checkpoint other design rollback', setup: (a, _, store) => { const id = a.checkpoint().id; store.doc.id = 'other'; return id; }, run: (a, id) => a.rollback(id), mentions: ['checkpoint'], dynamicId: true},
  {name: 'chisel state', app: {mode: 'chisel'}, run: a => a.add('box'), mentions: ['Chisel']},
  {name: 'cosforge state', app: {cosforge: {isOpen: true}}, run: a => a.add('box'), mentions: ['CosForge']},
  {name: 'carve state', app: {carve: {active: true}}, run: a => a.add('box'), mentions: ['Chip Carving']},
  {name: 'simulation undo', app: {simLock: true}, run: a => a.undo(), mentions: ['3D Print Sim']},
  {name: 'simulation rollback', app: {simLock: true}, setup: a => a.checkpoint().id, run: (a, id) => a.rollback(id), mentions: ['3D Print Sim']},
  {name: 'box style', run: a => a.boxMaker({style: 'bad'}), mentions: ['style', '"bad"'], allowed: /bin.*drawer.*tilt.*door/},
  {name: 'box width', run: a => a.boxMaker({w: 1}), mentions: ['w', '1'], allowed: /10.*1000/},
  {name: 'box count', run: a => a.boxMaker({cols: 0}), mentions: ['cols', '0'], allowed: /1.*20/},
  {name: 'gear type', run: a => a.gearSet({type: 'bad'}), mentions: ['type', '"bad"'], allowed: /pair.*rack.*ring.*planet.*bevel.*helical/},
  {name: 'gear module', run: a => a.gearSet({module: 0}), mentions: ['module', '0'], allowed: /0\.3.*10/},
  {name:'set color', setup:body, run:(a,id)=>a.setColor(id,'red'), mentions:['color','"red"']},
  {name:'invalid about', setup:body, run:(a,id)=>a.rotate(id,'z',10,{about:[1,2]}), mentions:['about','[1,2]']},
  {name:'bevel set teeth',run:a=>a.gearSet({type:'bevel',teeth:1}),mentions:['teeth','1']},
  {name:'bevel set teeth2',run:a=>a.gearSet({type:'bevel',teeth2:1}),mentions:['teeth2','1']},
  {name:'ring teeth',run:a=>a.gearSet({type:'ring',teeth:20,teeth2:21}),mentions:['teeth2','21']},
  {name:'planet assembly',run:a=>a.gearSet({type:'planet',sunTeeth:19,planetTeeth:12,planets:3}),mentions:['sunTeeth','19']},
  {name:'planet clearance',run:a=>a.gearSet({type:'planet',sunTeeth:8,planetTeeth:20,planets:4}),mentions:['planetTeeth','20']},
  {name:'gear bore',run:a=>a.gearSet({bore:100}),mentions:['bore','100']},
  {name: 'gear pressure', run: a => a.gearSet({pressureAngle: 15}), mentions: ['pressureAngle', '15'], allowed: /14\.5.*20.*25/},
  {name: 'hardware option', run: a => a.hardware({bad: 1}), mentions: ['option', '"bad"']},
  {name: 'hardware part', run: a => a.hardware({part: 'bad'}), mentions: ['part', '"bad"']},
  {name: 'hardware size', run: a => a.hardware({part: 'hexbolt', size: 'bad'}), mentions: ['size', '"bad"']},
  {name: 'texture faces', setup: body, run: (a, id) => a.texture(id, {faces: []}), mentions: ['faces', '[]']},
  {name: 'texture size', setup: body, run: (a, id) => a.texture(id, {size: 0}), mentions: ['size', '0'], allowed: /0\.5.*100/},
  {name: 'texture direction', setup: body, run: (a, id) => a.texture(id, {dir: 'bad'}), mentions: ['dir', '"bad"'], allowed: /raise.*engrave.*both/},
  {name: 'drawing views', run: a => a.drawing({views: ['bad']}), mentions: ['views', '["bad"]'], allowed: /top.*front.*right/},
  {name: 'drawing units', run: a => a.drawing({units: 'cm'}), mentions: ['units', '"cm"'], allowed: /mm.*in/},
  {name: 'drawing scale', run: a => a.drawing({scale: 0}), mentions: ['scale', '0'], allowed: /0\.01.*100/},
  {name: 'sketch name', run: a => a.sketch({name: ''}), mentions: ['name', '""']},
  {name: 'sketch hidden', run: a => a.sketch({hidden: 'bad'}), mentions: ['hidden', '"bad"'], allowed: /true.*false/},
  {name: 'sketch plane', run: a => a.sketch({on: 'bad'}), mentions: ['on', '"bad"'], allowed: /XY.*XZ.*YZ/},
  {name: 'extrude mode', run: a => a.extrude({mode: 'bad'}), mentions: ['mode', '"bad"'], allowed: /one.*sym.*two/},
  {name: 'extrude through', run: a => a.extrude({through: 'bad'}), mentions: ['through', '"bad"'], allowed: /true.*false/},
  {name: 'extrude op', run: a => a.extrude({op: 'bad'}), mentions: ['op', '"bad"'], allowed: /new.*join.*cut/},
  {name: 'inspect material', run: a => a.inspect(null, {material: 'bad'}), mentions: ['material', '"bad"']},
  {name: 'inspect density', run: a => a.inspect(null, {density: 0}), mentions: ['density', '0'], allowed: /0\.1.*25/},
  {name: 'measure point', run: a => a.measure([1, 2], [0, 0, 0]), mentions: ['a', '[1,2]']},
  {name: 'print angle', run: a => a.printCheck({angle: 0}), mentions: ['angle', '0'], allowed: /10.*80/},
  {name: 'collision gap', run: a => a.collisions({gap: -1}), mentions: ['gap', '-1'], allowed: /0.*50/},
);

const generatorCases = [
  ['fastener type', 'fastener', {type:'bad'}, 'type', '"bad"'],
  ['fastener size', 'fastener', {type:'bolt',size:'bad'}, 'size', '"bad"'],
  ['fastener length', 'fastener', {type:'bolt',size:'M8',length:1}, 'length', '1'],
  ['fastener turns', 'fastener', {type:'bolt',size:'M8',length:1000}, 'length', '1000'],
  ...[['clear',1],['left','bad'],['at',[1,2]]].map(([k,v]) => [`fastener ${k}`, 'fastener', {type:'bolt',size:'M8',length:20,[k]:v}, k, JSON.stringify(v)]),
  ...[['kind','bad'],['module',0],['teeth',1],['angle',20],['mate',20],['width',0],['base',0],['bore',99],['keyway','bad'],['clear',1],['at',[1,2]]].map(([k,v]) => [`single gear ${k}`, 'gear', {module:2,teeth:20,[k]:v}, k, JSON.stringify(v)]),
  ...[['mate',1],['width',20]].map(([k,v]) => [`bevel ${k}`, 'gear', {kind:'bevel',module:2,teeth:20,[k]:v}, k, JSON.stringify(v)]),
  ...[['angle',1],['hand','bad'],['width',100]].map(([k,v]) => [`helical ${k}`, 'gear', {kind:'helical',module:2,teeth:20,[k]:v}, k, JSON.stringify(v)]),
  ['rack base','gear',{kind:'rack',module:2,teeth:20,base:0},'base','0'],
  ['rack bore','gear',{kind:'rack',module:2,teeth:20,bore:5},'bore','5'],
  ['gear small bore','gear',{module:.3,teeth:12,bore:5},'bore','5'],
  ['gear keyway kind','gear',{kind:'helical',module:2,teeth:20,bore:5,keyway:true},'keyway','true'],
  ['gear keyway bore','gear',{module:2,teeth:20,bore:5,keyway:true},'bore','5'],
  ['gear keyway fit','gear',{module:2,teeth:12,bore:12,keyway:true},'keyway','12'],
  ...[['text',''],['text','A\nB'],['text','A'.repeat(41)],['font','bad'],['text','Ł'],['size',1],['style','bad'],['depth',.1],['thickness',.5],['margin',1],['shape','bad'],['holes','bad'],['holeDia',100],['color','red'],['textColor','red'],['at',[1,2]]].map(([k,v],i) => [`nameplate ${k} ${i}`, 'namePlate', {text:'Max',[k]:v}, k, JSON.stringify(v).slice(0,20)]),
  ['nameplate thin','namePlate',{text:'Max',style:'cut',thickness:.7,depth:.2},'plate','0.7'],
  ['nameplate depth','namePlate',{text:'Max',style:'cut',depth:3},'depth','3'],
  ['nameplate hole unused','namePlate',{text:'Max',holes:'none',holeDia:4},'holeDia','4'],
  ['nameplate text color unused','namePlate',{text:'Max',style:'cut',textColor:'red'},'textColor','"red"'],
  ...[['diameter',5],['length',0],['grooves',7],['depth',10],['bore','bad'],['boreSize',5],['at',[1,2]]].map(([k,v])=>[`knurl ${k}`,'knurl',{[k]:v},k,JSON.stringify(v)]),
  ['knurl shallow','knurl',{grooves:8,depth:.5},'depth','0.5'],
  ['knurl bore size','knurl',{bore:'round',boreSize:100},'boreSize','100'],
  ['knurl small','knurl',{diameter:6,depth:1.5,bore:'hex'},'knob','6'],
  ...[['wire',.3],['outside',1],['freeLength',0],['turns',1],['hand','bad'],['ends','bad'],['color','red'],['at',[1,2]]].map(([k,v])=>[`spring ${k}`,'spring',{[k]:v},k,JSON.stringify(v)]),
  ['spring outside','spring',{wire:5,outside:20},'outside','20'],
  ['spring coils','spring',{freeLength:10,turns:5},'coils','touch'],
  ['spring steep','spring',{outside:10,freeLength:100,turns:2},'spring','steep'],
  ['spring wire limit','spring',{wire:.4,outside:20,freeLength:40,turns:10},'spring','wire'],
  ['nameplate small hole','namePlate',{text:'-',size:2,margin:1.5},'text','2'],
];
for (const [name, method, spec, input, value] of generatorCases) cases.push({name, run: a => a[method](spec), mentions: [input, value]});
cases.push(
  ...[['duplicate','offset'],['move','delta'],['moveTo','pos']].map(([method,input])=>({name:method+' vector',setup:body,run:(a,id)=>a[method](id,[1,2]),mentions:[input,'[1,2]']})),
  {name:'pattern features',setup:body,run:(a,id)=>a.pattern(id,{features:[]}),mentions:['features','[]']},
  {name:'pattern feature id',setup:body,run:(a,id)=>a.pattern(id,{features:['bad']}),mentions:['feature','"bad"']},
  {name:'pattern type',setup:body,run:(a,id)=>a.pattern(id,{features:['shape'],type:'bad'}),mentions:['type','"bad"']},
  {name:'pattern count',setup:body,run:(a,id)=>a.pattern(id,{features:['shape'],type:'rect',count:0}),mentions:['count','0']},
  {name:'pattern both',setup:body,run:(a,id)=>a.pattern(id,{features:['shape'],type:'rect',count:2,both:'bad'}),mentions:['both','"bad"']},
  {name:'pattern spacing',setup:body,run:(a,id)=>a.pattern(id,{features:['shape'],type:'rect',count:2,spacing:0}),mentions:['spacing','0']},
  {name:'pattern axis',setup:body,run:(a,id)=>a.pattern(id,{features:['shape'],type:'rect',count:2,spacing:1,axis:'bad'}),mentions:['axis','"bad"']},
  {name:'pattern count2',setup:body,run:(a,id)=>a.pattern(id,{features:['shape'],type:'rect',count:2,count2:0}),mentions:['count2','0']},
  {name:'pattern spacing2',setup:body,run:(a,id)=>a.pattern(id,{features:['shape'],type:'rect',count:2,count2:2,spacing:1,axis2:'y',spacing2:0}),mentions:['spacing2','0']},
  {name:'pattern circle count',setup:body,run:(a,id)=>a.pattern(id,{features:['shape'],type:'circle',count:1}),mentions:['count','1']},
  {name:'pattern angle',setup:body,run:(a,id)=>a.pattern(id,{features:['shape'],type:'circle',count:2,angle:400}),mentions:['angle','400']},
  {name:'pattern center',setup:body,run:(a,id)=>a.pattern(id,{features:['shape'],type:'circle',count:2,center:[1,2]}),mentions:['center','[1,2]']},
  {name:'gear set bevel angle',run:a=>a.gearSet({type:'bevel',angle:20}),mentions:['angle','bevel']},
  {name:'texture object key',setup:body,run:(a,id)=>a.texture(id,{texture:{bad:1}}),mentions:['texture','{"bad":1}']},
);

for (const {name, run, mentions, allowed, setup, app, dynamicId} of cases) test(name, async () => {
  const {api, app: instance, store} = bridge({kernel: {ready: true, inflight: false, queue: new Set()}, advanced, ...app});
  const value = setup?.(api, instance, store);
  await assert.rejects(async () => run(api, value), error => {
    for (const part of [...mentions, ...(dynamicId ? [JSON.stringify(value)] : [])]) assert.ok(error.message.includes(part), error.message);
    if (allowed) assert.match(error.message, allowed);
    assert.match(error.message, /(?:Example:|\b(?:Call|Try|Use|Leave|Press|Close|Wait|Pass|Give|Remove|Rename|Pick|Check|Undo|Open|Add|Show|Choose|Set|Delete|Switch|Increase|Reduce)\b)/i);
    assert.ok(error.message.length < 300);
    if (!mentions.some(part => /undefined|\[object Object\]|NaN/.test(part))) assert.doesNotMatch(error.message, /undefined|\[object Object\]|NaN/);
    return true;
  });
});

test('nameplate reads invalid text only once', () => {
  let reads = 0;
  const spec = {get text() { if (++reads > 1) throw new TypeError('read twice'); return ''; }};
  const {api} = bridge({advanced});
  assert.throws(() => api.namePlate(spec), /text must be a non-empty string, got ""/);
  assert.equal(reads, 1);
});
