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
 * hostile file cannot expand without bound. Bytes are decoded as they
 * arrive, so the inflated bytes and the text are never both held whole.
 */
export async function gunzipText(blob: Blob, maxBytes: number): Promise<string> {
  const parts: string[] = [];
  let total = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
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
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
  } catch (error) {
    if (error instanceof DecodeError) throw error;
    if (error instanceof TypeError && /encod|decod/i.test(error.message)) {
      throw new DecodeError('Data is not valid UTF-8', { cause: error });
    }
    throw new DecodeError('Data is not valid gzip', { cause: error });
  }
  return parts.join('');
}
