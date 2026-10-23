import type {
  TopoDS_Compound,
  TopoDS_Face,
  TopoDS_Shape,
  TopoDS_Solid,
} from "replicad-opencascadejs";

import { DEG2RAD } from "../constants.js";
import {
  asDir,
  asPnt,
  makePln,
  type Plane,
  type PlaneName,
  type SimplePoint,
} from "../geom.js";
import { makePlane } from "../geomHelpers.js";
import { getOC } from "../oclib.js";
import { GCWithScope, localGC } from "../register.js";
import { unwrapShape, type ShapeInput } from "./shapeInput.js";
import { iterTopo } from "./topology.js";

export interface BooleanOperationOptions {
  optimisation?: "none" | "commonFace" | "sameFace";
}

export interface ShellOptions {
  faces: Iterable<ShapeInput<TopoDS_Face>>;
  thickness: number;
  tolerance?: number;
}

export interface DraftOptions {
  faces: Iterable<ShapeInput<TopoDS_Face>>;
  angle: number;
  neutralPlane?: Plane | PlaneName;
}

export type PlaneSide = "positive" | "negative";

/** Pieces grouped by their position relative to an oriented plane. */
export interface PlaneSplitResult<T> {
  positive: T | null;
  negative: T | null;
  on: T | null;
}

const configureGlue = (
  builder: {
    SetGlue(value: any): void;
  },
  optimisation: BooleanOperationOptions["optimisation"]
): void => {
  const oc = getOC();
  if (optimisation === "commonFace") {
    builder.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueShift);
  }
  if (optimisation === "sameFace") {
    builder.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueFull);
  }
};

// jumpstart-3d: replicad merged faces after every boolean with SimplifyResult(true, true, 1e-3), and on round faces
// that merge goes wrong. A torus (two faces) that a boolean leaves untouched becomes one face with no boundary
// loops, which the mesher turns into no triangles: the torus vanishes from views and exports. On a sphere whose seam
// is split, merging edges and faces together rebuilds a wrong face (an intersect gave 4188.79 mm3 instead of 2360.38).
// A result with no spherical or toroidal face is merged exactly as before. Otherwise the same kind of merge (edges, faces, B-splines) runs with the
// edges of those faces kept, so flat faces still merge and the round ones are left as the boolean made them.
function simplifiedResult(builder: {
  Shape(): TopoDS_Shape;
  SimplifyResult(
    unifyEdges: boolean,
    unifyFaces: boolean,
    angularTolerance: number
  ): void;
}): TopoDS_Shape {
  const oc = getOC();
  const [r, gc] = localGC();
  try {
    const raw = r(builder.Shape());
    const round: TopoDS_Face[] = [];
    const faces = r(
      new oc.TopExp_Explorer(
        raw,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE
      )
    );
    for (; faces.More(); faces.Next()) {
      const face = r(oc.TopoDS.Face(r(faces.Current())));
      const surface = r(new oc.BRepAdaptor_Surface(face, true));
      const type = surface.GetType();
      if (
        type === oc.GeomAbs_SurfaceType.GeomAbs_Sphere ||
        type === oc.GeomAbs_SurfaceType.GeomAbs_Torus
      ) {
        round.push(face);
      }
    }
    if (!round.length) {
      builder.SimplifyResult(true, true, 1e-3);
      return builder.Shape();
    }
    const unify = r(
      new oc.ShapeUpgrade_UnifySameDomain(raw, true, true, true)
    );
    for (const face of round) {
      const edges = r(
        new oc.TopExp_Explorer(
          face,
          oc.TopAbs_ShapeEnum.TopAbs_EDGE,
          oc.TopAbs_ShapeEnum.TopAbs_SHAPE
        )
      );
      for (; edges.More(); edges.Next()) unify.KeepShape(r(edges.Current()));
    }
    unify.SetAngularTolerance(1e-3);
    unify.Build();
    // jumpstart-3d: a boolean between round faces can leave a face whose outer boundary is split into two loops; the
    // mesher reads the second loop as a hole and leaves out part of the face (two torus groups joined: 243 mm3 short).
    // ShapeFix rejoins the loops, solid by solid. A result with loose faces or no solid is returned as it is.
    const unified = unify.Shape(); // not registered: it is the result when there is nothing to fix
    const solids = r(
      new oc.TopExp_Explorer(
        unified,
        oc.TopAbs_ShapeEnum.TopAbs_SOLID,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE
      )
    );
    const loose = r(
      new oc.TopExp_Explorer(
        unified,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SOLID
      )
    );
    if (!solids.More() || loose.More()) return unified;
    const fixes: any[] = [];
    for (; solids.More(); solids.Next()) {
      const fix = r(new oc.ShapeFix_Solid());
      fix.Init(r(oc.TopoDS.Solid(r(solids.Current()))));
      fix.Perform(r(new oc.Message_ProgressRange()));
      fixes.push(fix);
    }
    unified.delete();
    if (fixes.length === 1) return fixes[0].Solid();
    const compoundBuilder = r(new oc.TopoDS_Builder());
    const out = new oc.TopoDS_Compound();
    compoundBuilder.MakeCompound(out);
    for (const fix of fixes) compoundBuilder.Add(out, r(fix.Solid()));
    return out;
  } finally {
    gc();
  }
}

