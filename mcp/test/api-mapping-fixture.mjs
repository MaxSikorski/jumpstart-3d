// Explicit transport mapping, independent of either adapter's implementation.
// args are named tool parameters; expected is the bridge positional vector after undefined keys are omitted.
// The fixture deliberately preserves the flat chat schema and the narrower tool types.
const rows=[];
const add=(tool,call,args,expected,difference='Named fields become positional arguments/options; omitted options keep bridge defaults.',chatCall=call,chatExpected=expected)=>rows.push({tool,call,args,expected,difference,chatCall,chatExpected});
for(const [tool,call] of [['list_kinds','kinds'],['list_bodies','list'],['list_params','params'],['undo','undo'],['redo','redo'],['fit_view','fit'],['list_textures','textures'],['list_checkpoints','checkpoints']])add(tool,call,{},[]);
add('wait_ready','ready',{timeout_ms:1200},[1200],'timeout_ms -> timeoutMs; tool returns {ready:true}, bridge returns undefined.');
for(const [tool,call] of [['get_body','get'],['ungroup_body','ungroup'],['rollback','rollback']])add(tool,call,{id:'b1'},['b1']);
add('checkpoint','checkpoint',{label:'safe'},['safe'],'Optional label; max 200 enforced by bridge.');
add('diff_checkpoint','diff',{fromId:'c1',toId:'c2'},['c1','c2']);
add('inspect_bodies','inspect',{ids:['b1'],material:'pla',density:1.2},[['b1'],{material:'pla',density:1.2}],'ids default [] selects shown solids; material/density grouped into opts.');
add('measure','measure',{a_body:'b1',a_face:0,b_point:[1,2,3]},[{body:'b1',face:0},[1,2,3]],'Flat a_/b_ point, body, face, near fields become target unions.');
add('check_print','printCheck',{printer:'generic',angle:45},[{printer:'generic',angle:45}]);
add('check_collisions','collisions',{gap:1},[{gap:1}]);
add('section_view','section',{axis:'z',at:10,outline:true},[{axis:'z',at:10},{points:true,picture:false}],'axis/at or origin/normal grouped as plane; outline -> points; PNG extracted into adapter image response.');
add('add_shape','add',{kind:'box',size:{w:40},name:'part'},['box',{size:{w:40},name:'part'}],'MCP accepts size tuple or keyed object; chat uses keyed object.');
for(const [tool,call,args] of [
 ['add_fastener','fastener',{type:'bolt',size:'M3',length:12}],['add_gear','gear',{module:2,teeth:20}],['add_name_plate','namePlate',{text:'Hello'}],['add_knurl','knurl',{diameter:20}],['add_spring','spring',{wire:2}],
 ['add_box_maker','boxMaker',{style:'drawer'}],['add_gear_set','gearSet',{type:'pair'}],['add_hardware','hardware',{part:'shcs',size:'M3'}],
 ['extrude','extrude',{sketch:'s1',dist:20}],['revolve','revolve',{sketch:'s1',axis:'X'}],
])add(tool,call,args,[args],'Named fields become one option bag; CAD tools narrow expression-capable bridge lengths to numbers.');
add('add_hole_pattern','holePattern',{body:'b1',face:'+z',layout:'grid',cols:2,rows:3,dia:3},[{body:'b1',face:'+z',layout:{type:'grid',cols:2,rows:3},hole:{dia:3}}],'Flat layout and hole keys become nested objects; rowPitch makes [pitch,rowPitch].');
add('add_texture','texture',{id:'b1',texture:'knurl',faces:'top'},['b1',{texture:'knurl',faces:'top'}],'id is positional, other fields options. MCP selectors can be numeric; chat exposes text.');
for(const [tool,call] of [['remove_bodies','remove'],['select_bodies','select']])add(tool,call,{ids:['b1']},[['b1']],'MCP remove accepts scalar/array; chat always arrays. Select accepts empty array.');
add('duplicate_bodies','duplicate',{ids:['b1'],offset:[1,2,3]},[['b1'],[1,2,3]]);
add('move_bodies','move',{ids:['b1'],delta:[1,2,3]},[['b1'],[1,2,3]]);
add('move_to','moveTo',{id:'b1',position:[1,2,3]},['b1',[1,2,3]],'position -> bridge pos.');
add('rotate_bodies','rotate',{ids:['b1'],axis:'z',degrees:45,about:[0,0,0]},[['b1'],'z',45,{about:[0,0,0]}],'Chat adds axis_vector; bridge accepts axis union.');
add('resize_shape','resize',{id:'b1',size:{w:30}},['b1',{w:30}]);
add('scale_bodies','scale',{ids:['b1'],k:2,about:[0,0,0]},[['b1'],2,{about:[0,0,0]}],'Chat adds k_xyz; bridge accepts scalar/vector.');
for(const [tool,call,key,value] of [['set_hole','setHole','hole',true],['set_color','setColor','color','#123456'],['set_hidden','setHidden','hidden',true]])add(tool,call,{ids:['b1'],[key]:value},[['b1'],value]);
add('rename_body','rename',{id:'b1',name:'Bracket'},['b1','Bracket']);
add('group_bodies','group',{ids:['b1','b2'],name:'Joined'},[['b1','b2'],{name:'Joined'}]);
for(const [tool,call] of [['list_faces','faces'],['list_edges','edges']])add(tool,call,{id:'b1',select:'all'},['b1','all'],'select -> selector; tools accept text, bridge also accepts indices.');
add('add_sketch','sketch',{plane:'XY',offset:2,shapes:[{type:'circle',diameter:20}]},[{on:{plane:'XY',offset:2},shapes:[{type:'circle',diameter:20}]}],'plane/offset or body/face become on; no hidden option in tool.');
for(const [tool,call,key] of [['fillet_edges','fillet','r'],['chamfer_edges','chamfer','d']])add(tool,call,{id:'b1',edges:'edges of top',[key]:1},['b1','edges of top',1],'Tools accept selector text and numeric length; bridge also accepts indices and expressions.');
add('shell_body','shell',{id:'b1',th:2,open:'top'},['b1',{th:2,open:'top'}]);
add('add_holes','hole',{id:'b1',face:'top',points:[[0,0,0]],dia:3},['b1',{face:'top',points:[[0,0,0]],dia:3}]);
add('pattern_features','pattern',{id:'b1',features:['shape'],type:'rect',axis:'x',count:2,spacing:30},['b1',{features:['shape'],type:'rect',axis:'x',count:2,spacing:30}],'Tools narrow axis/count/length unions and do not expose both.');
add('set_param','setParam',{name:'W',expr:'40',unit:'mm'},['W','40',{unit:'mm'}]);
add('remove_param','removeParam',{name:'W'},['W']);
add('bind_size','bind',{id:'b1',key:'w',expr:'W'},['b1','w','W']);
add('set_mode','setMode',{mode:'advanced'},['advanced']);
add('screenshot','screenshot',{width:800,fit:true},[{fit:true,width:800}],'Adapter defaults 800/true differ from bridge absent-width/false. MCP PNG/path, chat dataURL with vision fallback.','screenshotDataURL');
add('export_file','export',{kind:'stl',path:'/unused',ids:['b1']},['stl',{ids:['b1']}],'MCP writes path; chat downloads name and omits glb enum. Bridge returns bytes.');
add('export_drawing','drawing',{path:'/unused',views:['top'],units:'mm'},[{views:['top'],units:'mm'}],'MCP writes path; chat downloads name; bridge DXF bytes.');
add('save_project','export',{},['json'],'MCP optional path writes bytes; otherwise text. Chat returns text.');
add('load_project','load',{json:'{}'},['{}'],'MCP exactly one path/json; chat JSON only. Bridge accepts parsed document too.');
add('new_design','newDesign',{mode:'advanced'},['advanced'],'Tool wraps void with {ok:true}.');
add('run_script','run',{code:'return 1'},['return 1'],'Chat requires Allow scripts; MCP trusted execution. No dedicated codeCad tool.');
add('status',null,{},[],'MCP session.status() never starts browser; chat reads appVersion/version/doc/mode/list.','doc',[]);
export const API_MAPPING=rows;
