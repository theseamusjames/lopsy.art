const loading = new Map<string, Promise<void>>();

/** Adds a classic script tag once per URL and resolves when it has run. Browser only. */
export function loadScript(src: string): Promise<void> {
  const existing = loading.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading.delete(src);
      script.remove();
      reject(new Error(`Could not load ${src}`));
    };
    document.head.appendChild(script);
  });
  loading.set(src, promise);
  return promise;
}

/** Reads a dotted path off globalThis (`google.accounts.oauth2`) without assuming its type. */
export function readGlobal(path: string): unknown {
  let current: unknown = globalThis;
  for (const key of path.split('.')) {
    if ((typeof current !== 'object' && typeof current !== 'function') || current === null) return undefined;
    current = Reflect.get(current, key);
  }
  return current;
}
