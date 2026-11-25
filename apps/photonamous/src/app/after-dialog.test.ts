import { afterEach, describe, expect, it } from 'vitest';
import { afterDialog } from './after-dialog';
import { useUi } from './store';

afterEach(() => {
  useUi.getState().openDialog(null);
});

describe('afterDialog', () => {
  it('runs at once when the dialog is not open', () => {
    let shown = 0;
    afterDialog('export', () => (shown += 1));
    expect(shown).toBe(1);
  });

  it('waits for the dialog to close, and runs once', () => {
    useUi.getState().openDialog('export');
    let shown = 0;
    afterDialog('export', () => (shown += 1));
    expect(shown).toBe(0);

    // Something else in the store changing is not the dialog closing.
    useUi.getState().setExportJob(null);
    expect(shown).toBe(0);

    useUi.getState().openDialog(null);
    expect(shown).toBe(1);

    useUi.getState().openDialog('export');
    useUi.getState().openDialog(null);
    expect(shown).toBe(1);
  });

  it('runs when another dialog takes the place of the one it waited for', () => {
    useUi.getState().openDialog('export');
    let shown = 0;
    afterDialog('export', () => (shown += 1));
    useUi.getState().openDialog('settings');
    expect(shown).toBe(1);
  });
});
