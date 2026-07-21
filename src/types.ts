/** Logger-like target. Structurally compatible with logra's Logger and with console. */
export interface LoggerLike {
  debug?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

/** Normalized record built for each captured request, before projection. */
export interface AnalyticsRecord {
  timestamp: string;
  /** Same instant as `timestamp`, as milliseconds since epoch — for consumers that want a number. */
  timestampMs: number;
  requestId?: string;
  durationMs: number;
  request: {
    method: string;
    url: string;
    path: string;
    /** `path` split on '/' (empty segments dropped): "/qodi/decrypt" -> ["qodi", "decrypt"]. */
    pathSegments: string[];
    query?: Record<string, unknown>;
    headers?: Record<string, unknown>;
    body?: unknown;
    ip?: string;
    bodyBytes?: number;
    bodyTruncated?: boolean;
  };
  response: {
    statusCode: number;
    headers?: Record<string, unknown>;
    body?: unknown;
    bodyBytes?: number;
    bodyTruncated?: boolean;
  };
  meta?: Record<string, unknown>;
}

/**
 * Sinks receive the PROJECTED payload (arbitrary shape). The full (redacted)
 * record is also passed for sinks that need fields the projection may have
 * dropped — e.g. the AMQP sink deriving a routing key from the request path.
 */
export interface AnalyticsSink {
  readonly name: string;
  write(payload: unknown, record?: AnalyticsRecord): void | Promise<void>;
  close?(): Promise<void>;
}

/** Runtime injectables that cannot live in JSON (logger, error handler). */
export interface AnalyticsRuntime {
  logger?: LoggerLike;
  onError?: (error: unknown, sinkName?: string) => void;
}
