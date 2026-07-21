import assert from 'node:assert/strict';
import { test } from 'node:test';

import { makeFilter } from '../src/filters.js';

test('include/exclude globs and methods', () => {
  const f = makeFilter({
    includePaths: ['/api/**'],
    excludePaths: ['/health'],
    methods: ['POST'],
  });
  assert.equal(f({ method: 'POST', path: '/api/abc' }), true);
  assert.equal(f({ method: 'GET', path: '/api/abc' }), false); // method
  assert.equal(f({ method: 'POST', path: '/other' }), false); // not included
  assert.equal(f({ method: 'POST', path: '/health' }), false); // excluded
});

test('no filters passes everything', () => {
  const f = makeFilter();
  assert.equal(f({ method: 'GET', path: '/anything' }), true);
});
