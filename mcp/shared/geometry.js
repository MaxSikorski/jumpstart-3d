/** Pure inspection of generated tessellation, never plan parameters.
 * Mesh: flat xyz `vertices`, flat vertex-index `triangles`, optional column-major
 * affine `matrix` (16 numbers). All results use world coordinates, normally mm.
 * These bounded mesh checks do not establish BRep validity or physical fitness.
 */
const MAX_TRIANGLES = 200000;
const MAX_VERTICES = 600000;
const axes = { x: 0, y: 1, z: 2 };
function toleranceOf(value = 1e-5) {
  if (!Number.isFinite(value) || value < 1e-8 || value > 1) throw new Error('tolerance must be between 1e-8 and 1');
  return value;
}
function axisOf(axis) { axis = typeof axis === 'string' ? axis.toLowerCase() : axis; if (!(axis in axes)) throw new Error('axis must be x, y, or z'); return axes[axis]; }
function prepared(mesh) {
  const { vertices: p, triangles: t, matrix: m } = mesh || {};
  if (!p || !t || p.length % 3 || t.length % 3 || p.length > MAX_VERTICES * 3 || t.length > MAX_TRIANGLES * 3) throw new Error('Invalid mesh or mesh inspection limit exceeded');
  if (m && (m.length !== 16 || !Array.from(m).every(Number.isFinite) || m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1)) throw new Error('matrix must be a finite affine matrix');
  const points = [];
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (![x,y,z].every(Number.isFinite)) throw new Error('Mesh contains non-finite vertices');
    const q = m ? [m[0]*x+m[4]*y+m[8]*z+m[12],m[1]*x+m[5]*y+m[9]*z+m[13],m[2]*x+m[6]*y+m[10]*z+m[14]] : [x,y,z];
    if (!q.every(Number.isFinite) || q.some(v => Math.abs(v) > 1e9)) throw new Error('Mesh coordinate exceeds inspection range');
    points.push(q);
  }
  for (const index of t) if (!Number.isInteger(index) || index < 0 || index >= points.length) throw new Error('Mesh contains invalid triangle index');
  return { points, triangles: t };
}
const sub = (a,b) => a.map((v,i)=>v-b[i]);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
const distance = (a,b) => Math.hypot(...sub(a,b));

export function inspectTriangleMesh(mesh, { tolerance = 1e-5 } = {}) {
  tolerance = toleranceOf(tolerance);
  const { points, triangles } = prepared(mesh);
  const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
  const weld = new Map(), ids = points.map(p => {
    p.forEach((v,i)=>{min[i]=Math.min(min[i],v);max[i]=Math.max(max[i],v);});
    const key=p.map(v=>Math.round(v/tolerance)).join(',');
    if (!weld.has(key)) weld.set(key,weld.size);
    return weld.get(key);
  });
  const parent = Array.from({length:weld.size},(_,i)=>i), used = new Set(), edges = new Map();
  const root = i => { while(parent[i]!==i) {parent[i]=parent[parent[i]];i=parent[i];} return i; };
  let degenerateTriangles=0, signedVolume=0;
  for(let i=0;i<triangles.length;i+=3) {
    const indexes=[triangles[i],triangles[i+1],triangles[i+2]], [a,b,c]=indexes.map(j=>points[j]);
    const v=indexes.map(j=>ids[j]);
    if(new Set(v).size<3 || Math.hypot(...cross(sub(b,a),sub(c,a))) <= tolerance*tolerance) {degenerateTriangles++;continue;}
    signedVolume+=dot(a,cross(b,c))/6;
    v.forEach(j=>used.add(j)); parent[root(v[1])]=root(v[0]);parent[root(v[2])]=root(v[0]);
    for(let j=0;j<3;j++) { const a=v[j],b=v[(j+1)%3],key=a<b?`${a},${b}`:`${b},${a}`; const e=edges.get(key)||{count:0,direction:0};e.count++;e.direction+=a<b?1:-1;edges.set(key,e); }
  }
  const values=[...edges.values()];
  return {
    source:'generated triangle mesh', tolerance, triangleCount:triangles.length/3,
    bounds:points.length?{min,max,dimensions:max.map((v,i)=>v-min[i])}:null,
    degenerateTriangles, boundaryEdges:values.filter(e=>e.count===1).length,
    nonManifoldEdges:values.filter(e=>e.count>2).length,
    inconsistentWindingEdges:values.filter(e=>e.count===2&&e.direction!==0).length,
    disconnectedComponents:new Set([...used].map(root)).size,
    signedVolume,
    limitations:['Vertices are welded by quantized coordinates; results depend on tolerance.','Does not detect self-intersection, overlapping shells, minimum wall thickness, or physical printability.','Signed volume is meaningful only for consistently oriented closed meshes.'],
  };
}

