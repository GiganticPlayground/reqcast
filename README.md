# reqcast

Config-driven Express request/response analytics middleware with pluggable sinks (**log**, **file**, **AMQP**).

`reqcast` captures each request/response as a normalized `AnalyticsRecord`, redacts sensitive fields, reshapes it per-sink via a declarative dot-path projection, and fans the result out to one or more sinks — fire-and-forget and error-isolated, so analytics never break the request path.

Everything about _what_ is captured, _how_ it is shaped, and _where_ it is sent lives in a single declarative config per project — **`reqcast.config.json`** or **`reqcast.config.yaml`** — validated at startup by a Zod schema (fail-fast).

## Install

```bash
npm install reqcast
```

`amqp-cacoon` (GP's AMQP client) ships as a regular dependency, so the `amqp`
sink works out of the box — any service can enable it purely through
`reqcast.config.json` with no extra install. It is still imported lazily at
runtime, so `log`/`file`-only deployments never load `amqplib` into memory.

## Quick start

```ts
import express from 'express';
import { createAnalytics, loadConfig } from 'reqcast';

const app = express();
app.use(express.json());

const analytics = createAnalytics(loadConfig(), {
  logger: console, // any { debug?, info?, warn?, error? }
  onError: (err, sinkName) => console.error('analytics sink error', sinkName, err),
});

if (analytics.enabled) {
  app.use(analytics.middleware);
}

app.post('/api/echo', (req, res) => res.json({ ok: true }));

const server = app.listen(3000);

// Graceful shutdown — flush/close sinks (e.g. drain the file stream, close AMQP).
process.on('SIGTERM', async () => {
  server.close();
  await analytics.close();
  process.exit(0);
});
```

`loadConfig(path?)` resolves its config file from the `path` argument → the `REQCAST_CONFIG` env var → the first existing default (`./reqcast.config.json`, then `./reqcast.config.yaml`, then `./reqcast.config.yml`), and throws a descriptive error if the file is invalid.

**YAML or JSON**, chosen by file extension (`.yaml`/`.yml` → YAML, anything else → JSON), so analytics config can match the format the rest of a deployment uses. Everything after the parse — `${VAR}` interpolation, schema validation, error messages — is identical for both.

```yaml
# reqcast.config.yaml
enabled: true
sampleRate: 1
filters:
  includePaths: ['/auth/**']
  excludePaths: ['/health']
sinks:
  - type: amqp
    url: ${ANALYTICS_AMQP_URL}
    exchange: analytics
    routingKey: api.{path}
```

JSON keeps `JSON.parse`, so an existing deployment's parse errors are unchanged, and a malformed JSON file is never reported as a YAML problem. When both defaults exist, JSON wins — an existing project sees no change in behavior.

### Environment variables in config

Any string value may reference an environment variable, resolved at load time so secrets never live in the file:

```json
{
  "sinks": [
    { "type": "amqp", "url": "${ANALYTICS_AMQP_URL}", "routingKey": "api.request" }
  ]
}
```

- `${VAR}` — replaced with the value of `VAR`. References can be embedded in a larger string (e.g. `"amqp://user:${AMQP_PASSWORD}@broker"`).
- `${VAR:-default}` — uses `default` when `VAR` is unset.
- A `${VAR}` with no default and an **unset** variable fails fast at `loadConfig` — a missing secret never silently becomes an empty string.

## Configuration (`reqcast.config.json` / `.yaml`)

```json
{
  "enabled": true,
  "sampleRate": 1,
  "capture": {
    "requestHeaders": true,
    "requestBody": true,
    "requestQuery": true,
    "responseHeaders": true,
    "responseBody": false,
    "maxRequestBodyBytes": 16384,
    "maxResponseBodyBytes": 16384
  },
  "redact": {
    "headers": ["authorization", "cookie", "set-cookie", "x-api-key"],
    "bodyPaths": ["user.password"],
    "mask": "[REDACTED]"
  },
  "filters": {
    "includePaths": ["/api/**"],
    "excludePaths": ["/health"],
    "methods": ["POST", "PUT", "DELETE"]
  },
  "format": {
    "fields": {
      "ts": "timestamp",
      "id": "requestId",
      "durationMs": "durationMs",
      "request": { "method": "request.method", "path": "request.path" },
      "response": { "status": "response.statusCode" }
    }
  },
  "sinks": [
    { "type": "log", "level": "info" },
    { "type": "file", "path": "./logs/analytics.jsonl" },
    {
      "type": "amqp",
      "url": "amqps://guest:guest@rabbit.example.com:5671",
      "exchange": "analytics",
      "routingKey": "api.request",
      "tls": { "caPath": "./config/certs/rabbit-ca.pem", "rejectUnauthorized": true },
      "format": { "fields": { "event": "=request.completed", "data": "." } }
    }
  ]
}
```

### Top level

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | When `false`, `createAnalytics` returns a passthrough handle (`enabled: false`) and captures nothing. |
| `sampleRate` | `1` | Fraction of requests to capture (`0`–`1`). `1` captures all. |
| `capture` | see below | What is gathered (has runtime cost). |
| `redact` | defaults below | Header/body masking. |
| `filters` | none | Which requests are captured. |
| `format` | none | Default projection for all sinks (per-sink `format` overrides it). |
| `sinks` | _required_ | One or more sink definitions (at least one). |

### Capture vs format

**Capture** controls what is _gathered_ from each request/response (headers, body, query) and carries the runtime cost. **Format** controls how the gathered record is _shaped_ for each sink. They are intentionally separate — capture once, project differently per sink.

The response **body** is opt-in (`responseBody: true`) and byte-capped (`maxResponseBodyBytes`); metadata (status, headers) is always available. Bodies over the cap are truncated (`response.bodyTruncated: true`).

### Per-status formats (`byStatus`)

A `format` can project a different shape per response-status range via `byStatus`. Keys are exact codes (`"404"`), class strings (`"2xx"`/`"5xx"`), or inclusive ranges (`"400-599"`); the first matching key's `fields` wins, falling back to the top-level `fields`. This lets you, for example, include `response.body` on errors but keep success records lean:

```json
"format": {
  "fields": { "ts": "timestamp", "status": "response.statusCode" },
  "byStatus": {
    "2xx": { "fields": { "ts": "timestamp", "status": "response.statusCode", "ms": "durationMs" } },
    "400-599": { "fields": { "ts": "timestamp", "status": "response.statusCode", "error": "response.body" } }
  }
}
```

Keep ranges non-overlapping so at most one matches. To project `response.body` on errors, capture must still gather it (`capture.responseBody: true`). `byStatus` works at the top level and per sink.

### Redaction

Applied to the record before projection. Header names are matched case-insensitively.

| Field | Default |
| --- | --- |
| `headers` | `["authorization", "cookie", "set-cookie", "x-api-key"]` |
| `bodyPaths` | `[]` (dot-paths into request/response bodies, e.g. `user.password`) |
| `mask` | `"[REDACTED]"` |

Redaction clones bodies, so the original request/response objects are never mutated.

### Filters

- `includePaths` / `excludePaths` — glob patterns. `**` matches across path segments (including `/`); `*` matches within a segment. A request passes when it is not excluded and (if `includePaths` is set) matches an include.
- `methods` — allowed HTTP methods (case-insensitive).

## Projection semantics (`format.fields`)

Each key in a `fields` map is an **output key**; its value is either:

- a **string source spec** resolved against the (redacted) `AnalyticsRecord`:
  - a **dot-path** — e.g. `"response.statusCode"`;
  - `"."` — the **whole record**;
  - a leading `=` — a **literal** string, e.g. `"=request.completed"` → `"request.completed"`;
- a **nested object** — recursively projected into a nested output object.

Missing paths resolve to `undefined`. A per-sink `format` **overrides** the top-level `format`. If neither is present, the sink receives the whole redacted record.

The `AnalyticsRecord` available to projection has this shape:

```
timestamp, timestampMs, requestId, durationMs,
request:  { method, url, path, pathSegments, query, headers, body, ip, bodyBytes, bodyTruncated },
response: { statusCode, headers, body, bodyBytes, bodyTruncated }
```

`timestamp` is ISO-8601; `timestampMs` is the same instant as milliseconds since epoch.
`pathSegments` is `path` split on `/` with empty segments dropped (`"/qodi/decrypt"` → `["qodi", "decrypt"]`).

## Sinks

All sinks accept an optional per-sink `format` (see above).

### `log`

| Field | Default | Meaning |
| --- | --- | --- |
| `level` | `"info"` | `debug` \| `info` \| `warn` \| `error` |
| `message` | `"request analytics"` | Log message; the payload is passed as the second arg. |

Uses the injected `runtime.logger` (falls back to `console`).

### `file`

| Field | Meaning |
| --- | --- |
| `path` | Append-only JSONL file (one projected payload per line). |

Rotation is out of scope — delegate to `logrotate` or a downstream collector.

### `amqp`

Publishes each projected payload (JSON `Buffer`) via GP's `amqp-cacoon`. Provide **one** connection style — precedence follows amqp-cacoon: `connectionUrls` > `connectionString`/`url` > discrete fields.

| Field | Meaning |
| --- | --- |
| `url` / `connectionString` | Single connection URL (use `amqps://` for TLS). |
| `connectionUrls` | Cluster node URLs (round-robin, highest precedence). |
| `protocol` / `username` / `password` / `host` / `port` / `vhost` | Discrete connection fields. |
| `exchange` | Target exchange (default `""`). |
| `routingKey` | _Required._ Static, or a template — see below. |
| `publishOptions` | Passed through to `publish()`. |
| `amqpOpts` | Overrides merged over the default connection options (see below). |
| `tls` | TLS socket options (see below). |

`amqpOpts` is merged over the defaults `{ heartbeatIntervalInSeconds: 5, reconnectTimeInSeconds: 5 }` and passed straight to `amqp-connection-manager` — an escape hatch for advanced tuning without a code change:

```json
{ "type": "amqp", "url": "amqp://localhost", "routingKey": "api.request",
  "amqpOpts": { "heartbeatIntervalInSeconds": 10, "reconnectTimeInSeconds": 2 } }
```

#### Dynamic routing keys

`routingKey` may be a template with `{...}` placeholders resolved per request from the record. `{path}`, `{method}`, and `{status}` are aliases; any other `{dot.path}` (e.g. `{request.ip}`) resolves against the record too. Each substituted value is sanitized to a single routing-key token — leading/trailing slashes stripped, other unsafe characters collapsed to `_`:

```json
{ "type": "amqp", "exchange": "analytics", "routingKey": "analytics.{path}" }
```

A request to `/qodi/decode` publishes with routing key `analytics.qodi_decode`. Missing fields resolve to an empty string. A `routingKey` with no `{` is used verbatim (static). You control the literal `.` topic levels in the template; `{path}` itself is always one token.

TLS-derived `connectionOptions` (from the `tls` block) merge on top of any `amqpOpts.connectionOptions`, so TLS fields win.

**Keep credentials out of the file.** Reference them as environment variables — e.g. `"url": "${ANALYTICS_AMQP_URL}"` or `"password": "${AMQP_PASSWORD}"` — which are interpolated at load time (see [Environment variables in config](#environment-variables-in-config)).

#### AMQPS / TLS

Use an `amqps://` URL (or `protocol: "amqps"`) plus a `tls` block:

| Field | Meaning |
| --- | --- |
| `caPath` | CA certificate (PEM). Required for private/self-signed brokers. |
| `certPath` / `keyPath` / `passphrase` | Client cert for mutual TLS. |
| `rejectUnauthorized` | Verify the broker cert (default `true`; keep `true` outside local testing). |
| `servername` | SNI override when the cert CN/SAN differs from the host. |

Cert files are read from disk lazily when the sink first connects, so a missing CA path surfaces via `onError` at connect time, not at config load.

## Graceful shutdown

Call `await handle.close()` on shutdown to flush and close sinks (drain the file write stream, close the AMQP connection). See the quick start above.

## License

MIT
