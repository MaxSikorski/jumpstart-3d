import json
import math
import os
from pathlib import Path
import struct
import time
import xml.etree.ElementTree as ET
import zipfile


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def stl_triangles(filename):
    data = Path(filename).read_bytes()
    require(len(data) >= 84, 'truncated binary STL header')
    count = struct.unpack_from('<I', data, 80)[0]
    require(count > 0 and len(data) == 84 + 50 * count, 'binary STL length/count mismatch')
    triangles = []
    for i in range(count):
        values = struct.unpack_from('<12f', data, 84 + 50 * i)
        require(all(math.isfinite(x) for x in values), 'nonfinite STL normal/coordinate')
        triangles.append([tuple(values[j:j + 3]) for j in (3, 6, 9)])
    return triangles


def three_mf_triangles(filename, expected_objects):
    core = '{http://schemas.microsoft.com/3dmanufacturing/core/2015/02}'
    with zipfile.ZipFile(filename) as archive:
        names = archive.namelist()
        require(len(names) == 3 and set(names) == {'[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model'}, 'unsupported 3MF package layout')
        relations = ET.fromstring(archive.read('_rels/.rels'))
        rel = '{http://schemas.openxmlformats.org/package/2006/relationships}'
        require(relations.tag == rel + 'Relationships' and len(relations) == 1, 'unsupported 3MF relationships')
        require(relations[0].tag == rel + 'Relationship' and relations[0].get('Target') == '/3D/3dmodel.model' and relations[0].get('Type') == 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel' and relations[0].get('TargetMode') in (None, 'Internal'), 'unsupported 3MF model relationship')
        types = ET.fromstring(archive.read('[Content_Types].xml'))
        require(any(e.get('Extension') == 'model' and e.get('ContentType') == 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' for e in types), 'missing 3MF model content type')
        model = ET.fromstring(archive.read('3D/3dmodel.model'))
    require(model.tag == core + 'model' and model.get('unit') == 'millimeter', '3MF must use millimeters')
    require(len(model.findall(core + 'resources')) == 1 and len(model.findall(core + 'build')) == 1, 'missing/duplicate 3MF resources/build')
    resources, build = model.find(core + 'resources'), model.find(core + 'build')
    ids, objects = set(), {}
    for resource in resources:
        identity = resource.get('id')
        require(identity is not None and identity.isdigit() and int(identity) > 0 and int(identity) not in ids, 'invalid/duplicate 3MF resource id')
        ids.add(int(identity))
        require(resource.tag in (core + 'object', core + 'basematerials'), 'unsupported 3MF resource')
        if resource.tag != core + 'object':
            continue
        require(resource.get('type', 'model') == 'model' and len(resource) == 1 and resource[0].tag == core + 'mesh', 'unsupported 3MF components/object')
        mesh = resource[0]
        require(len(mesh) == 2 and len(mesh.findall(core + 'vertices')) == 1 and len(mesh.findall(core + 'triangles')) == 1, 'unsupported 3MF mesh layout')
        vertices, triangles = [], []
        for vertex in mesh.find(core + 'vertices'):
            require(vertex.tag == core + 'vertex', 'unsupported 3MF vertex')
            xyz = tuple(float(vertex.attrib[k]) for k in ('x', 'y', 'z'))
            require(all(math.isfinite(x) for x in xyz), 'nonfinite 3MF coordinate')
            vertices.append(xyz)
        for triangle in mesh.find(core + 'triangles'):
            require(triangle.tag == core + 'triangle', 'unsupported 3MF triangle')
            indexes = [int(triangle.attrib[k]) for k in ('v1', 'v2', 'v3')]
            require(all(0 <= i < len(vertices) for i in indexes), 'invalid 3MF triangle index')
            triangles.append([vertices[i] for i in indexes])
        require(vertices and triangles, 'empty 3MF mesh')
        objects[int(identity)] = triangles
    meshes, referenced = [], set()
    identity_transform = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
    for item in build:
        require(item.tag == core + 'item' and item.get('printable', '1') == '1', 'unsupported 3MF build item')
        transform = item.get('transform')
        require(transform is None or [float(x) for x in transform.split()] == identity_transform, 'unsupported 3MF item transform')
        identity = int(item.attrib['objectid'])
        require(identity in objects and identity not in referenced, 'missing/duplicate 3MF build object')
        referenced.add(identity)
        meshes.append(objects[identity])
    require(len(meshes) == expected_objects and referenced == set(objects), '3MF build/object count mismatch')
    return meshes


def original_topology(triangles):
    require(triangles, 'empty triangles')
    points, faces, index, unique_faces = [], [], {}, set()
    edges, links = {}, {}
    for triangle in triangles:
        face = []
        for point in triangle:
            require(len(point) == 3 and all(math.isfinite(x) for x in point), 'nonfinite mesh coordinate')
            # Equal coordinates, including negative zero, are the only permitted weld.
            if point not in index:
                index[point] = len(points)
                points.append(point)
            face.append(index[point])
        a, b, c = triangle
        ab = [b[i] - a[i] for i in range(3)]
        ac = [c[i] - a[i] for i in range(3)]
        cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]]
        require(all(math.isfinite(x) for x in cross) and any(x != 0 for x in cross), 'zero-area/nonfinite triangle')
        key = tuple(sorted(face))
        require(key not in unique_faces, 'duplicate triangle')
        unique_faces.add(key)
        face_id = len(faces)
        faces.append(face)
        for a, b, c in ((face[0], face[1], face[2]), (face[1], face[2], face[0]), (face[2], face[0], face[1])):
            edges.setdefault(tuple(sorted((a, b))), []).append((face_id, a < b))
            links.setdefault(a, []).append((b, c))
    open_edges = sum(len(e) == 1 for e in edges.values())
    nonmanifold_edges = sum(len(e) > 2 for e in edges.values())
    winding_edges = sum(len(e) == 2 and e[0][1] == e[1][1] for e in edges.values())
    bad_vertices = 0
    for pairs in links.values():
        neighbors = {}
        for a, b in pairs:
            neighbors.setdefault(a, []).append(b)
            neighbors.setdefault(b, []).append(a)
        seen, pending = set(), [next(iter(neighbors))]
        while pending:
            vertex = pending.pop()
            if vertex not in seen:
                seen.add(vertex)
                pending.extend(n for n in neighbors[vertex] if n not in seen)
        if len(seen) != len(neighbors) or any(len(n) != 2 for n in neighbors.values()):
            bad_vertices += 1
    adjacent = [set() for _ in faces]
    for edge in edges.values():
        for i, _ in edge:
            adjacent[i].update(j for j, _ in edge if i != j)
    unseen, components = set(range(len(faces))), []
    while unseen:
        pending, component = [unseen.pop()], []
        while pending:
            face = pending.pop()
            component.append(face)
            neighbors = adjacent[face] & unseen
            unseen.difference_update(neighbors)
            pending.extend(neighbors)
        components.append(component)
    details = {'facets': len(faces), 'vertices': len(points), 'open_edges': open_edges, 'nonmanifold_edges': nonmanifold_edges, 'winding_edges': winding_edges, 'nonmanifold_vertices': bad_vertices, 'components': len(components)}
    reasons = [f'{k}={details[k]}' for k in ('open_edges', 'nonmanifold_edges', 'winding_edges', 'nonmanifold_vertices') if details[k]]
    return details, reasons, components


def check_meshes(item, Mesh, details):
    meshes = [stl_triangles(item['path'])] if item['format'] == 'stl' else three_mf_triangles(item['path'], item['expectedObjects'])
    details['meshes'] = []
    reasons = []
    for triangles in meshes:
        measured, raw_reasons, components = original_topology(triangles)
        details['meshes'].append(measured)
        mesh = Mesh.Mesh(triangles)
        measured.update(freecad_facets=mesh.CountFacets, freecad_points=mesh.CountPoints, isSolid=mesh.isSolid(), hasNonManifolds=mesh.hasNonManifolds(), hasNonUniformOrientedFacets=mesh.hasNonUniformOrientedFacets())
        reasons.extend(raw_reasons)
        if mesh.CountFacets != len(triangles):
            reasons.append('FreeCAD changed facet count')
        if not measured['isSolid']:
            reasons.append('FreeCAD isSolid=false')
        for key in ('hasNonManifolds', 'hasNonUniformOrientedFacets'):
            if measured[key]:
                reasons.append('FreeCAD ' + key + '=true')
        measured['self_intersections'] = []
        measured['self_intersection_triangles'] = []
        for component in components:
            submesh = Mesh.Mesh([triangles[i] for i in component])
            require(submesh.CountFacets == len(component), 'FreeCAD changed component facet count')
            crossing = submesh.hasSelfIntersections()
            measured['self_intersections'].append(crossing)
            if crossing and hasattr(submesh, 'getSelfIntersections'):
                # The first few crossing pairs, as indexes into the original triangle list, so a reviewer can inspect them.
                measured['self_intersection_triangles'].append([[component[i], component[j]] for i, j in submesh.getSelfIntersections()[:5]])
        if any(measured['self_intersections']):
            reasons.append('FreeCAD self-intersection within an edge-connected component')
    require(not reasons, '; '.join(reasons))
    details['rawTopology'] = 'OK'


def check_step(item, Part, details):
    shape = Part.read(item['path'])
    details['null'] = shape.isNull()
    require(not details['null'], 'null STEP shape')
    solids, shells = shape.Solids, shape.Shells
    volume, expected = shape.Volume, item['expectedVolume']
    details.update(valid=shape.isValid(), closed=shape.isClosed(), solids=len(solids), shells=len(shells), volume=volume, expectedVolume=expected, expectedSolids=item['expectedSolids'])
    details['solidChecks'] = [{'valid': s.isValid(), 'closed': s.isClosed(), 'volume': s.Volume} for s in solids]
    details['shellsClosed'] = [s.isClosed() for s in shells]
    details['deltaPercent'] = abs(volume - expected) / expected * 100
    reasons = []
    if not details['valid']:
        reasons.append('invalid STEP shape')
    # A null count means the reviewed count is missing: measure it and let the Node side fail the file.
    if len(solids) == 0 or (item['expectedSolids'] is not None and len(solids) != item['expectedSolids']):
        reasons.append(f"solid count {len(solids)}, expected {item['expectedSolids']}")
    if not shells or not all(details['shellsClosed']):
        reasons.append('open or missing STEP shell')
    for solid in details['solidChecks']:
        if not solid['valid'] or not solid['closed'] or not math.isfinite(solid['volume']) or solid['volume'] <= 0:
            reasons.append('invalid/open/nonpositive STEP solid')
    pending = [shape]
    while pending:
        child = pending.pop()
        if child.ShapeType in ('Compound', 'CompSolid'):
            children = child.childShapes()
            if not children:
                reasons.append('empty STEP compound')
            pending.extend(children)
        elif child.ShapeType != 'Solid':
            reasons.append('non-solid STEP leaf: ' + child.ShapeType)
    if not math.isfinite(volume) or volume <= 0 or abs(volume - expected) > 0.005 * expected:
        reasons.append('STEP volume outside 0.5% of expected world volume')
    require(not reasons, '; '.join(reasons))


def emit(kind, value):
    print('\nJUDGE_' + kind + ' ' + json.dumps(value, allow_nan=False), flush=True)


def main():
    import FreeCAD as App
    import Mesh
    import Part

    version = App.Version()
    emit('VERSION', {'version': '.'.join(version[:3]), 'full': version})
    request = json.loads(Path(os.environ['JUDGE_REQUEST']).read_text())
    require(request['schema'] == 1 and request['runId'].strip(), 'invalid judge request')
    passed = 0
    for item in request['files']:
        print('\nJUDGE_BEGIN ' + item['key'], flush=True)
        start = time.perf_counter()
        result = {k: item[k] for k in ('build', 'fixture', 'format')}
        result.update(runId=request['runId'], ok=False, details={})
        try:
            require('.'.join(version[:3]) == '1.1.4', 'unpinned FreeCAD version')
            if item['format'] == 'step':
                require((item['expectedSolids'] is None or (isinstance(item['expectedSolids'], int) and item['expectedSolids'] > 0)) and math.isfinite(item['expectedVolume']) and item['expectedVolume'] > 0, 'invalid STEP expectations')
                check_step(item, Part, result['details'])
            else:
                require(item['format'] in ('stl', '3mf'), 'unsupported format')
                check_meshes(item, Mesh, result['details'])
            result['ok'] = True
            passed += 1
        except Exception as error:
            result['reason'] = type(error).__name__ + ': ' + str(error)
        result['elapsedMs'] = (time.perf_counter() - start) * 1000
        # Nonfinite measurements must not turn an error into an unreadable protocol record.
        def finite(value):
            if isinstance(value, float) and not math.isfinite(value):
                return str(value)
            if isinstance(value, dict):
                return {k: finite(v) for k, v in value.items()}
            if isinstance(value, list):
                return [finite(v) for v in value]
            return value
        emit('RESULT', finite(result))
    emit('COMPLETE', {'runId': request['runId'], 'count': len(request['files']), 'passed': passed, 'failed': len(request['files']) - passed})


# FreeCAD's console runs a script file with a name other than __main__, so main() is called unguarded.
main()
