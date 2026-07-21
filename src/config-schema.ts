import { z } from 'zod';

export const DEFAULT_REDACT_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-api-key'];
export const DEFAULT_MAX_BODY_BYTES = 16384;

/** Recursive projection map: output key -> dot-path string OR nested map. */
export type FormatFields = { [outputKey: string]: string | FormatFields };
const formatFieldsSchema: z.ZodType<FormatFields> = z.lazy(() =>
  z.record(z.string(), z.union([z.string(), formatFieldsSchema])),
);
/**
 * A format defines how a record is projected. `fields` is the default projection.
 * `byStatus` overrides it per response-status range: keys are exact codes ("404"),
 * class strings ("2xx"/"5xx"), or inclusive ranges ("400-599"); the first matching
 * key's `fields` wins, falling back to the top-level `fields`. Keep ranges
 * non-overlapping so at most one matches.
 */
export const formatSchema = z.object({
  fields: formatFieldsSchema.optional(),
  byStatus: z
    .record(
      z
        .string()
        .regex(/^([1-5]xx|\d{3}|\d{3}-\d{3})$/i, 'status key must be like "2xx", "404", or "400-599"'),
      z.object({ fields: formatFieldsSchema.optional() }),
    )
    .optional(),
});

export type FormatConfig = z.infer<typeof formatSchema>;

export const captureSchema = z
  .object({
    requestHeaders: z.boolean().default(true),
    requestBody: z.boolean().default(true),
    requestQuery: z.boolean().default(true),
    responseHeaders: z.boolean().default(true),
    responseBody: z.boolean().default(false),
    maxRequestBodyBytes: z.number().int().positive().default(DEFAULT_MAX_BODY_BYTES),
    maxResponseBodyBytes: z.number().int().positive().default(DEFAULT_MAX_BODY_BYTES),
  })
  .prefault({});

export const redactSchema = z.object({
  headers: z.array(z.string()).default(DEFAULT_REDACT_HEADERS),
  bodyPaths: z.array(z.string()).default([]),
  mask: z.string().default('[REDACTED]'),
});

export const filtersSchema = z.object({
  includePaths: z.array(z.string()).optional(),
  excludePaths: z.array(z.string()).optional(),
  methods: z.array(z.string()).optional(),
});

const logSinkSchema = z.object({
  type: z.literal('log'),
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  message: z.string().default('request analytics'),
  format: formatSchema.optional(),
});
const fileSinkSchema = z.object({
  type: z.literal('file'),
  path: z.string(),
  format: formatSchema.optional(),
});
const tlsSchema = z.object({
  /** Path to a CA certificate (PEM). Required for private/self-signed brokers. */
  caPath: z.string().optional(),
  /** Optional client certificate (mutual TLS). */
  certPath: z.string().optional(),
  keyPath: z.string().optional(),
  passphrase: z.string().optional(),
  /** Verify the broker certificate against the CA. Default true. */
  rejectUnauthorized: z.boolean().default(true),
  /** SNI server name override (when the cert CN/SAN differs from the host). */
  servername: z.string().optional(),
});
const amqpSinkSchema = z.object({
  type: z.literal('amqp'),
  // --- Connection (provide ONE style). Precedence per amqp-cacoon:
  //     connectionUrls > connectionString/url > discrete fields. ---
  /** Friendly alias for connectionString. Use an amqps:// URL when tls is set. */
  url: z.string().optional(),
  connectionString: z.string().optional(),
  /** Cluster node URLs (round-robin). Highest precedence. */
  connectionUrls: z.array(z.string()).optional(),
  /** Discrete fields: 'amqp' | 'amqps'. */
  protocol: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
  vhost: z.string().optional(),
  // --- Publishing ---
  exchange: z.string().default(''),
  routingKey: z.string(),
  publishOptions: z.record(z.string(), z.unknown()).optional(),
  /** Overrides merged over the default amqp-connection-manager options
   *  ({ heartbeatIntervalInSeconds: 5, reconnectTimeInSeconds: 5 }). Advanced
   *  tuning escape hatch; e.g. { heartbeatIntervalInSeconds: 10 }. */
  amqpOpts: z.record(z.string(), z.unknown()).optional(),
  /** TLS socket options (forwarded to amqplib via amqp_opts.connectionOptions).
   *  Use with protocol 'amqps' or an amqps:// URL. */
  tls: tlsSchema.optional(),
  format: formatSchema.optional(),
});
export const sinkSchema = z.discriminatedUnion('type', [
  logSinkSchema,
  fileSinkSchema,
  amqpSinkSchema,
]);

export const reqcastConfigSchema = z.object({
  enabled: z.boolean().default(true),
  sampleRate: z.number().min(0).max(1).default(1),
  capture: captureSchema,
  redact: redactSchema.optional(),
  filters: filtersSchema.optional(),
  format: formatSchema.optional(),
  sinks: z.array(sinkSchema).min(1),
});

export type ReqcastConfig = z.infer<typeof reqcastConfigSchema>;
export type SinkConfig = z.infer<typeof sinkSchema>;
export type CaptureConfig = z.infer<typeof captureSchema>;
export type RedactConfig = z.infer<typeof redactSchema>;
export type FiltersConfig = z.infer<typeof filtersSchema>;
