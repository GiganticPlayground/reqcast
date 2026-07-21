import { createWriteStream, WriteStream } from 'node:fs';

import { AnalyticsSink } from '../types.js';

export interface FileSinkOptions {
  path: string;
  onError?: (error: unknown) => void;
}

export class FileSink implements AnalyticsSink {
  readonly name = 'file';
  private readonly stream: WriteStream;

  constructor(options: FileSinkOptions) {
    this.stream = createWriteStream(options.path, { flags: 'a' });
    this.stream.on('error', (err) => options.onError?.(err));
  }

  write(payload: unknown): void {
    this.stream.write(`${JSON.stringify(payload)}\n`);
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.stream.end(resolve));
  }
}
