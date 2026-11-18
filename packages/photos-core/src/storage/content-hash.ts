/** Lower-case hex SHA-256 of a blob's bytes. */
export async function sha256Hex(content: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await content.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
