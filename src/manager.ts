import { FormatFields } from './config-schema.js';
import { applyFormat } from './project.js';
import { AnalyticsRecord, AnalyticsSink } from './types.js';

export interface SinkTarget {
  sink: AnalyticsSink;
  /** Resolves this sink's projection fields from the response status (compiled
   *  from sink.format ?? global format, including any byStatus variants). */
  resolveFields: (statusCode: number) => FormatFields | undefined;
}

export class AnalyticsManager {
  constructor(
    private readonly targets: SinkTarget[],
    private readonly onError: (error: unknown, sinkName?: string) => void,
  ) {}

  /** Fire-and-forget. Never throws. Each sink gets its own projected payload. */
  dispatch(record: AnalyticsRecord): void {
    for (const { sink, resolveFields } of this.targets) {
      try {
        const payload = applyFormat(record, resolveFields(record.response.statusCode));
        const result = sink.write(payload);
        if (result && typeof result.then === 'function') {
          result.catch((err) => this.onError(err, sink.name));
        }
      } catch (err) {
        this.onError(err, sink.name);
      }
    }
  }

  async close(): Promise<void> {
    await Promise.all(
      this.targets.map(async ({ sink }) => {
        try {
          await sink.close?.();
        } catch (err) {
          this.onError(err, sink.name);
        }
      }),
    );
  }
}
