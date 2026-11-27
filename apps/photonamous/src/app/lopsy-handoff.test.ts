import { describe, expect, it } from 'vitest';
import { HandoffError } from '@lopsy/handoff/channel';
import { handoffFailureMessage, isReceivePage, lopsyLongEdge, receiverMessage, savedMessage } from './lopsy-handoff';

const stored = (outcome: 'created' | 'updated' | 'copied') => ({ revision: 'r', documentId: 'd', outcome, fileName: 'x.lopsy' });

describe('Lopsy handoff words', () => {
  it('says how a save was stored', () => {
    expect(savedMessage('Poster', stored('created'))).toBe('Saved from Lopsy: Poster');
    expect(savedMessage('Poster', stored('copied'))).toBe('Saved from Lopsy as a copy: Poster');
  });

  it('explains a failed handoff', () => {
    expect(handoffFailureMessage(new HandoffError('popup-blocked', 'x'))).toMatch(/blocked opening Lopsy/);
    expect(handoffFailureMessage(new HandoffError('timeout', 'x'))).toMatch(/did not answer in time/);
    expect(handoffFailureMessage(new Error('boom'))).toMatch(/boom/);
  });

  it('follows the receiver', () => {
    expect(receiverMessage({ kind: 'waiting' })).toBe('Receiving from Lopsy…');
    expect(receiverMessage({ kind: 'saved', name: 'Poster', stored: stored('updated') })).toBe('Saved from Lopsy: Poster');
    expect(receiverMessage({ kind: 'failed', error: 'no room' })).toBe('Saving from Lopsy failed: no room');
  });

  it('knows a receive page', () => {
    expect(isReceivePage('?receive=abc')).toBe(true);
    expect(isReceivePage('?backend=fake')).toBe(false);
  });

  it('hands Lopsy a photo larger than the GPU at the largest size the GPU can edit, and any other at its own', () => {
    expect(lopsyLongEdge({ width: 8368, height: 5584 }, 8192)).toBe(8190);
    expect(lopsyLongEdge({ width: 6000, height: 4000 }, 8192)).toBeNull();
    expect(lopsyLongEdge({ width: 8368, height: 5584 }, null)).toBeNull();
    expect(lopsyLongEdge({ width: null, height: null }, 8192)).toBeNull();
  });
});
