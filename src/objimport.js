// jumpstart-3d: OBJ geometry only; object/material groups share one imported mesh.
export function objPositions(buffer) {
  const vertices = [], out = [];
  const lines = new TextDecoder().decode(buffer).split(/\r\n?|\n/);
  for (let line = 0; line < lines.length; line++) {
    const startLine = line, chunks = [];
    let continued;
    do {
      const part = lines[line].split("#", 1)[0].trimEnd();
      continued = part.endsWith("\\");
      chunks.push(continued ? part.slice(0, -1) : part);
    } while (continued && ++line < lines.length);
    const fields = chunks.join(" ").trim().split(/\s+/);
    const fail = (reason) => { throw new Error(`This OBJ file has ${reason} (line ${startLine + 1}).`); };
    if (fields[0] === "v") {
      const xyz = fields.slice(1, 4).map(Number);
      if (xyz.length !== 3 || !xyz.every(Number.isFinite)) fail("invalid vertex coordinates");
      vertices.push(xyz);
    } else if (fields[0] === "f") {
      if (fields.length < 4) fail("a face with fewer than three vertices");
      const face = fields.slice(1).map((field) => {
        const indexText = field.split("/", 1)[0];
        const index = Number(indexText);
        if (!/^[+-]?\d+$/.test(indexText) || !Number.isSafeInteger(index) || index === 0) fail("an invalid face vertex index");
        const resolved = index < 0 ? vertices.length + index : index - 1;
        if (resolved < 0 || resolved >= vertices.length) fail("a face vertex index out of range");
        return vertices[resolved];
      });
      for (let i = 1; i + 1 < face.length; i++) out.push(...face[0], ...face[i], ...face[i + 1]);
    }
  }
  if (!out.length) throw new Error("This OBJ file has no triangles to import.");
  const pos = new Float32Array(out);
  if (!pos.every(Number.isFinite)) throw new Error("This OBJ file has invalid vertex coordinates.");
  return pos;
}
