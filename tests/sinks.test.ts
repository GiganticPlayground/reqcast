import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { AmqpSink, resolveAmqpCacoonCtor } from '../src/sinks/amqp-sink.js';
import { FileSink } from '../src/sinks/file-sink.js';
import { LogSink } from '../src/sinks/log-sink.js';

test('FileSink writes JSONL and round-trips', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reqcast-'));
  const file = join(dir, 'analytics.jsonl');
  const sink = new FileSink({ path: file });
  sink.write({ a: 1 });
  sink.write({ b: 2 });
  await sink.close();

  const lines = readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]), { a: 1 });
  assert.deepEqual(JSON.parse(lines[1]), { b: 2 });
  rmSync(dir, { recursive: true, force: true });
});

test('LogSink calls the injected logger at the configured level', () => {
  const calls: Array<{ msg: unknown; payload: unknown }> = [];
  const sink = new LogSink({
    logger: { warn: (msg: unknown, payload: unknown) => calls.push({ msg, payload }) },
    level: 'warn',
    message: 'hi',
  });
  sink.write({ ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].msg, 'hi');
  assert.deepEqual(calls[0].payload, { ok: true });
});

test('AmqpSink constructs without throwing (no broker connection)', () => {
  assert.doesNotThrow(() => {
    new AmqpSink({ url: 'amqp://guest:guest@localhost:5672', routingKey: 'test.key' });
  });
});

// amqp-cacoon (CJS) surfaces differently depending on the consumer's module system. The
// double-wrapped shape is what a native-ESM consumer (e.g. qodi) actually sees — resolving it
// wrong made every AMQP publish fail, so each interop shape is pinned here.
test('resolveAmqpCacoonCtor handles every amqp-cacoon interop shape', () => {
  class Fake {}
  // CJS require / function at the top level
  assert.equal(resolveAmqpCacoonCtor(Fake), Fake);
  // Standard interop: { default: ctor }
  assert.equal(resolveAmqpCacoonCtor({ default: Fake }), Fake);
  // Native-ESM import of a CJS module whose export is itself { default: ctor }
  assert.equal(resolveAmqpCacoonCtor({ default: { default: Fake } }), Fake);
  // No constructor anywhere -> loud failure, not a broken sink
  assert.throws(() => resolveAmqpCacoonCtor({ default: { notIt: 1 } }), /could not resolve/);
});
