import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compileFormat } from '../src/project.js';
import { makeStatusMatch } from '../src/status.js';

test('makeStatusMatch: exact codes, class strings, and ranges', () => {
  const m = makeStatusMatch([404, '5xx', '400-402']);
  assert.equal(m(404), true); // exact
  assert.equal(m(500), true); // 5xx class
  assert.equal(m(599), true); // 5xx class
  assert.equal(m(401), true); // range
  assert.equal(m(200), false);
  assert.equal(m(403), false); // outside 400-402, not 404
  assert.equal(m(499), false);
});

test('compileFormat: byStatus variant wins, else default fields', () => {
  const resolve = compileFormat({
    fields: { status: 'response.statusCode' },
    byStatus: {
      '2xx': { fields: { ok: 'response.statusCode' } },
      '400-599': { fields: { status: 'response.statusCode', error: 'response.body' } },
    },
  });

  assert.deepEqual(resolve(200), { ok: 'response.statusCode' });
  assert.deepEqual(resolve(500), { status: 'response.statusCode', error: 'response.body' });
  // 302 matches no variant -> default fields
  assert.deepEqual(resolve(302), { status: 'response.statusCode' });
});

test('compileFormat: no byStatus -> always default fields', () => {
  const resolve = compileFormat({ fields: { status: 'response.statusCode' } });
  assert.deepEqual(resolve(200), { status: 'response.statusCode' });
  assert.deepEqual(resolve(500), { status: 'response.statusCode' });
});

test('compileFormat: no format -> undefined (whole record passes through)', () => {
  const resolve = compileFormat(undefined);
  assert.equal(resolve(200), undefined);
});

test('compileFormat: variant without its own fields falls back to default', () => {
  const resolve = compileFormat({
    fields: { status: 'response.statusCode' },
    byStatus: { '5xx': {} },
  });
  assert.deepEqual(resolve(503), { status: 'response.statusCode' });
});
