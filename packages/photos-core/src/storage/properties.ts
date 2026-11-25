import { StorageError } from './errors';

/** Drive's limits on app properties, enforced by every adapter so code that passes on memory passes on Drive. */
export const MAX_PROPERTIES = 30;
export const MAX_PROPERTY_BYTES = 124;

const encoder = new TextEncoder();

export function validateProperties(properties: Readonly<Record<string, string>>): void {
  const keys = Object.keys(properties);
  if (keys.length > MAX_PROPERTIES) {
    throw new StorageError('invalid', `A file may have at most ${MAX_PROPERTIES} properties, got ${keys.length}`);
  }
  for (const key of keys) {
    const value = properties[key] ?? '';
    if (key.length === 0) throw new StorageError('invalid', 'Property keys may not be empty');
    if (encoder.encode(key).length + encoder.encode(value).length > MAX_PROPERTY_BYTES) {
      throw new StorageError('invalid', `Property "${key}" is longer than ${MAX_PROPERTY_BYTES} bytes with its value`);
    }
  }
}

/** Applies a patch where null removes a key; validates the result. */
export function applyPropertyPatch(
  current: Readonly<Record<string, string>>,
  patch: Readonly<Record<string, string | null>>,
): Record<string, string> {
  const next: Record<string, string> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  validateProperties(next);
  return next;
}
