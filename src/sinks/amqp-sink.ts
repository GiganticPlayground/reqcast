import { readFileSync } from 'node:fs';

import { resolvePath } from '../project.js';
import { AnalyticsRecord, AnalyticsSink, LoggerLike } from '../types.js';

const ROUTING_PLACEHOLDER = /\{([^}]+)\}/g;
const ROUTING_ALIASES: Record<string, string> = {
  path: 'request.path',
  method: 'request.method',
  status: 'response.statusCode',
};

/** Makes a value safe for one routing-key token: trims slashes, replaces any
 *  run of non-[A-Za-z0-9_-] characters with a single underscore. */
function sanitizeToken(value: unknown): string {
  return String(value)
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_');
}

/**
 * Compiles a routing-key template into a per-record resolver. `{path}`,
 * `{method}`, `{status}` (or any `{dot.path}`) are resolved against the record
 * and sanitized; e.g. "analytics.{path}" + path "/qodi/decode" -> "analytics.qodi_decode".
 * A template with no placeholder is returned as-is (static).
 */
export function compileRoutingKey(
  template: string,
): (record?: AnalyticsRecord) => string {
  if (!template.includes('{')) return () => template;
  return (record) =>
    template.replace(ROUTING_PLACEHOLDER, (_match, expr: string) => {
      const path = ROUTING_ALIASES[expr] ?? expr;
      const value = record ? resolvePath(record, path) : undefined;
      return value === undefined || value === null ? '' : sanitizeToken(value);
    });
}

export interface AmqpTlsOptions {
  caPath?: string;
  certPath?: string;
  keyPath?: string;
  passphrase?: string;
  rejectUnauthorized?: boolean;
  servername?: string;
}

export interface AmqpSinkOptions {
  // Connection (one style; precedence: connectionUrls > connectionString > discrete fields).
  connectionString?: string;
  connectionUrls?: string[];
  protocol?: string;
  username?: string;
  password?: string;
  host?: string;
  port?: number;
  vhost?: string;
  // Publishing.
  exchange?: string;
  routingKey: string;
  publishOptions?: Record<string, unknown>;
  amqpOpts?: Record<string, unknown>;
  /** TLS socket options; CA/cert/key are read from disk lazily at connect time. */
  tls?: AmqpTlsOptions;
  logger?: LoggerLike;
}

/** Builds amqplib socket (TLS) options from file paths. Returns undefined when no TLS configured. */
function buildConnectionOptions(tls?: AmqpTlsOptions): Record<string, unknown> | undefined {
  if (!tls) return undefined;
  const opts: Record<string, unknown> = {
    rejectUnauthorized: tls.rejectUnauthorized ?? true,
  };
  if (tls.caPath) opts.ca = [readFileSync(tls.caPath)];
  if (tls.certPath) opts.cert = readFileSync(tls.certPath);
  if (tls.keyPath) opts.key = readFileSync(tls.keyPath);
  if (tls.passphrase) opts.passphrase = tls.passphrase;
  if (tls.servername) opts.servername = tls.servername;
  return opts;
}

interface AmqpCacoonLike {
  getPublishChannel(): Promise<unknown>;
  publish(exchange: string, routingKey: string, msg: Buffer, options?: unknown): Promise<void>;
  close(): Promise<void>;
}

/**
 * Resolves the AmqpCacoon constructor from a dynamically imported `amqp-cacoon` module.
 *
 * amqp-cacoon is CommonJS. Depending on how the consumer is compiled (CJS vs native ESM) and
 * Node's interop, the constructor arrives as the module itself, as `default`, OR — when a native
 * ESM consumer imports a CJS module whose own export is already `{ default }` — double-wrapped as
 * `default.default`. Resolve to whichever level is actually callable rather than assuming
 * `default` is the constructor (which breaks under ESM interop and made every publish fail).
 */
export function resolveAmqpCacoonCtor(mod: unknown): new (opts: unknown) => AmqpCacoonLike {
  const unwrap = (m: unknown): unknown =>
    typeof m === 'function' ? m : (m as { default?: unknown } | undefined)?.default;
  const ctor = [mod, unwrap(mod), unwrap(unwrap(mod))].find(
    (candidate) => typeof candidate === 'function',
  );
  if (typeof ctor !== 'function') {
    throw new Error('amqp-cacoon: could not resolve the AmqpCacoon constructor from the imported module');
  }
  return ctor as new (opts: unknown) => AmqpCacoonLike;
}

export class AmqpSink implements AnalyticsSink {
  readonly name = 'amqp';
  private readonly exchange: string;
  private readonly resolveRoutingKey: (record?: AnalyticsRecord) => string;
  private readonly publishOptions?: Record<string, unknown>;
  private cacoon?: AmqpCacoonLike;
  private ready?: Promise<AmqpCacoonLike>;

  constructor(private readonly options: AmqpSinkOptions) {
    this.exchange = options.exchange ?? '';
    this.resolveRoutingKey = compileRoutingKey(options.routingKey);
    this.publishOptions = options.publishOptions;
  }

  private init(): Promise<AmqpCacoonLike> {
    this.ready ??= (async () => {
      const AmqpCacoon = resolveAmqpCacoonCtor(await import('amqp-cacoon'));
      const connectionOptions = buildConnectionOptions(this.options.tls);
      const amqp_opts: Record<string, unknown> = {
        heartbeatIntervalInSeconds: 5,
        reconnectTimeInSeconds: 5,
        ...this.options.amqpOpts,
      };
      // connectionOptions is forwarded by amqp-cacoon -> amqp-connection-manager -> amqplib.connect
      // as the TLS socket options (requires an amqps:// URL). Merge over any
      // connectionOptions the caller passed via amqpOpts; TLS fields win.
      if (connectionOptions) {
        amqp_opts.connectionOptions = {
          ...(amqp_opts.connectionOptions as Record<string, unknown> | undefined),
          ...connectionOptions,
        };
      }
      const cacoon = new AmqpCacoon({
        protocol: this.options.protocol,
        username: this.options.username,
        password: this.options.password,
        host: this.options.host,
        port: this.options.port,
        vhost: this.options.vhost,
        connectionString: this.options.connectionString,
        connectionUrls: this.options.connectionUrls,
        amqp_opts,
        providers: { logger: this.options.logger },
      });
      await cacoon.getPublishChannel();
      this.cacoon = cacoon;
      return cacoon;
    })().catch((err) => {
      // Don't cache a rejected connect — let the next write retry instead of
      // permanently wedging the sink on a transient startup failure.
      this.ready = undefined;
      throw err;
    });
    return this.ready;
  }

  async write(payload: unknown, record?: AnalyticsRecord): Promise<void> {
    const cacoon = this.cacoon ?? (await this.init());
    await cacoon.publish(
      this.exchange,
      this.resolveRoutingKey(record),
      Buffer.from(JSON.stringify(payload)),
      this.publishOptions,
    );
  }

  async close(): Promise<void> {
    if (this.cacoon) await this.cacoon.close();
  }
}
