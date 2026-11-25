/** Lower-case hex SHA-256 of the data, by WebCrypto. */
export async function sha256Hex(data: Blob | ArrayBuffer | Uint8Array): Promise<string> {
  let buffer: ArrayBuffer | Uint8Array<ArrayBuffer>;
  if (data instanceof Blob) buffer = await data.arrayBuffer();
  else if (data instanceof Uint8Array) buffer = data.buffer instanceof ArrayBuffer ? (data as Uint8Array<ArrayBuffer>) : data.slice();
  else buffer = data;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}
