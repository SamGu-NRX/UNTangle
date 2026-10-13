function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.map(sortDeep);
  }
  if (typeof v === "object" && v !== null) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortDeep((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

export function canonicalJson(v: unknown): string {
  return JSON.stringify(sortDeep(v), null, 2) + "\n";
}

export function round7(n: number): number {
  const r = Number(n.toFixed(7));
  return r === 0 ? 0 : r;
}
