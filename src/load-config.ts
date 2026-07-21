import { readFileSync } from 'node:fs';

import { reqcastConfigSchema, ReqcastConfig } from './config-schema.js';

// ${VAR} or ${VAR:-default}. Env names follow POSIX (letter/underscore start).
const ENV_REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

function interpolateString(value: string, missing: Set<string>): string {
  return value.replace(ENV_REF, (_match, name: string, fallback?: string) => {
    const env = process.env[name];
    if (env !== undefined) return env;
    if (fallback !== undefined) return fallback;
    missing.add(name);
    return '';
  });
}

/** Recursively substitutes ${ENV} references in every string value (keys untouched). */
function interpolateEnv(node: unknown, missing: Set<string>): unknown {
  if (typeof node === 'string') return interpolateString(node, missing);
  if (Array.isArray(node)) return node.map((item) => interpolateEnv(item, missing));
  if (node !== null && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = interpolateEnv(value, missing);
    }
    return out;
  }
  return node;
}

/**
 * Resolves path from arg → REQCAST_CONFIG env → ./reqcast.config.json.
 *
 * String values may reference environment variables as `${VAR}` or
 * `${VAR:-default}` — resolved at load time so secrets stay out of the file.
 * A reference to an unset variable with no default fails fast. Throws on
 * unresolved references or an invalid config.
 */
export function loadConfig(path?: string): ReqcastConfig {
  const resolved = path ?? process.env.REQCAST_CONFIG ?? './reqcast.config.json';
  const raw: unknown = JSON.parse(readFileSync(resolved, 'utf8'));

  const missing = new Set<string>();
  const interpolated = interpolateEnv(raw, missing);
  if (missing.size > 0) {
    throw new Error(
      `reqcast config (${resolved}) references unset environment variables: ${[...missing].join(', ')}`,
    );
  }

  const result = reqcastConfigSchema.safeParse(interpolated);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid reqcast config (${resolved}):\n${issues}`);
  }
  return result.data;
}
