import { existsSync, readFileSync } from 'node:fs';

import { parse as parseYaml } from 'yaml';

import { reqcastConfigSchema, ReqcastConfig } from './config-schema.js';

/** Default config filenames, tried in order. JSON stays first for backwards compatibility. */
const DEFAULT_CONFIG_PATHS = [
  './reqcast.config.json',
  './reqcast.config.yaml',
  './reqcast.config.yml',
] as const;

/**
 * Parses config text as YAML or JSON, chosen by extension.
 *
 * Every JSON document is valid YAML, so a single parser would technically do - but keeping JSON
 * on JSON.parse means an existing deployment's error messages do not change, and a malformed
 * JSON file is not reported as a YAML problem.
 */
function parseConfigText(text: string, path: string): unknown {
  if (/\.ya?ml$/i.test(path)) {
    // parse() handles data only; it evaluates nothing and rejects unknown tags.
    return parseYaml(text);
  }
  return JSON.parse(text);
}

/** First existing default path, or the JSON default so a missing-file error names something. */
function resolveDefaultPath(): string {
  return DEFAULT_CONFIG_PATHS.find((candidate) => existsSync(candidate)) ?? DEFAULT_CONFIG_PATHS[0];
}

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
 * Resolves path from arg → REQCAST_CONFIG env → the first existing default
 * (`./reqcast.config.json`, then `./reqcast.config.yaml`, then `./reqcast.config.yml`).
 *
 * YAML and JSON are both accepted, chosen by file extension, so a deployment can keep its
 * analytics config in the same format as the rest of its configuration. Everything after the
 * parse is identical for both.
 *
 * String values may reference environment variables as `${VAR}` or
 * `${VAR:-default}` — resolved at load time so secrets stay out of the file.
 * A reference to an unset variable with no default fails fast. Throws on
 * unresolved references or an invalid config.
 */
export function loadConfig(path?: string): ReqcastConfig {
  const resolved = path ?? process.env.REQCAST_CONFIG ?? resolveDefaultPath();

  let raw: unknown;
  try {
    raw = parseConfigText(readFileSync(resolved, 'utf8'), resolved);
  } catch (error) {
    // Say which file and that both formats are accepted: a YAML file read as JSON (or the
    // reverse) otherwise fails with a parser message that does not mention the config at all.
    throw new Error(
      `Could not read reqcast config (${resolved}): ${(error as Error).message}`,
    );
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    // An empty YAML file parses to null, which would otherwise reach zod as a confusing
    // "expected object, received null" with no hint about the file being blank.
    throw new Error(
      `Invalid reqcast config (${resolved}): expected a top-level mapping of settings`,
    );
  }

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