export function sectionTriangleMesh(mesh, { axis='z', offset, tolerance=1e-5, maxSegments=10000 } = {}) {
  const ax=axisOf(axis); tolerance=toleranceOf(tolerance);
  if(!Number.isFinite(offset)||!Number.isInteger(maxSegments)||maxSegments<1||maxSegments>20000) throw new Error('Invalid section offset or segment limit');
  const {points,triangles}=prepared(mesh), segments=[], seen=new Set();let coplanarTriangles=0;
  for(let i=0;i<triangles.length;i+=3) {
    const p=[points[triangles[i]],points[triangles[i+1]],points[triangles[i+2]]], ds=p.map(q=>q[ax]-offset);
    if(ds.every(d=>Math.abs(d)<=tolerance)){coplanarTriangles++;continue;}
    const hits=[];
    const add=q=>{if(!hits.some(h=>distance(h,q)<=tolerance))hits.push(q);};
    for(let j=0;j<3;j++){const k=(j+1)%3;if(Math.abs(ds[j])<=tolerance)add(p[j]);if(ds[j]*ds[k]<0){const u=ds[j]/(ds[j]-ds[k]);add(p[j].map((v,a)=>v+u*(p[k][a]-v)));}}
    if(hits.length===2&&distance(...hits)>tolerance){const key=hits.map(p=>p.map(v=>Math.round(v/tolerance)).join(',')).sort().join('|');if(!seen.has(key)){seen.add(key);if(segments.length>=maxSegments)throw new Error('Section segment limit exceeded');segments.push(hits);}}
  }
  return {axis,offset,tolerance,segments,coplanarTriangles,limitations:['Tessellated section segments are not fitted analytic curves.','Coplanar triangles are omitted; choose an offset away from surface planes.']};
}

export function sampleSolidIntervals(mesh, { axis='z', point, tolerance=1e-5 } = {}) {
  const ax=axisOf(axis);tolerance=toleranceOf(tolerance);
  if(!Array.isArray(point)||point.length!==3||!point.every(Number.isFinite))throw new Error('point must contain three finite coordinates');
  const {points,triangles}=prepared(mesh), dir=[0,0,0];dir[ax]=1;
  const hits=[];let ambiguous=false;
  for(let i=0;i<triangles.length;i+=3){const a=points[triangles[i]],b=points[triangles[i+1]],c=points[triangles[i+2]],u=sub(b,a),v=sub(c,a),h=cross(dir,v),det=dot(u,h);if(Math.abs(det)<1e-12)continue;const s=sub(point,a),w=dot(s,h)/det,q=cross(s,u),r=dot(dir,q)/det;if(w < -1e-10||r < -1e-10||w+r>1+1e-10)continue;const t=dot(v,q)/det;hits.push(point[ax]+t);}
  hits.sort((a,b)=>a-b);const crossings=[];for(const hit of hits)if(!crossings.length||Math.abs(hit-crossings.at(-1))>tolerance)crossings.push(hit);
  if(crossings.length%2)ambiguous=true;
  return {axis,point,tolerance,crossings,intervals:ambiguous?[]:crossings.filter((_,i)=>i%2===0).map((v,i)=>[v,crossings[i*2+1]]),ambiguous,limitations:['Assumes a closed mesh with non-tangent intersections; a tangent or boundary sample may be ambiguous.','Intervals use even-odd pairing and do not establish solid validity.']};
}

