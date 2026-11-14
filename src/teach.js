// A short representation that does not run input accessors or conversion hooks.
export function show(value) {
  let out = '', cut = false, limit = 60;
  const add = (s) => { if (out.length + s.length > limit) { out += s.slice(0, limit - out.length); cut = true; } else out += s; };
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
    const array = Array.isArray(v);
    const proto = Object.getPrototypeOf(v);
    if (proto === Map.prototype) return add(`Map(${Object.getOwnPropertyDescriptor(Map.prototype, 'size').get.call(v)})`);
    if (proto === Set.prototype) return add(`Set(${Object.getOwnPropertyDescriptor(Set.prototype, 'size').get.call(v)})`);
    if (!array && proto !== Object.prototype && proto !== null) {
      const ctor = Object.getOwnPropertyDescriptor(proto, 'constructor');
      const name = ctor && 'value' in ctor && typeof ctor.value === 'function' && Object.getOwnPropertyDescriptor(ctor.value, 'name');
      return add(name && typeof name.value === 'string' ? name.value : 'object');
    }
    seen.add(v);
    const allKeys = Reflect.ownKeys(v), keys = allKeys.slice(0, 8);
    const descriptors = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(v, key)]));
    if (array) {
      // The length descriptor is among an array's own keys, but may fall beyond the budget.
      const length = v.length;
      const indices = keys.filter(k => typeof k === 'string' && /^(0|[1-9]\d*)$/.test(k)).map(Number);
      const shown = length === undefined ? (indices.length ? Math.max(...indices) + 1 : 0) : Math.min(length, 8);
      const longer = length > shown;
      const suffix = longer ? `] (length ${length})` : ']';
      const previousLimit = limit;
      if (longer) limit = Math.max(out.length + 1, limit - suffix.length - 2);
      add('[');
      for (let i = 0; i < shown && !cut; i++) {
        if (i) add(',');
        const d = descriptors.get(String(i));
        if (!d) add('<empty>'); else if ('value' in d) walk(d.value, depth + 1); else add('"[getter]"');
      }
      if (longer) {
        const truncated = cut; cut = false; limit = previousLimit;
        if (shown && !truncated) add(',');
        add('…' + suffix);
      } else add(']');
    } else {
      add('{'); let first = true;
      for (const key of keys) { if (cut) break; const d = descriptors.get(key); if (typeof key !== 'string' || !d || !d.enumerable) continue; if (!first) add(','); first = false; walk(key, depth + 1); add(':'); 'value' in d ? walk(d.value, depth + 1) : add('"[getter]"'); }
      add(allKeys.length > keys.length ? (first ? '…}' : ',…}') : '}');
    }
    seen.delete(v);
  };
  try { walk(value, 0); } catch { if (!out) out = 'object'; }
  return cut ? out.slice(0, 59) + '…' : out;
}
