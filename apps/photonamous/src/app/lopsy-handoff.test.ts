import { describe, expect, it, vi } from 'vitest';
import type { LibrarySession } from '@lopsy/photos-core/library/types';
import { HandoffError } from '@lopsy/handoff/channel';
import { handoffFailureMessage, isReceivePage, lopsyRefusal, openInLopsy, receiverMessage, savedMessage } from './lopsy-handoff';
import { editInLopsy } from '../handoff/send-to-lopsy';
import { showErrorToast } from './toasts';

vi.mock('../handoff/send-to-lopsy', () => ({ editInLopsy: vi.fn(), lopsyUrl: () => 'http://lopsy.test/' }));
vi.mock('./toasts', () => ({ showErrorToast: vi.fn(), showToast: vi.fn(), dismissToast: vi.fn() }));
vi.mock('../engine/texture-limit', () => ({ textureLimit: () => 16384 }));

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

  it('refuses a photo larger than the GPU can edit, with the sentence why', () => {
    const photo = (width: number | null, height: number | null) => ({ kind: 'original' as const, width, height });
    expect(lopsyRefusal(photo(17504, 3440), 16384)).toBe(
      'This photo is 17504 × 3440 pixels, larger than Lopsy can open on this device (16382 on a side).',
    );
    // The long edge decides, either way round.
    expect(lopsyRefusal(photo(5584, 8368), 8192)).toBe('This photo is 5584 × 8368 pixels, larger than Lopsy can open on this device (8190 on a side).');
  });

  it('lets through a photo that fits, and one whose size or limit is unknown', () => {
    const photo = (width: number | null, height: number | null) => ({ kind: 'original' as const, width, height });
    // editableLimit: the texture side less straighten's border of 2, as everything else about oversized photos.
    expect(lopsyRefusal(photo(8190, 5000), 8192)).toBeNull();
    expect(lopsyRefusal(photo(8191, 5000), 8192)).not.toBeNull();
    expect(lopsyRefusal(photo(6000, 4000), 8192)).toBeNull();
    expect(lopsyRefusal(photo(17504, 3440), null)).toBeNull();
    expect(lopsyRefusal(photo(null, null), 8192)).toBeNull();
  });

  it('lets a Lopsy document through, which goes as its .lopsy', () => {
    expect(lopsyRefusal({ kind: 'document', width: 17504, height: 3440 }, 16384)).toBeNull();
  });

  it('Edit in Lopsy refuses such a photo with that sentence, handing nothing over', () => {
    const asset = { id: 'a1', kind: 'original', width: 17504, height: 3440, primaryVersionId: 'v1' };
    const session = { getView: () => ({ assets: new Map([['a1', asset]]) }) } as unknown as LibrarySession;
    openInLopsy(session, 'a1');
    expect(editInLopsy).not.toHaveBeenCalled();
    expect(showErrorToast).toHaveBeenCalledWith('This photo is 17504 × 3440 pixels, larger than Lopsy can open on this device (16382 on a side).');
  });
});
