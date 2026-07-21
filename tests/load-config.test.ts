import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadConfig } from '../src/load-config.js';

function tmpConfig(body: unknown): string {
  const path = join(tmpdir(), `reqcast-cfg-${process.pid}-${process.hrtime.bigint()}.json`);
  writeFileSync(path, JSON.stringify(body));
  return path;
}

test('interpolates ${ENV} references in string values', () => {
  process.env.REQCAST_TEST_URL = 'amqp://user:secret@broker:5672';
  const path = tmpConfig({
    sinks: [{ type: 'amqp', url: '${REQCAST_TEST_URL}', routingKey: 'r' }],
  });
  try {
    const sink = loadConfig(path).sinks[0];
    assert.equal(sink.type === 'amqp' ? sink.url : '', 'amqp://user:secret@broker:5672');
  } finally {
    rmSync(path, { force: true });
    delete process.env.REQCAST_TEST_URL;
  }
});

test('interpolates references embedded within a larger string', () => {
  process.env.REQCAST_TEST_PW = 's3cret';
  const path = tmpConfig({
    sinks: [{ type: 'amqp', url: 'amqp://user:${REQCAST_TEST_PW}@broker', routingKey: 'r' }],
  });
  try {
    const sink = loadConfig(path).sinks[0];
    assert.equal(sink.type === 'amqp' ? sink.url : '', 'amqp://user:s3cret@broker');
  } finally {
    rmSync(path, { force: true });
    delete process.env.REQCAST_TEST_PW;
  }
});

test('supports ${VAR:-default} fallback for unset vars', () => {
  const path = tmpConfig({
    sinks: [{ type: 'amqp', url: '${REQCAST_UNSET:-amqp://localhost}', routingKey: 'r' }],
  });
  try {
    const sink = loadConfig(path).sinks[0];
    assert.equal(sink.type === 'amqp' ? sink.url : '', 'amqp://localhost');
  } finally {
    rmSync(path, { force: true });
  }
});

test('throws on an unset reference with no default', () => {
  const path = tmpConfig({
    sinks: [{ type: 'amqp', url: '${REQCAST_DEFINITELY_UNSET}', routingKey: 'r' }],
  });
  try {
    assert.throws(() => loadConfig(path), /REQCAST_DEFINITELY_UNSET/);
  } finally {
    rmSync(path, { force: true });
  }
});