/** Native signatures are body-local. This helper deliberately accepts data predicates only. */
export function selectGeometry(selectors, { kind, predicate={}, expectedFingerprint, currentFingerprint } = {}) {
  if(!expectedFingerprint||expectedFingerprint!==currentFingerprint)throw new Error('Stale or missing geometry fingerprint');
  kind = kind === 'edge' ? 'edges' : kind === 'face' ? 'faces' : kind;
  if(!['edges','faces'].includes(kind)||!Array.isArray(selectors?.[kind])||selectors[kind].length>512)throw new Error('Invalid or excessive geometry selectors');
  if(Object.keys(predicate).some(k=>!['type','extreme','axis','coordinate','tolerance','near','unique','external','radius','normal'].includes(k)))throw new Error('Unsupported semantic predicate');
  const tolerance=toleranceOf(predicate.tolerance);
  const ax=axisOf(predicate.axis||'z');
  if(predicate.extreme&&!['min','max'].includes(predicate.extreme))throw new Error('extreme must be min or max');
  if(predicate.coordinate!==undefined&&!Number.isFinite(predicate.coordinate))throw new Error('coordinate must be finite');
  if(predicate.near!==undefined&&(!Array.isArray(predicate.near)||predicate.near.length!==3||!predicate.near.every(Number.isFinite)))throw new Error('near must contain three finite coordinates');
  let candidates=selectors[kind].filter(s=>(!predicate.type||s.t===predicate.type));
  if(predicate.external!==undefined){if(typeof predicate.external!=='boolean')throw new Error('external must be boolean');candidates=candidates.filter(s=>s.ext===predicate.external);}
  if(predicate.radius!==undefined){if(!Number.isFinite(predicate.radius)||predicate.radius<=0)throw new Error('radius must be positive');candidates=candidates.filter(s=>Number.isFinite(s.r)&&Math.abs(s.r-predicate.radius)<=tolerance);}
  if(predicate.normal!==undefined){if(!Array.isArray(predicate.normal)||predicate.normal.length!==3||!predicate.normal.every(Number.isFinite)||Math.hypot(...predicate.normal)<1e-9)throw new Error('normal must be a nonzero finite vector');const norm=predicate.normal.map(v=>v/Math.hypot(...predicate.normal));candidates=candidates.filter(s=>s.t==='PLANE'&&Array.isArray(s.n)&&distance(s.n,norm)<=tolerance);}
  const center=s=>s.c||s.m;
  if(predicate.near)candidates=candidates.filter(s=>center(s)&&distance(center(s),predicate.near)<=tolerance);
  if(predicate.coordinate!==undefined)candidates=candidates.filter(s=>center(s)&&Math.abs(center(s)[ax]-predicate.coordinate)<=tolerance);
  if(predicate.extreme){const valid=candidates.filter(s=>center(s)&&Number.isFinite(center(s)[ax]));const limit=predicate.extreme==='max'?Math.max(...valid.map(s=>center(s)[ax])):Math.min(...valid.map(s=>center(s)[ax]));candidates=valid.filter(s=>Math.abs(center(s)[ax]-limit)<=tolerance);}
  return {status:selectors.truncated?'incomplete':candidates.length===1?'selected':candidates.length?'ambiguous':'not_found',selected:!selectors.truncated&&candidates.length===1?candidates[0]:null,candidates,fingerprint:currentFingerprint,coordinateSpace:'body-local',limitations:['Selection compares existing native signature centers or midpoints; it does not infer design intent.']};
}
