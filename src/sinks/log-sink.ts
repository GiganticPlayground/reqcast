import { AnalyticsSink, LoggerLike } from '../types.js';

export interface LogSinkOptions {
  logger?: LoggerLike;
  level?: 'debug' | 'info' | 'warn' | 'error';
  message?: string;
}

export class LogSink implements AnalyticsSink {
  readonly name = 'log';
  private readonly logger: LoggerLike;
  private readonly level: 'debug' | 'info' | 'warn' | 'error';
  private readonly message: string;

  constructor(options: LogSinkOptions = {}) {
    this.logger = options.logger ?? console;
    this.level = options.level ?? 'info';
    this.message = options.message ?? 'request analytics';
  }

  write(payload: unknown): void {
    // eslint-disable-next-line no-console -- last-resort fallback when the injected logger lacks the level method and info
    const fn = this.logger[this.level] ?? this.logger.info ?? console.log;
    fn(this.message, payload);
  }
}
