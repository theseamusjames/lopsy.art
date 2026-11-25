// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandError } from '../command';
import { describeCommands, runCommand } from '../registry';
import { GUESTBOOK_OP } from '../lopsy-api';
import { GUESTBOOK_EVENT, MAX_NOTE_LENGTH, noteParameters, signGuestbook } from './guestbook';

const NOTE = 'Ada, Lisbon, Example-1: hello';

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
  it('sends the note as a guestbook event and says it was signed', async () => {
    const track = vi.fn(() => Promise.resolve());
    window.zaraz = { track };
    expect(await runCommand(GUESTBOOK_OP, { note: NOTE })).toEqual({ signed: true });
    expect(track.mock.calls).toEqual([[GUESTBOOK_EVENT, { note: NOTE }]]);
    expect(GUESTBOOK_EVENT).toBe('guestbook');
  });

  it('says the note was not signed when the page has no analytics', async () => {
    expect(await runCommand(GUESTBOOK_OP, { note: NOTE })).toEqual({ signed: false });
  });

  it('keeps a failure of the analytics call from the caller', async () => {
    window.zaraz = { track: () => Promise.reject(new Error('offline')) };
    expect(signGuestbook(NOTE)).toBe(true);
    window.zaraz = {
      track: () => {
        throw new Error('broken');
      },
    };
    expect(signGuestbook(NOTE)).toBe(false);
  });

  it('refuses a note that is missing, empty, not a string or longer than Google Analytics keeps', async () => {
    const track = vi.fn();
    window.zaraz = { track };
    const tooLong = 'a'.repeat(MAX_NOTE_LENGTH + 1);
    for (const params of [{}, { note: '' }, { note: 42 }, { note: tooLong }]) {
      expect((await failure(runCommand(GUESTBOOK_OP, params))).code).toBe('invalid');
    }
    expect((await failure(runCommand(GUESTBOOK_OP, { note: tooLong }))).message).toContain('280 characters');
    expect(track).not.toHaveBeenCalled();
    expect(await runCommand(GUESTBOOK_OP, { note: 'a'.repeat(MAX_NOTE_LENGTH) })).toEqual({ signed: true });
  });

  it('sends a note longer than Google Analytics takes in one parameter in parts of 100 characters', async () => {
    const track = vi.fn();
    window.zaraz = { track };
    const note = `${'a'.repeat(100)}${'b'.repeat(100)}${'c'.repeat(80)}`;
    await runCommand(GUESTBOOK_OP, { note });
    expect(track.mock.calls).toEqual([
      [GUESTBOOK_EVENT, { note: 'a'.repeat(100), note_2: 'b'.repeat(100), note_3: 'c'.repeat(80) }],
    ]);
    expect(noteParameters('a'.repeat(100))).toEqual({ note: 'a'.repeat(100) });
    expect(noteParameters('a'.repeat(101))).toEqual({ note: 'a'.repeat(100), note_2: 'a' });
  });

  it('never cuts an emoji in two, and the longest note still fits three parts', () => {
    // Each emoji is two UTF-16 units: after 99 letters one does not fit the part, so it starts the next.
    const straddling = `${'a'.repeat(99)}\u{1F44B}${'b'.repeat(97)}\u{1F3A8}${'c'.repeat(80)}`;
    expect(straddling).toHaveLength(MAX_NOTE_LENGTH);
    const parameters = noteParameters(straddling);
    expect(parameters).toEqual({
      note: 'a'.repeat(99),
      note_2: `\u{1F44B}${'b'.repeat(97)}`,
      note_3: `\u{1F3A8}${'c'.repeat(80)}`,
    });
    expect(Object.values(parameters).join('')).toBe(straddling);

    const worst = noteParameters(`a${'\u{1F44B}'.repeat(139)}a`);
    expect(Object.keys(worst)).toEqual(['note', 'note_2', 'note_3']);
    expect(Object.values(worst).every((part) => part.length <= 100)).toBe(true);
  });

  it('tells agents what it is for and what to leave', () => {
    const description = describeCommands('document').find((command) => command.id === GUESTBOOK_OP)!;
    expect(description.summary).toMatch(/agents leave a note to say hello/);
    for (const part of ['name', 'region', 'model', 'message']) {
      expect(description.summary).toContain(part);
      expect(description.params.note!.description).toContain(part);
    }
    expect(description.summary).toContain('lopsy.guestbook(note)');
  });
});
