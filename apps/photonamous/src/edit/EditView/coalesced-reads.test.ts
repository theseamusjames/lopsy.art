import { describe, expect, it } from 'vitest';
import { CoalescedReads } from './coalesced-reads';

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function controlledRead(log: string[], name: string): { read: () => Promise<void>; finish: () => void } {
  let finish: () => void = () => undefined;
  return {
    read: () => {
      log.push(`start ${name}`);
      return new Promise<void>((resolve) => {
        finish = () => {
          log.push(`end ${name}`);
          resolve();
        };
      });
    },
    finish: () => finish(),
  };
}

describe('CoalescedReads', () => {
  it('keeps one read in flight and runs only the newest of those asked for meanwhile', async () => {
    const log: string[] = [];
    const reads = new CoalescedReads();
    const a = controlledRead(log, 'a');
    const b = controlledRead(log, 'b');
    const c = controlledRead(log, 'c');
    reads.request(a.read);
    await settle();
    reads.request(b.read);
    reads.request(c.read);
    await settle();
    expect(log).toEqual(['start a']);
    a.finish();
    await settle();
    expect(log).toEqual(['start a', 'end a', 'start c']);
    c.finish();
    await settle();
    expect(log).toEqual(['start a', 'end a', 'start c', 'end c']);
  });

  it('goes on after a read fails', async () => {
    const log: string[] = [];
    const reads = new CoalescedReads();
    reads.request(() => Promise.reject(new Error('lost')));
    const b = controlledRead(log, 'b');
    reads.request(b.read);
    await settle();
    expect(log).toEqual(['start b']);
  });

  it('runs a read at once when none is in flight', async () => {
    const log: string[] = [];
    const reads = new CoalescedReads();
    const a = controlledRead(log, 'a');
    reads.request(a.read);
    await settle();
    a.finish();
    await settle();
    const b = controlledRead(log, 'b');
    reads.request(b.read);
    await settle();
    expect(log).toEqual(['start a', 'end a', 'start b']);
  });
});
