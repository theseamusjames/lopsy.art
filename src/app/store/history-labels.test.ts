import { describe, it, expect } from 'vitest';

// Vite's import.meta.glob loads file contents at build time — no node fs.
// `eager: true, query: '?raw'` returns each module as `{default: string}`.
const RAW_MODULES = import.meta.glob('/src/**/*.{ts,tsx}', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

function productionFiles(): Array<[string, string]> {
  return Object.entries(RAW_MODULES).filter(([path]) => {
    if (path.endsWith('.test.ts') || path.endsWith('.test.tsx')) return false;
    if (path.endsWith('.stories.tsx')) return false;
    // The slice itself defines `pushHistory(label?: string)` — don't flag the
    // declaration as an unlabeled call site.
    if (path.endsWith('/history-slice.ts')) return false;
    return true;
  });
}

// Static scan: every `.pushHistory(...)` in src/ must pass an explicit label
// argument. Falling back to the default `'Edit'` produces opaque entries in
// the History panel — see #331.
describe('pushHistory labels — every call site is labeled', () => {
  it('no production source calls pushHistory() without a label', () => {
    const offenders: string[] = [];
    const callPattern = /\.pushHistory\(\s*\)/;
    for (const [path, text] of productionFiles()) {
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (callPattern.test(line)) {
          offenders.push(`${path}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('common operations have specific (non-"Edit", non-"Update Effects") labels', () => {
    const directLabels = new Set<string>();
    const labelPattern = /\.pushHistory\(\s*['"`]([^'"`]+)['"`]/g;
    let allText = '';
    for (const [, text] of productionFiles()) {
      allText += '\n' + text;
      let m: RegExpExecArray | null;
      while ((m = labelPattern.exec(text)) !== null) {
        if (m[1]) directLabels.add(m[1]);
      }
    }

    // Tools/ops the user explicitly called out as needing better names.
    const expectedDirect = [
      'Shape',
      'Smudge',
      'Healing Brush',
      'Clone Stamp',
      'Spray',
      'Stroke Path',
      'Transform',
      'Nudge',
      'Invert',
      'Desaturate',
      'Add Noise',
      'Find Edges',
      'Pattern Fill',
      'Bucket Fill',
      'Quick Mask Fill',
    ];
    for (const label of expectedDirect) {
      expect(directLabels, `missing direct label "${label}"`).toContain(label);
    }

    // Some labels are passed indirectly through a variable (e.g. paint
    // handlers branch on tool type) — for those, just check the literal
    // appears in the source.
    const expectedAnywhere = [
      "'Brush'",
      "'Eraser'",
      "'Pencil'",
      "'Mask Paint'",
      "'Mask Erase'",
      "'Quick Mask Paint'",
      "'Quick Mask Erase'",
    ];
    for (const lit of expectedAnywhere) {
      expect(allText.includes(lit), `missing literal label ${lit} in source`).toBe(true);
    }

    // 'Edit' and 'Update Effects' were the generic defaults the user
    // complained about — make sure no source code passes them as labels.
    expect(directLabels).not.toContain('Edit');
    expect(directLabels).not.toContain('Update Effects');
  });
});
