import type { TokenSource } from './types';

/**
 * A TokenSource for tests: hands out fixed tokens in order. `invalidate`
 * moves on to the next one (and stays on the last), which is how tests
 * model a refresh after a 401.
 */
export class StaticTokenSource implements TokenSource {
  private index = 0;
  private readonly tokens: readonly string[];
  /** How many times `invalidate` was called. */
  invalidations = 0;
  /** How many times `requestInteractive` was called. */
  interactiveRequests = 0;

  constructor(tokens: string | readonly string[] = 'test-token') {
    this.tokens = typeof tokens === 'string' ? [tokens] : tokens;
    if (this.tokens.length === 0) throw new RangeError('StaticTokenSource needs at least one token');
  }

  async getToken(): Promise<string> {
    return this.current();
  }

  async requestInteractive(): Promise<string> {
    this.interactiveRequests += 1;
    return this.current();
  }

  invalidate(): void {
    this.invalidations += 1;
    this.index = Math.min(this.index + 1, this.tokens.length - 1);
  }

  private current(): string {
    return this.tokens[this.index] ?? '';
  }
}
