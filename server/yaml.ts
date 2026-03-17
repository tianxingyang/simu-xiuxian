/** Lightweight YAML serializer for plain data (scalars, arrays, shallow objects). */

export type Val = string | number | boolean | null | undefined | Val[] | { [k: string]: Val };

function needsQuote(s: string): boolean {
  return s === '' || /[:#{}[\],&*?|>!%@`'"\n]/.test(s) || /^\s|\s$/.test(s);
}

function escapeStr(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function lines(arr: string[], depth: number, prefix: string, val: Val): void {
  const pad = '  '.repeat(depth);

  if (val === null || val === undefined) {
    arr.push(`${pad}${prefix}null`);
    return;
  }
  if (typeof val === 'boolean' || typeof val === 'number') {
    arr.push(`${pad}${prefix}${val}`);
    return;
  }
  if (typeof val === 'string') {
    arr.push(`${pad}${prefix}${needsQuote(val) ? escapeStr(val) : val}`);
    return;
  }

  if (Array.isArray(val)) {
    if (val.length === 0) {
      arr.push(`${pad}${prefix}[]`);
      return;
    }
    // key on its own line, then items
    if (prefix) arr.push(`${pad}${prefix.slice(0, -1)}`); // remove trailing space
    for (const item of val) {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        const entries = Object.entries(item).filter(([, v]) => v !== undefined);
        if (entries.length > 0) {
          // first entry on the "- " line
          const [k0, v0] = entries[0];
          lines(arr, depth + 1, `- ${k0}: `, v0);
          // remaining entries indented under the dash
          for (let i = 1; i < entries.length; i++) {
            const [k, v] = entries[i];
            lines(arr, depth + 2, `${k}: `, v);
          }
          continue;
        }
      }
      lines(arr, depth + 1, '- ', item);
    }
    return;
  }

  // object
  const entries = Object.entries(val).filter(([, v]) => v !== undefined);
  if (entries.length === 0) {
    arr.push(`${pad}${prefix}{}`);
    return;
  }
  if (prefix) arr.push(`${pad}${prefix.slice(0, -1)}`);
  for (const [k, v] of entries) {
    lines(arr, depth + 1, `${k}: `, v);
  }
}

export function toYaml(data: Record<string, Val>): string {
  const result: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    lines(result, 0, `${k}: `, v);
  }
  return result.join('\n');
}
