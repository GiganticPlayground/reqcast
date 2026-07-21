import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compileRoutingKey } from '../src/sinks/amqp-sink.js';
import type { AnalyticsRecord } from '../src/types.js';

function record(overrides: Partial<AnalyticsRecord['request']> = {}): AnalyticsRecord {
  return {
    timestamp: 't',
    durationMs: 1,
    request: { method: 'GET', url: '/qodi/decode', path: '/qodi/decode', ...overrides },
    response: { statusCode: 200 },
  };
}

test('static routing key (no placeholder) passes through unchanged', () => {
  const resolve = compileRoutingKey('analytics.request');
  assert.equal(resolve(record()), 'analytics.request');
});

test('{path} is sanitized: slashes trimmed and inner slashes -> underscore', () => {
  const resolve = compileRoutingKey('analytics.{path}');
  assert.equal(resolve(record()), 'analytics.qodi_decode');
});

test('supports {method} and {status} aliases and arbitrary dot-paths', () => {
  const resolve = compileRoutingKey('a.{method}.{status}.{request.ip}');
  const rec = record({ ip: '10.0.0.1' });
  rec.response.statusCode = 404;
  assert.equal(resolve(rec), 'a.GET.404.10_0_0_1');
});

test('missing fields resolve to empty string', () => {
  const resolve = compileRoutingKey('a.{request.nope}');
  assert.equal(resolve(record()), 'a.');
});

test('no record -> placeholders resolve empty', () => {
  const resolve = compileRoutingKey('a.{path}');
  assert.equal(resolve(undefined), 'a.');
});
