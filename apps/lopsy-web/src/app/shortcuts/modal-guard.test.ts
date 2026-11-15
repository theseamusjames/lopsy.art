// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { isModalDialogOpen } from './modal-guard';

describe('isModalDialogOpen', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is false with no dialog', () => {
    expect(isModalDialogOpen()).toBe(false);
  });

  it('ignores non-modal floating panels', () => {
    document.body.innerHTML = '<div role="dialog" aria-label="Brushes"></div>';
    expect(isModalDialogOpen()).toBe(false);
  });

  it('is true while a modal dialog is open', () => {
    document.body.innerHTML = '<div role="dialog" aria-modal="true" aria-label="Rectangular Selection"></div>';
    expect(isModalDialogOpen()).toBe(true);
  });
});
