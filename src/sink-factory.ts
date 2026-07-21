import { SinkConfig } from './config-schema.js';
import { AmqpSink } from './sinks/amqp-sink.js';
import { FileSink } from './sinks/file-sink.js';
import { LogSink } from './sinks/log-sink.js';
import { AnalyticsRuntime, AnalyticsSink } from './types.js';

export function createSink(cfg: SinkConfig, runtime: AnalyticsRuntime): AnalyticsSink {
  switch (cfg.type) {
    case 'log':
      return new LogSink({ logger: runtime.logger, level: cfg.level, message: cfg.message });
    case 'file':
      return new FileSink({
        path: cfg.path,
        onError: (e) => runtime.onError?.(e, 'file'),
      });
    case 'amqp':
      return new AmqpSink({
        connectionString: cfg.connectionString ?? cfg.url,
        connectionUrls: cfg.connectionUrls,
        protocol: cfg.protocol,
        username: cfg.username,
        password: cfg.password,
        host: cfg.host,
        port: cfg.port,
        vhost: cfg.vhost,
        exchange: cfg.exchange,
        routingKey: cfg.routingKey,
        publishOptions: cfg.publishOptions,
        amqpOpts: cfg.amqpOpts,
        tls: cfg.tls,
        logger: runtime.logger,
      });
  }
}
