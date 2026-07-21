import { FormatConfig, FormatFields } from './config-schema.js';
import { makeStatusMatch } from './status.js';

function resolvePath(record: unknown, path: string): unknown {
  if (path === '.') return record;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, record);
}

/**
 * Projects `record` into an output object per the `fields` map.
 * - string value: dot-path into record; "." = whole record; leading "=" = literal string.
 * - object value: recurse into a nested output object.
 */
export function project(record: unknown, fields: FormatFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(fields)) {
    if (typeof spec === 'string') {
      out[key] = spec.startsWith('=') ? spec.slice(1) : resolvePath(record, spec);
    } else {
      out[key] = project(record, spec);
    }
  }
  return out;
}

/** Applies a format when present; otherwise returns the record unchanged. */
export function applyFormat(record: unknown, fields?: FormatFields): unknown {
  return fields ? project(record, fields) : record;
}

/**
 * Precompiles a format into a resolver that picks the projection fields for a
 * given response status: the first matching `byStatus` range wins, else the
 * default `fields`. `byStatus` matchers are built once, not per request.
 */
export function compileFormat(
  format?: FormatConfig,
): (statusCode: number) => FormatFields | undefined {
  const defaultFields = format?.fields;
  const variants = format?.byStatus
    ? Object.entries(format.byStatus).map(([range, variant]) => ({
        match: makeStatusMatch([range]),
        fields: variant.fields,
      }))
    : [];

  if (variants.length === 0) return () => defaultFields;

  return (statusCode) => {
    for (const variant of variants) {
      if (variant.match(statusCode)) return variant.fields ?? defaultFields;
    }
    return defaultFields;
  };
}