// jumpstart-3d: two results the engine gets wrong without saying so, each built again with a small fuzzy value.
// 1. Two round faces that touch at a single point (a torus cut by a torus hole that only touches it) can leave a
//    zero-length edge whose tolerance grows to millimetres (5.78 mm in fuzz seed 32). The shape still measures right,
//    but every later boolean near that edge goes wrong: its intersect with an oval sphere came out empty although they
//    overlap by 44 mm3. The first value that leaves no loose edge and the same volume is kept (1e-4 in that case).
// 2. A missed overlap: an oval sphere (20 by 30 by 10) joined with an oval cylinder (10 by 14 by 12 at x = 5) lost the
//    sphere and their intersect was empty, and their cuts came out too big (one of them not even a valid solid). Which
//    fuzzy values are right is erratic (here 3e-4, 3e-3 and 1e-2; 1e-6 gives the sum of the two volumes, 1e-4 and 1e-3
//    repeat the mistake), so the volumes decide. Only a meaningful overlap is judged: the inputs' boxes must overlap
//    by at least 1 % of the larger box and 5 % of the smaller one, so a hole in a big body costs nothing extra (an
//    oval sphere with 50 holes of 0.5 mm built several times slower and ran out of memory when every cut was judged
//    against the whole body). All limits are relative to the smaller input's volume (0.1 %). A result is suspect when
//    a fuse is smaller than the larger input or larger than both together, a cut larger than its base or smaller than
//    base minus tool, an intersect larger than the smaller input or empty. When an input has a rational B-spline face
//    (the oval sphere's) a fuse that is just the sum of the inputs, a cut that removed nothing and a result that is not
//    a valid solid are suspect too. Then the result is built again, with the intersect at the same value, and the
//    first value is kept whose pair adds up (fuse + intersect = both inputs, cut = base - intersect), shows an overlap
//    and is valid; a value the engine cannot build is skipped.
type BooleanBuilder = {
  Shape(): TopoDS_Shape;
  SetArguments(shapes: any): void;
  SetTools(shapes: any): void;
  SetFuzzyValue(value: number): void;
  SetGlue(value: any): void;
  HasErrors(): boolean;
  Build(): void;
  delete(): void;
};
function withoutLooseEdges<B extends BooleanBuilder>(
  builder: B,
  fresh: () => B,
  left: TopoDS_Shape,
  right: TopoDS_Shape,
  optimisation: BooleanOperationOptions["optimisation"],
  kind: "fuse" | "cut" | "common"
): B {
  const oc = getOC();
  const [r, gc] = localGC();
  try {
    const loosest = (shape: TopoDS_Shape) =>
      oc.BRep_Tool.MaxTolerance(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
    const volume = (shape: TopoDS_Shape) => {
      const props = r(new oc.GProp_GProps());
      oc.BRepGProp.VolumeProperties(shape, props, false, false, false);
      return props.Mass();
    };
    const lazy = <T>(make: () => T) => {
      let done = false, value: T;
      return () => (done ? value : ((done = true), (value = make())));
    };
    const built = (make: () => B, fuzzy: number, glue: boolean): B => {
      const again = make();
      try {
        const args = r(new oc.NCollection_List_TopoDS_Shape());
        args.Append(left);
        const tools = r(new oc.NCollection_List_TopoDS_Shape());
        tools.Append(right);
        again.SetArguments(args);
        again.SetTools(tools);
        again.SetFuzzyValue(fuzzy);
        if (glue) configureGlue(again, optimisation);
        again.Build();
        return again;
      } catch (e) {
        again.delete();
        throw e;
      }
    };
    const rebuild = (fuzzies: number[], accept: (got: TopoDS_Shape, fuzzy: number) => boolean): B | null => {
      for (const fuzzy of fuzzies) {
        let retry: B | null = null;
        try {
          retry = built(fresh, fuzzy, true);
          if (!retry.HasErrors() && accept(r(retry.Shape()), fuzzy)) return retry; // the caller registers the builder it gets back and the one it passed in
        } catch (e) {
          // an engine exception skips the value; a crashed wasm instance cannot be trusted, so it is rethrown
          if (e instanceof WebAssembly.RuntimeError || e instanceof RangeError) {
            retry?.delete();
            throw e;
          }
        }
        retry?.delete();
      }
      return null;
    };
    // a clean boolean's edges stay near the inputs' own (5e-6 mm there)
    const limit = Math.max(1e-3, 100 * Math.max(loosest(left), loosest(right)));
    if (builder.HasErrors()) return builder;
    const first = r(builder.Shape());

    // the overlap is meaningful when the inputs' boxes share at least 1 % of the larger box and 5 % of the smaller
    const meaningful = lazy(() => {
      const [p, q] = [left, right].map((shape) => {
        const box = r(new oc.Bnd_Box());
        oc.BRepBndLib.Add(shape, box, false);
        const [lo, hi] = [r(box.CornerMin()), r(box.CornerMax())];
        return [[lo.X(), lo.Y(), lo.Z()], [hi.X(), hi.Y(), hi.Z()]];
      });
      const size = (b: number[][]) => (b[1][0] - b[0][0]) * (b[1][1] - b[0][1]) * (b[1][2] - b[0][2]);
      let shared = 1;
      for (let i = 0; i < 3; i++) {
        const span = Math.min(p[1][i], q[1][i]) - Math.max(p[0][i], q[0][i]);
        if (!(span > 1e-3)) return false;
        shared *= span;
      }
      const [big, small] = [Math.max(size(p), size(q)), Math.min(size(p), size(q))];
      return shared >= 0.01 * big && shared >= 0.05 * small;
    });
    const vl = lazy(() => volume(left)), vr = lazy(() => volume(right));
    const tol = lazy(() => 1e-3 * Math.min(vl(), vr()));
    // inputs without a positive volume (a wire, a broken solid) cannot be judged
    const judged = lazy(() => meaningful() && vl() > 0 && vr() > 0);
    const inRange = (v: number) => {
      const lo = kind === "fuse" ? Math.max(vl(), vr()) : kind === "cut" ? vl() - vr() : 0;
      const hi = kind === "fuse" ? vl() + vr() : kind === "cut" ? vl() : Math.min(vl(), vr());
      return v >= lo - tol() && v <= hi + tol();
    };
    const vanished = (common: number) => common < tol();
    const spline = lazy(() => [left, right].some((shape) => { // a rational B-spline face (the oval sphere's); exact surfaces and swept ones the engine handles well
      const ga = oc.GeomAbs_SurfaceType;
      const faces = r(new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
      for (; faces.More(); faces.Next()) {
        const surface = r(new oc.BRepAdaptor_Surface(oc.TopoDS.Face(r(faces.Current())), true));
        if (surface.GetType() === ga.GeomAbs_BSplineSurface) {
          const bspline = r(surface.BSpline());
          if (bspline.IsURational() || bspline.IsVRational()) return true;
        }
      }
      return false;
    }));
    const isValid = (shape: TopoDS_Shape) => r(new oc.BRepCheck_Analyzer(shape, true, false)).IsValid();
    // a fuse that is the sum of its inputs or a cut that removed nothing found no overlap
    const noOverlap = (v: number) => kind === "fuse" ? v >= vl() + vr() - tol() : kind === "cut" && v >= vl() - tol();
    const suspect = () => {
      if (!judged()) return false;
      const want = volume(first);
      if (!inRange(want) || (kind === "common" && vanished(want))) return true;
      return spline() && (noOverlap(want) || !isValid(first));
    };
    if (suspect()) {
      const found = rebuild([1e-6, 1e-5, 1e-4, 3e-4, 1e-3, 3e-3, 1e-2], (got, fuzzy) => {
        const x = volume(got);
        if (!inRange(x) || (spline() && !isValid(got))) return false;
        if (kind === "common") return !vanished(x);
        const partner = built(() => new oc.BRepAlgoAPI_Common() as any, fuzzy, false);
        try {
          if (partner.HasErrors()) return false;
          const c = volume(r(partner.Shape()));
          return !vanished(c) && Math.abs(x - (kind === "fuse" ? vl() + vr() - c : vl() - c)) <= 2 * tol();
        } finally {
          partner.delete();
        }
      });
      if (found) return found;
    }

    if (loosest(first) <= limit) return builder;
    // the rebuild only cleans the edge: a fuzzy value that changes the result's volume is not kept
    const want = volume(first);
    return rebuild([1e-6, 1e-5, 1e-4], (got) =>
      loosest(got) <= limit && Math.abs(volume(got) - want) <= 1e-3 + 1e-4 * Math.abs(want)
    ) ?? builder;
  } finally {
    gc();
  }
}

/** Builds a raw shape by fusing two shapes. */
export function fuseShapes(
  leftInput: ShapeInput,
  rightInput: ShapeInput,
  { optimisation = "none" }: BooleanOperationOptions = {}
): TopoDS_Shape {
  const oc = getOC();
  const r = GCWithScope();
  const left = unwrapShape(leftInput), right = unwrapShape(rightInput); // jumpstart-3d: loose edges
  const builder = r(new oc.BRepAlgoAPI_Fuse(left, right));

  configureGlue(builder, optimisation);
  builder.Build();
  const done = withoutLooseEdges(builder, () => new oc.BRepAlgoAPI_Fuse(), left, right, optimisation, "fuse"); // jumpstart-3d: loose edges
  if (done !== builder) r(done);
  return simplifiedResult(done); // jumpstart-3d: was SimplifyResult(true, true, 1e-3) and builder.Shape()
}

/** Builds a raw shape by cutting a tool shape from another shape. */
export function cutShape(
  shapeInput: ShapeInput,
  toolInput: ShapeInput,
  { optimisation = "none" }: BooleanOperationOptions = {}
): TopoDS_Shape {
  const oc = getOC();
  const r = GCWithScope();
  const shape = unwrapShape(shapeInput), tool = unwrapShape(toolInput); // jumpstart-3d: loose edges
  const builder = r(new oc.BRepAlgoAPI_Cut(shape, tool));

  configureGlue(builder, optimisation);
  builder.Build();
  const done = withoutLooseEdges(builder, () => new oc.BRepAlgoAPI_Cut(), shape, tool, optimisation, "cut"); // jumpstart-3d: loose edges
  if (done !== builder) r(done);
  return simplifiedResult(done); // jumpstart-3d: was SimplifyResult(true, true, 1e-3) and builder.Shape()
}

/** Builds a raw shape containing the intersection of two shapes. */
export function intersectShapes(
  leftInput: ShapeInput,
  rightInput: ShapeInput
): TopoDS_Shape {
  const oc = getOC();
  const r = GCWithScope();
  const left = unwrapShape(leftInput), right = unwrapShape(rightInput); // jumpstart-3d: loose edges
  const builder = r(new oc.BRepAlgoAPI_Common(left, right));

  builder.Build();
  const done = withoutLooseEdges(builder, () => new oc.BRepAlgoAPI_Common(), left, right, "none", "common"); // jumpstart-3d: loose edges
  if (done !== builder) r(done);
  return simplifiedResult(done); // jumpstart-3d: was SimplifyResult(true, true, 1e-3) and builder.Shape()
}

const signedDistanceToPlane = (point: SimplePoint, plane: Plane): number =>
  (point[0] - plane.origin.x) * plane.zDir.x +
  (point[1] - plane.origin.y) * plane.zDir.y +
  (point[2] - plane.origin.z) * plane.zDir.z;

/**
 * Splits a shape with an oriented plane and groups pieces by side.
 *
 * `offset` translates the splitting plane along its normal. A side is null
 * when empty, the piece itself when it contains one piece, and a compound when
 * it contains multiple disconnected pieces.
 */
export function splitShape(
  shapeInput: ShapeInput,
  inputPlane: Plane | PlaneName = "XY",
  offset = 0,
  tolerance = 1e-7
): PlaneSplitResult<TopoDS_Solid | TopoDS_Compound> {
  const oc = getOC();
  const r = GCWithScope();
  const shape = unwrapShape(shapeInput);
  const basePlane = r(makePlane(inputPlane));
  const plane =
    offset === 0
      ? basePlane
      : r(
          basePlane.translate([
            basePlane.zDir.x * offset,
            basePlane.zDir.y * offset,
            basePlane.zDir.z * offset,
          ])
        );
  const ocPlane = r(makePln(plane.origin, plane.zDir));
  const faceBuilder = r(new oc.BRepBuilderAPI_MakeFace(ocPlane));
  const splittingFace = r(faceBuilder.Face());

  const argumentsList = r(new oc.NCollection_List_TopoDS_Shape());
  argumentsList.Append(shape);
  const toolsList = r(new oc.NCollection_List_TopoDS_Shape());
  toolsList.Append(splittingFace);

  const builder = r(new oc.BRepAlgoAPI_Splitter());
  builder.SetArguments(argumentsList);
  builder.SetTools(toolsList);
  builder.Build();
  if (builder.HasErrors()) throw new Error("Could not split shape with plane");

  // Splitter.Shape() contains the split arguments but not the tools. We only
  // expose solid results; section edges, faces, shells, and other topology are
  // intentionally ignored.
  const splitResult = builder.Shape();
  const pieces: TopoDS_Solid[] =
    splitResult.ShapeType() === oc.TopAbs_ShapeEnum.TopAbs_SOLID
      ? [oc.TopoDS.Solid(splitResult)]
      : [...iterTopo(splitResult, "solid")];
  splitResult.delete();

  const grouped = {
    positive: [] as TopoDS_Solid[],
    negative: [] as TopoDS_Solid[],
    on: [] as TopoDS_Solid[],
  };

  for (const piece of pieces) {
    const bounds = r(new oc.Bnd_Box());
    oc.BRepBndLib.Add(piece, bounds, true);
    const min = r(bounds.CornerMin());
    const max = r(bounds.CornerMax());
    const center: SimplePoint = [
      (min.X() + max.X()) / 2,
      (min.Y() + max.Y()) / 2,
      (min.Z() + max.Z()) / 2,
    ];
    const distance = signedDistanceToPlane(center, plane);

    if (distance > tolerance) grouped.positive.push(piece);
    else if (distance < -tolerance) grouped.negative.push(piece);
    else grouped.on.push(piece);
  }

  const asShape = (
    group: TopoDS_Solid[]
  ): TopoDS_Solid | TopoDS_Compound | null => {
    if (!group.length) return null;
    if (group.length === 1) return group[0];

    const compound = new oc.TopoDS_Compound();
    const compoundBuilder = r(new oc.TopoDS_Builder());
    compoundBuilder.MakeCompound(compound);
    group.forEach((piece) => compoundBuilder.Add(compound, piece));
    group.forEach((piece) => piece.delete());
    return compound;
  };

  return {
    positive: asShape(grouped.positive),
    negative: asShape(grouped.negative),
    on: asShape(grouped.on),
  };
}

/**
 * Cuts a shape with the half-space defined by an oriented plane.
 *
 * `keep` identifies the side that remains. Positive is the direction of the
 * plane normal. The offset translates the plane along that normal.
 */
export function cutShapeWithPlane(
  shapeInput: ShapeInput,
  inputPlane: Plane | PlaneName = "XY",
  offset = 0,
  keep: PlaneSide = "positive"
): TopoDS_Solid | TopoDS_Compound | null {
  const oc = getOC();
  const r = GCWithScope();
  const shape = unwrapShape(shapeInput);
  const basePlane = r(makePlane(inputPlane));
  const plane =
    offset === 0
      ? basePlane
      : r(
          basePlane.translate([
            basePlane.zDir.x * offset,
            basePlane.zDir.y * offset,
            basePlane.zDir.z * offset,
          ])
        );
  const ocPlane = r(makePln(plane.origin, plane.zDir));
  const faceBuilder = r(new oc.BRepBuilderAPI_MakeFace(ocPlane));
  const face = r(faceBuilder.Face());

  // MakeHalfSpace creates the side containing its reference point. Build the
  // side that should be removed, then subtract it from the input shape.
  const removedSign = keep === "negative" ? 1 : -1;
  const referencePoint = r(
    asPnt([
      plane.origin.x + plane.zDir.x * removedSign,
      plane.origin.y + plane.zDir.y * removedSign,
      plane.origin.z + plane.zDir.z * removedSign,
    ])
  );
  const halfSpaceBuilder = r(
    new oc.BRepPrimAPI_MakeHalfSpace(face, referencePoint)
  );
  const halfSpace = r(halfSpaceBuilder.Solid());

  const builder = r(new oc.BRepAlgoAPI_Cut(shape, halfSpace));
  builder.Build();
  if (builder.HasErrors()) throw new Error("Could not cut shape with plane");

  const cutResult = builder.Shape();
  const solids: TopoDS_Solid[] =
    cutResult.ShapeType() === oc.TopAbs_ShapeEnum.TopAbs_SOLID
      ? [oc.TopoDS.Solid(cutResult)]
      : [...iterTopo(cutResult, "solid")];
  cutResult.delete();

  if (!solids.length) return null;
  if (solids.length === 1) return solids[0];

  const compound = new oc.TopoDS_Compound();
  const compoundBuilder = r(new oc.TopoDS_Builder());
  compoundBuilder.MakeCompound(compound);
  solids.forEach((solid) => compoundBuilder.Add(compound, solid));
  solids.forEach((solid) => solid.delete());
  return compound;
}

/**
 * Hollows a shape by removing the supplied faces and retaining a wall of the
 * requested thickness.
 */
export function shellShape(
  shapeInput: ShapeInput,
  { faces, thickness, tolerance = 1e-3 }: ShellOptions
): TopoDS_Shape {
  const oc = getOC();
  const r = GCWithScope();
  const facesToRemove = r(new oc.NCollection_List_TopoDS_Shape());

  for (const face of faces) facesToRemove.Append(unwrapShape(face));

  const builder = r(new oc.BRepOffsetAPI_MakeThickSolid());
  builder.MakeThickSolidByJoin(
    unwrapShape(shapeInput),
    facesToRemove,
    -thickness,
    tolerance,
    oc.BRepOffset_Mode.BRepOffset_Skin,
    false,
    false,
    oc.GeomAbs_JoinType.GeomAbs_Arc,
    false
  );

  return builder.Shape();
}

/** Applies a draft angle to the supplied faces of a shape. */
export function draftShape(
  shapeInput: ShapeInput,
  { faces, angle, neutralPlane = "XY" }: DraftOptions
): TopoDS_Shape {
  const oc = getOC();
  const shape = unwrapShape(shapeInput);
  const builder = new oc.BRepOffsetAPI_DraftAngle(shape);
  const inputPlane = makePlane(neutralPlane);
  const plane = makePln(inputPlane.origin, inputPlane.zDir);
  const direction = asDir(inputPlane.zDir);

  for (const face of faces) {
    builder.Add(unwrapShape(face), direction, angle * DEG2RAD, plane, false);
  }

  builder.Build();
  const result = builder.ModifiedShape(shape);

  builder.delete();
  plane.delete();
  direction.delete();
  inputPlane.delete();
  return result;
}
