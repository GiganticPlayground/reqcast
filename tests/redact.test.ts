import assert from 'node:assert/strict';
import { test } from 'node:test';

import { reqcastConfigSchema } from '../src/config-schema.js';
import { applyRedaction } from '../src/redact.js';
import type { AnalyticsRecord } from '../src/types.js';

function makeRecord(): AnalyticsRecord {
  return {
    timestamp: 't',
    durationMs: 1,
    request: {
      method: 'POST',
      url: '/x',
      path: '/x',
      headers: { authorization: 'Bearer secret', 'x-custom': 'keep' },
      body: { user: { password: 'hunter2', name: 'dan' } },
    },
    response: {
      statusCode: 200,
      headers: { 'set-cookie': 'sid=abc', 'content-type': 'application/json' },
    },
  };
}

test('masks default sensitive headers, keeps others', () => {
  const redact = reqcastConfigSchema.parse({ sinks: [{ type: 'log' }] }).redact;
  const out = applyRedaction(makeRecord(), redact);
  assert.equal(out.request.headers?.authorization, '[REDACTED]');
  assert.equal(out.request.headers?.['x-custom'], 'keep');
  assert.equal(out.response.headers?.['set-cookie'], '[REDACTED]');
  assert.equal(out.response.headers?.['content-type'], 'application/json');
});

test('masks body paths without mutating the original record', () => {
  const original = makeRecord();
  const redact = { headers: [], bodyPaths: ['user.password'], mask: '[REDACTED]' };
  const out = applyRedaction(original, redact);
  assert.equal((out.request.body as { user: { password: string } }).user.password, '[REDACTED]');
  // original is untouched
  assert.equal(
    (original.request.body as { user: { password: string } }).user.password,
    'hunter2',
  );
});
