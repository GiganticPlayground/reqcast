import { DEFAULT_REDACT_HEADERS, RedactConfig } from './config-schema.js';
import { AnalyticsRecord } from './types.js';

function redactHeaders(
  headers: Record<string, unknown> | undefined,
  names: string[],
  mask: string,
): Record<string, unknown> | undefined {
  if (!headers) return headers;
  const lower = new Set(names.map((n) => n.toLowerCase()));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = lower.has(key.toLowerCase()) ? mask : value;
  }
  return out;
}

function redactPath(body: unknown, path: string, mask: string): void {
  if (body === null || typeof body !== 'object') return;
  const parts = path.split('.');
  let node: unknown = body;
  for (let i = 0; i < parts.length - 1; i++) {
    if (node === null || typeof node !== 'object') return;
    node = (node as Record<string, unknown>)[parts[i]];
  }
  if (node && typeof node === 'object') {
    const leaf = parts[parts.length - 1];
    if (leaf in (node as Record<string, unknown>)) {
      (node as Record<string, unknown>)[leaf] = mask;
    }
  }
}

export function applyRedaction(record: AnalyticsRecord, redact?: RedactConfig): AnalyticsRecord {
  const headerNames = redact?.headers ?? DEFAULT_REDACT_HEADERS;
  const bodyPaths = redact?.bodyPaths ?? [];
  const mask = redact?.mask ?? '[REDACTED]';

  const clone = (b: unknown): unknown => (b && typeof b === 'object' ? structuredClone(b) : b);
  const reqBody = clone(record.request.body);
  const resBody = clone(record.response.body);
  for (const path of bodyPaths) {
    redactPath(reqBody, path, mask);
    redactPath(resBody, path, mask);
  }

  return {
    ...record,
    request: {
      ...record.request,
      headers: redactHeaders(record.request.headers, headerNames, mask),
      body: reqBody,
    },
    response: {
      ...record.response,
      headers: redactHeaders(record.response.headers, headerNames, mask),
      body: resBody,
    },
  };
}
