import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { captureResponseBody, parseBody } from './capture.js';
import { ReqcastConfig } from './config-schema.js';
import { makeFilter } from './filters.js';
import { AnalyticsManager, SinkTarget } from './manager.js';
import { compileFormat } from './project.js';
import { applyRedaction } from './redact.js';
import { createSink } from './sink-factory.js';
import { AnalyticsRecord, AnalyticsRuntime } from './types.js';

export interface AnalyticsHandle {
  middleware: RequestHandler;
  close: () => Promise<void>;
  enabled: boolean;
}

export function createAnalytics(
  config: ReqcastConfig,
  runtime: AnalyticsRuntime = {},
): AnalyticsHandle {
  const onError = runtime.onError ?? (() => {});

  if (!config.enabled) {
    const passthrough: RequestHandler = (_req, _res, next) => next();
    return { middleware: passthrough, close: async () => {}, enabled: false };
  }

  const targets: SinkTarget[] = config.sinks.map((cfg) => ({
    sink: createSink(cfg, runtime),
    resolveFields: compileFormat(cfg.format ?? config.format),
  }));
  const manager = new AnalyticsManager(targets, onError);
  const passes = makeFilter(config.filters);
  const { capture, sampleRate } = config;

  const middleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    const sampled = sampleRate >= 1 || Math.random() < sampleRate;
    if (!sampled || !passes({ method: req.method, path: req.path })) {
      next();
      return;
    }

    const startedAt = Date.now();
    const getResBody = capture.responseBody
      ? captureResponseBody(res, capture.maxResponseBodyBytes)
      : undefined;

    res.on('finish', () => {
      try {
        const captured = getResBody?.();
        const resContentType = res.getHeader('content-type');
        let record: AnalyticsRecord = {
          timestamp: new Date().toISOString(),
          requestId: req.header('x-request-id') ?? undefined,
          durationMs: Date.now() - startedAt,
          request: {
            method: req.method,
            url: req.originalUrl,
            path: req.path,
            query: capture.requestQuery ? req.query : undefined,
            headers: capture.requestHeaders ? req.headers : undefined,
            body: capture.requestBody ? (req.body as unknown) : undefined,
            ip: req.ip,
          },
          response: {
            statusCode: res.statusCode,
            headers: capture.responseHeaders ? res.getHeaders() : undefined,
            body: captured
              ? parseBody(
                  captured.buffer,
                  typeof resContentType === 'string' ? resContentType : undefined,
                )
              : undefined,
            bodyBytes: captured?.bytes,
            bodyTruncated: captured?.truncated,
          },
        };

        record = applyRedaction(record, config.redact);
        manager.dispatch(record);
      } catch (err) {
        onError(err);
      }
    });

    next();
  };

  return { middleware, close: () => manager.close(), enabled: true };
}
