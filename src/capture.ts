export interface CapturedBody {
  buffer: Buffer;
  bytes: number;
  truncated: boolean;
}

export function captureResponseBody(
  res: { write(...a: unknown[]): boolean; end(...a: unknown[]): unknown },
  maxBytes: number,
): () => CapturedBody {
  const chunks: Buffer[] = [];
  let bytes = 0;
  let truncated = false;

  const push = (chunk: unknown): void => {
    if (!chunk || bytes >= maxBytes) {
      if (chunk && bytes >= maxBytes) truncated = true;
      return;
    }
    // String chunks are assumed utf8 (JSON/text responses); a non-utf8 write
    // encoding (e.g. 'base64') would make bodyBytes approximate.
    const buf = Buffer.isBuffer(chunk)
      ? chunk
      : typeof chunk === 'string'
        ? Buffer.from(chunk)
        : null;
    if (!buf) return;
    const remaining = maxBytes - bytes;
    if (buf.length > remaining) {
      chunks.push(buf.subarray(0, remaining));
      bytes = maxBytes;
      truncated = true;
    } else {
      chunks.push(buf);
      bytes += buf.length;
    }
  };

  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
  const origWrite = res.write.bind(res) as any;
  const origEnd = res.end.bind(res) as any;
  res.write = function (chunk: unknown, ...args: unknown[]) {
    push(chunk);
    return origWrite(chunk, ...args);
  } as any;
  res.end = function (chunk: unknown, ...args: unknown[]) {
    if (typeof chunk !== 'function') push(chunk);
    return origEnd(chunk, ...args);
  } as any;
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */

  return () => ({ buffer: Buffer.concat(chunks), bytes, truncated });
}

export function parseBody(buffer: Buffer, contentType: string | undefined): unknown {
  if (buffer.length === 0) return undefined;
  const text = buffer.toString('utf8');
  if (contentType?.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}
