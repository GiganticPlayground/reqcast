import assert from 'node:assert/strict';
import { test } from 'node:test';

import { reqcastConfigSchema } from '../src/config-schema.js';

test('applies defaults', () => {
  const cfg = reqcastConfigSchema.parse({ sinks: [{ type: 'log' }] });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.sampleRate, 1);
  assert.equal(cfg.capture.responseBody, false);
  assert.equal(cfg.sinks[0].type, 'log');
});

test('rejects amqp sink without routingKey', () => {
  assert.throws(() => reqcastConfigSchema.parse({ sinks: [{ type: 'amqp', url: 'amqp://x' }] }));
});

test('amqp sink carries amqpOpts overrides through the schema', () => {
  const cfg = reqcastConfigSchema.parse({
    sinks: [
      {
        type: 'amqp',
        url: 'amqp://x',
        routingKey: 'r',
        amqpOpts: { heartbeatIntervalInSeconds: 10 },
      },
    ],
  });
  const sink = cfg.sinks[0];
  assert.equal(sink.type, 'amqp');
  assert.deepEqual(sink.type === 'amqp' ? sink.amqpOpts : undefined, {
    heartbeatIntervalInSeconds: 10,
  });
});
