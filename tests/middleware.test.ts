import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import express from 'express';

import { reqcastConfigSchema } from '../src/config-schema.js';
import { createAnalytics } from '../src/middleware.js';

test('captures, redacts, projects, and dispatches the projected payload', async () => {
  const received: unknown[] = [];

  // Approach (b): a single `log` sink whose injected logger pushes the projected payload.
  const config = reqcastConfigSchema.parse({
    capture: { responseBody: true },
    format: {
      fields: {
        method: 'request.method',
        status: 'response.statusCode',
        auth: 'request.headers.authorization',
      },
    },
    sinks: [{ type: 'log' }],
  });

  const analytics = createAnalytics(config, {
    logger: { info: (_m: unknown, p: unknown) => received.push(p) },
  });

  const app = express();
  app.use(express.json());
  app.use(analytics.middleware);
  app.post('/echo', (req, res) => {
    res.json({ ok: true, got: req.body });
  });
  const server = app.listen(0);
  after(() => server.close());
  const port = (server.address() as { port: number }).port;

  await fetch(`http://127.0.0.1:${port}/echo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
    body: JSON.stringify({ hello: 'world' }),
  }).then((r) => r.json());

  // res.on('finish') fires just after the response is flushed; give it a tick.
  await new Promise((r) => setTimeout(r, 20));
  await analytics.close();

  assert.equal(received.length, 1);
  assert.deepEqual(received[0], { method: 'POST', status: 200, auth: '[REDACTED]' });
});

test('disabled config yields a passthrough handle', () => {
  const config = reqcastConfigSchema.parse({ enabled: false, sinks: [{ type: 'log' }] });
  const analytics = createAnalytics(config);
  assert.equal(analytics.enabled, false);
});
