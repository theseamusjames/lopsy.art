/** UUIDv7 (spec 7): time-ordered, so IDs made on one device sort by creation. */
const POOL_IDS = 256;
let pool = new Uint8Array(0);
let poolOffset = 0;

/** Random bytes drawn from a pool refilled 4 KiB at a time: one getRandomValues per 256 IDs. */
function randomBytes16(): Uint8Array {
  if (poolOffset + 16 > pool.length) {
    pool = new Uint8Array(16 * POOL_IDS);
    crypto.getRandomValues(pool);
    poolOffset = 0;
  }
  const bytes = pool.slice(poolOffset, poolOffset + 16);
  poolOffset += 16;
  return bytes;
}

export function newId(now: number = Date.now()): string {
  const bytes = randomBytes16();
  let ms = Math.max(0, Math.floor(now));
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Device IDs end up in HLC stamps, op IDs and file names, so they are kept to a safe alphabet. */
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isDeviceId(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_ID_PATTERN.test(value);
}
