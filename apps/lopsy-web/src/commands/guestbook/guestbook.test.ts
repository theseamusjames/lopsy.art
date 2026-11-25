// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandError } from '../command';
import { describeCommands, runCommand } from '../registry';
import { GUESTBOOK_OP } from '../lopsy-api';
import { GUESTBOOK_EVENT, GUESTBOOK_FIELDS, MAX_FIELD_LENGTH, signGuestbook } from './guestbook';

const ENTRY = { name: 'Ada', region: 'Lisbon', model: 'Example-1', message: 'Hello, the gradients are lovely' };

afterEach(() => {
  delete window.zaraz;
});

async function failure(promise: Promise<unknown>): Promise<CommandError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    return error as CommandError;
  }
  throw new Error('expected the command to refuse');
}

describe('guestbook.sign', () => {
  it('sends the entry as a guestbook event, a parameter for each field, and says it was signed', async () => {
    const track = vi.fn(() => Promise.resolve());
    window.zaraz = { track };
    expect(await runCommand(GUESTBOOK_OP, ENTRY)).toEqual({ signed: true });
    expect(track.mock.calls).toEqual([[GUESTBOOK_EVENT, ENTRY]]);
    expect(GUESTBOOK_EVENT).toBe('guestbook');
  });

  it('takes any of the fields, or none, and sends only the ones given', async () => {
    const track = vi.fn();
    window.zaraz = { track };
    expect(await runCommand(GUESTBOOK_OP, { message: 'hello' })).toEqual({ signed: true });
    expect(await runCommand(GUESTBOOK_OP, { name: 'Ada', model: 'Example-1', region: '' })).toEqual({ signed: true });
    expect(await runCommand(GUESTBOOK_OP, {})).toEqual({ signed: true });
    expect(await runCommand(GUESTBOOK_OP)).toEqual({ signed: true });
    expect(track.mock.calls).toEqual([
      [GUESTBOOK_EVENT, { message: 'hello' }],
      [GUESTBOOK_EVENT, { name: 'Ada', model: 'Example-1' }],
      [GUESTBOOK_EVENT, {}],
      [GUESTBOOK_EVENT, {}],
    ]);
  });

  it('says the entry was not signed when the page has no analytics', async () => {
    expect(await runCommand(GUESTBOOK_OP, ENTRY)).toEqual({ signed: false });
  });

  it('keeps a failure of the analytics call from the caller', () => {
    window.zaraz = { track: () => Promise.reject(new Error('offline')) };
    expect(signGuestbook(ENTRY)).toBe(true);
    window.zaraz = {
      track: () => {
        throw new Error('broken');
      },
    };
    expect(signGuestbook(ENTRY)).toBe(false);
  });

  it('refuses a field that is not a string, is longer than Google Analytics logs, or is not one of the four', async () => {
    const track = vi.fn();
    window.zaraz = { track };
    const tooLong = 'a'.repeat(MAX_FIELD_LENGTH + 1);
    for (const field of GUESTBOOK_FIELDS) {
      expect((await failure(runCommand(GUESTBOOK_OP, { [field]: 42 }))).code).toBe('invalid');
      const refusal = await failure(runCommand(GUESTBOOK_OP, { [field]: tooLong }));
      expect(refusal.code).toBe('invalid');
      expect(refusal.message).toContain(field);
      expect(refusal.message).toContain('100 characters');
    }
    expect((await failure(runCommand(GUESTBOOK_OP, { note: 'hello' }))).code).toBe('invalid');
    expect(track).not.toHaveBeenCalled();
    expect(await runCommand(GUESTBOOK_OP, { message: 'a'.repeat(MAX_FIELD_LENGTH) })).toEqual({ signed: true });
  });

  it('tells agents what it is for and what to leave', () => {
    const description = describeCommands('document').find((command) => command.id === GUESTBOOK_OP)!;
    expect(description.summary).toMatch(/agents leave a note to say hello/);
    expect(description.summary).toContain('lopsy.guestbook({ name, region, model, message })');
    expect(Object.keys(description.params)).toEqual([...GUESTBOOK_FIELDS]);
    for (const field of GUESTBOOK_FIELDS) {
      expect(description.params[field]).toMatchObject({ type: 'string', optional: true, maxLength: 100 });
    }
  });
});
