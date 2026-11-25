/**
 * Fake windows for the handoff tests. Each FakeWindow has an origin, its
 * message listeners and an opener; postMessage behaves like a browser's:
 * delivery is asynchronous, a target origin that does not match drops the
 * message, and transferred buffers are detached.
 */

import type { HandoffListener, HandoffMessageEvent, HandoffPeer, HandoffWindow } from './channel.ts';

export interface PostRecord {
  readonly from: FakeWindow;
  readonly to: FakeWindow;
  readonly data: unknown;
  readonly targetOrigin: string;
  readonly transfer: readonly Transferable[];
}

export class FakeWindow implements HandoffWindow {
  readonly location: { href: string };
  opener: HandoffPeer | null = null;
  closed = false;
  focused = 0;
  readonly opened: { url: string; target: string; window: FakeWindow }[] = [];
  readonly posts: PostRecord[];
  /** Set to false to make `open` return null, like a popup blocker. */
  canOpen = true;
  private readonly listeners = new Set<HandoffListener>();
  private readonly peers = new Map<FakeWindow, HandoffPeer>();

  constructor(href: string, posts: PostRecord[] = []) {
    this.location = { href };
    this.posts = posts;
  }

  get origin(): string {
    return new URL(this.location.href).origin;
  }

  /** This window as `from` sees it (what `open` returns, or `opener`). */
  peerFor(from: FakeWindow): HandoffPeer {
    const existing = this.peers.get(from);
    if (existing) return existing;
    const peer = makePeer(this, from);
    this.peers.set(from, peer);
    return peer;
  }

  /** Delivers an event as if it came from `from`. */
  dispatch(event: HandoffMessageEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  open(url: string, target: string): HandoffPeer | null {
    if (!this.canOpen) return null;
    const child = new FakeWindow(new URL(url, this.location.href).href, this.posts);
    child.opener = this.peerFor(child);
    this.opened.push({ url: child.location.href, target, window: child });
    return child.peerFor(this);
  }

  addEventListener(_type: 'message', listener: HandoffListener): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: HandoffListener): void {
    this.listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  setTimeout(handler: () => void, ms: number): number {
    return setTimeout(handler, ms) as unknown as number;
  }

  clearTimeout(handle: number): void {
    clearTimeout(handle);
  }
}

function makePeer(target: FakeWindow, from: FakeWindow): HandoffPeer {
  return {
    postMessage(message: unknown, targetOrigin: string, transfer: Transferable[] = []): void {
      target.posts.push({ from, to: target, data: message, targetOrigin, transfer });
      if (targetOrigin === '*') throw new Error('test: postMessage with "*"');
      const data = structuredClone(message, { transfer: transfer as Transferable[] });
      if (target.closed || targetOrigin !== target.origin) return;
      queueMicrotask(() => target.dispatch({ data, origin: from.origin, source: from.peerFor(target) }));
    },
    get closed() {
      return target.closed;
    },
    focus() {
      target.focused += 1;
    },
  };
}

export const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
export const LOPSY_BYTES = [0x4c, 0x4f, 0x50, 0x53, 0x59, 0x00, 3, 0, 0, 0, 0, 0];

export function bytes(values: readonly number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}
