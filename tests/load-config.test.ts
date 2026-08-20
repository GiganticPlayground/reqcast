import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadConfig } from '../src/load-config.js';

function tmpConfig(body: unknown): string {
  const path = join(tmpdir(), `reqcast-cfg-${process.pid}-${process.hrtime.bigint()}.json`);
  writeFileSync(path, JSON.stringify(body));
  return path;
}

/** Writes raw text to a temp file with the given extension, for format-specific cases. */
function tmpFile(text: string, extension: string): string {
  const path = join(tmpdir(), `reqcast-cfg-${process.pid}-${process.hrtime.bigint()}.${extension}`);
  writeFileSync(path, text);
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

// YAML support: a deployment can keep analytics config in the same format as everything else.

test('loads a YAML config', () => {
  const path = tmpFile(
    [
      'enabled: true',
      'sampleRate: 1',
      'filters:',
      "  includePaths: ['/auth/**']",
      'sinks:',
      '  - type: log',
      '    level: warn',
    ].join('\n'),
    'yaml',
  );
  try {
    const config = loadConfig(path);
    assert.equal(config.enabled, true);
    assert.equal(config.sinks[0]?.type, 'log');
    assert.equal(config.sinks[0]?.type === 'log' ? config.sinks[0].level : undefined, 'warn');
    assert.deepEqual(config.filters?.includePaths, ['/auth/**']);
  } finally {
    rmSync(path, { force: true });
  }
});

test('loads a .yml config too', () => {
  const path = tmpFile('sinks:\n  - type: log\n', 'yml');
  try {
    assert.equal(loadConfig(path).sinks[0]?.type, 'log');
  } finally {
    rmSync(path, { force: true });
  }
});

test('interpolates ${ENV} references in a YAML config', () => {
  process.env.REQCAST_TEST_YAML_URL = 'amqp://user:secret@broker:5672';
  const path = tmpFile(
    ['sinks:', '  - type: amqp', "    url: '${REQCAST_TEST_YAML_URL}'", '    routingKey: r'].join('\n'),
    'yaml',
  );
  try {
    const sink = loadConfig(path).sinks[0];
    assert.equal(sink.type === 'amqp' ? sink.url : '', 'amqp://user:secret@broker:5672');
  } finally {
    rmSync(path, { force: true });
    delete process.env.REQCAST_TEST_YAML_URL;
  }
});

test('an unset ${ENV} reference in YAML still fails fast', () => {
  const path = tmpFile("sinks:\n  - type: log\n    message: '${REQCAST_TEST_ABSENT}'\n", 'yaml');
  try {
    assert.throws(() => loadConfig(path), /unset environment variables: REQCAST_TEST_ABSENT/);
  } finally {
    rmSync(path, { force: true });
  }
});

test('YAML and JSON produce the same config', () => {
  const jsonPath = tmpConfig({ enabled: true, sinks: [{ type: 'file', path: '/tmp/x.jsonl' }] });
  const yamlPath = tmpFile(
    ['enabled: true', 'sinks:', '  - type: file', '    path: /tmp/x.jsonl'].join('\n'),
    'yaml',
  );
  try {
    assert.deepEqual(loadConfig(yamlPath), loadConfig(jsonPath));
  } finally {
    rmSync(jsonPath, { force: true });
    rmSync(yamlPath, { force: true });
  }
});

// The parse failure a mismatched extension produces should name the config, not just complain
// about a token somewhere.
test('a malformed config names the file', () => {
  const path = tmpFile('enabled: true\nsinks: [\n', 'json');
  try {
    assert.throws(() => loadConfig(path), /Could not read reqcast config/);
  } finally {
    rmSync(path, { force: true });
  }
});

test('an empty YAML file reports a missing mapping rather than a zod type error', () => {
  const path = tmpFile('\n', 'yaml');
  try {
    assert.throws(() => loadConfig(path), /expected a top-level mapping/);
  } finally {
    rmSync(path, { force: true });
  }
});

// With no path and no REQCAST_CONFIG, the default lookup tries json first (so an existing
// deployment is unaffected) and then the YAML names.
test('falls back to reqcast.config.yaml when no JSON default exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reqcast-default-'));
  const cwd = process.cwd();
  const saved = process.env.REQCAST_CONFIG;
  delete process.env.REQCAST_CONFIG;
  try {
    writeFileSync(join(dir, 'reqcast.config.yaml'), 'sinks:\n  - type: log\n    level: error\n');
    process.chdir(dir);
    const config = loadConfig();
    assert.equal(config.sinks[0]?.type === 'log' ? config.sinks[0].level : undefined, 'error');
  } finally {
    process.chdir(cwd);
    if (saved !== undefined) process.env.REQCAST_CONFIG = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('prefers an existing JSON default over a YAML one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reqcast-default-both-'));
  const cwd = process.cwd();
  const saved = process.env.REQCAST_CONFIG;
  delete process.env.REQCAST_CONFIG;
  try {
    writeFileSync(
      join(dir, 'reqcast.config.json'),
      JSON.stringify({ sinks: [{ type: 'log', message: 'from-json' }] }),
    );
    writeFileSync(join(dir, 'reqcast.config.yaml'), 'sinks:\n  - type: log\n    message: from-yaml\n');
    process.chdir(dir);
    const sink = loadConfig().sinks[0];
    assert.equal(sink.type === 'log' ? sink.message : '', 'from-json');
  } finally {
    process.chdir(cwd);
    if (saved !== undefined) process.env.REQCAST_CONFIG = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
