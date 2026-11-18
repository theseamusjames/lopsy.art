/** Gzip through the platform's CompressionStream (browsers and Node 22). */

export async function gzipText(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = await new Response(stream).arrayBuffer();
  return new Blob([bytes], { type: 'application/gzip' });
}

export class DecodeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DecodeError';
  }
}

/**
 * Inflates and decodes UTF-8, refusing output past `maxBytes` so a small
 * hostile file cannot expand without bound.
 */
export async function gunzipText(blob: Blob, maxBytes: number): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    const reader = blob.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new DecodeError(`Decompressed data exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof DecodeError) throw error;
    throw new DecodeError('Data is not valid gzip', { cause: error });
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(joined);
  } catch (error) {
    throw new DecodeError('Data is not valid UTF-8', { cause: error });
  }
}
