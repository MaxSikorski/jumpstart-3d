// A short representation that does not run input accessors or conversion hooks.
export function show(value) {
  let out = '', cut = false;
  const add = (s) => { if (out.length + s.length > 60) { out += s.slice(0, 60 - out.length); cut = true; } else out += s; };
  const seen = new Set();
  const walk = (v, depth) => {
    if (cut) return;
    if (v === null) return add('null');
    const type = typeof v;
    if (type === 'string') {
      add('"');
      for (const ch of v) { if (cut) break; add(JSON.stringify(ch).slice(1, -1)); }
      add('"'); return;
    }
    if (type === 'number') return add(Object.is(v, -0) ? '-0' : `${v}`);
    if (type === 'bigint') return add(`${v}n`);
    if (type === 'symbol') return add(`Symbol(${Object.getOwnPropertyDescriptor(Symbol.prototype, 'description').get.call(v) ?? ''})`);
    if (type !== 'object') return add(type === 'function' ? 'function' : `${v}`);
    if (seen.has(v)) return add('[Circular]');
    if (depth >= 3) return add('…');
    const proto = Object.getPrototypeOf(v);
    if (proto === Map.prototype) return add(`Map(${Object.getOwnPropertyDescriptor(Map.prototype, 'size').get.call(v)})`);
    if (proto === Set.prototype) return add(`Set(${Object.getOwnPropertyDescriptor(Set.prototype, 'size').get.call(v)})`);
    if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) {
      const ctor = Object.getOwnPropertyDescriptor(proto, 'constructor');
      const name = ctor && 'value' in ctor && typeof ctor.value === 'function' && Object.getOwnPropertyDescriptor(ctor.value, 'name');
      return add(name && typeof name.value === 'string' ? name.value : 'object');
    }
    seen.add(v);
    if (Array.isArray(v)) {
      add('['); const length = Object.getOwnPropertyDescriptor(v, 'length').value;
      for (let i = 0; i < length && !cut; i++) { if (i) add(','); const d = Object.getOwnPropertyDescriptor(v, String(i)); if (d && d.enumerable) 'value' in d ? walk(d.value, depth + 1) : add('"[getter]"'); }
      add(']');
    } else {
      add('{'); let first = true;
      for (const key of Object.keys(v)) { if (cut) break; const d = Object.getOwnPropertyDescriptor(v, key); if (!d || !d.enumerable) continue; if (!first) add(','); first = false; walk(key, depth + 1); add(':'); 'value' in d ? walk(d.value, depth + 1) : add('"[getter]"'); }
      add('}');
    }
    seen.delete(v);
  };
  try { walk(value, 0); } catch { if (!out) out = 'object'; }
  return cut ? out.slice(0, 59) + '…' : out;
}
