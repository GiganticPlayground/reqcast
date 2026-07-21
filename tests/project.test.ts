import assert from 'node:assert/strict';
import { test } from 'node:test';

import { project } from '../src/project.js';

const rec = {
  timestamp: 't',
  durationMs: 5,
  request: { method: 'POST', path: '/x' },
  response: { statusCode: 201 },
};

test('projects nested objects, paths, literals, and whole-record', () => {
  const out = project(rec, {
    ts: 'timestamp',
    event: '=request.completed',
    request: { method: 'request.method', path: 'request.path' },
    status: 'response.statusCode',
    all: '.',
  });
  assert.deepEqual(out, {
    ts: 't',
    event: 'request.completed',
    request: { method: 'POST', path: '/x' },
    status: 201,
    all: rec,
  });
});

test('missing path resolves to undefined', () => {
  assert.equal(project(rec, { x: 'request.nope.deep' }).x, undefined);
});
