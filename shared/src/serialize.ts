export interface SerializeOptions {
  maxDepth: number;
  maxKeys: number;
  maxItems: number;
  maxStringLength: number;
  maxTotalChars: number;
}

export const DEFAULT_SERIALIZE_OPTIONS: SerializeOptions = {
  maxDepth: 4,
  maxKeys: 50,
  maxItems: 50,
  maxStringLength: 5000,
  maxTotalChars: 256 * 1024,
};

function isDomNode(v: unknown): boolean {
  return typeof Node !== 'undefined' && v instanceof Node;
}

function isReactElement(v: unknown): boolean {
  return !!v && typeof v === 'object' && (v as { $$typeof?: symbol }).$$typeof === Symbol.for('react.element');
}

export function safeSerialize(value: unknown, opts: Partial<SerializeOptions> = {}): unknown {
  const o = { ...DEFAULT_SERIALIZE_OPTIONS, ...opts };
  const seen = new WeakSet<object>();
  const budget = { used: 0 };

  function walk(v: unknown, depth: number): unknown {
    if (budget.used > o.maxTotalChars) return '[Truncated: budget]';

    if (v === null) return null;
    const t = typeof v;

    if (t === 'string') {
      const s = v as string;
      const out = s.length > o.maxStringLength
        ? `${s.slice(0, o.maxStringLength)}…[+${s.length - o.maxStringLength} chars]`
        : s;
      budget.used += out.length;
      return out;
    }
    if (t === 'number' || t === 'boolean') { budget.used += 8; return v; }
    if (t === 'undefined') return '[undefined]';
    if (t === 'bigint') { budget.used += 16; return `${(v as bigint).toString()}n`; }
    if (t === 'symbol') return `[Symbol: ${String((v as symbol).description ?? '')}]`;
    if (t === 'function') return `[Function: ${(v as { name?: string }).name || 'anonymous'}]`;

    const obj = v as object;

    if (isDomNode(obj)) return `[${(obj as { constructor?: { name?: string } }).constructor?.name ?? 'Node'}]`;
    if (isReactElement(obj)) {
      const type = (obj as { type?: unknown }).type as { name?: string; displayName?: string } | string | undefined;
      const name = typeof type === 'string' ? type : (type?.displayName ?? type?.name ?? 'Component');
      return `[ReactElement: ${name}]`;
    }
    if (obj instanceof Map) return `[Map size=${obj.size}]`;
    if (obj instanceof Set) return `[Set size=${obj.size}]`;
    if (obj instanceof Date) return obj.toISOString();
    if (obj instanceof RegExp) return obj.toString();

    if (seen.has(obj)) return '[Circular]';
    if (depth >= o.maxDepth) return Array.isArray(obj) ? '[Array …]' : '[Object …]';
    seen.add(obj);

    if (Array.isArray(obj)) {
      const out: unknown[] = [];
      const limit = Math.min(obj.length, o.maxItems);
      for (let i = 0; i < limit; i++) {
        out.push(walk(obj[i], depth + 1));
        if (budget.used > o.maxTotalChars) break;
      }
      if (obj.length > o.maxItems) out.push(`[…+${obj.length - o.maxItems} more]`);
      return out;
    }

    const out: Record<string, unknown> = {};
    const keys = Object.keys(obj);
    const limit = Math.min(keys.length, o.maxKeys);
    for (let i = 0; i < limit; i++) {
      const k = keys[i];
      budget.used += k.length;
      out[k] = walk((obj as Record<string, unknown>)[k], depth + 1);
      if (budget.used > o.maxTotalChars) break;
    }
    if (keys.length > o.maxKeys) out['…'] = `[+${keys.length - o.maxKeys} more keys]`;
    return out;
  }

  return walk(value, 0);
}
