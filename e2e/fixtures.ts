import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';
export type { Page } from '@playwright/test';

/**
 * Every test fails if the browser logged a console error or threw a page
 * error. A real bug (a wasm panic, an unhandled rejection, a React warning
 * promoted to error) often passes unnoticed when only the assertions drive
 * pass/fail — wire it through the harness so it can't.
 *
 * Opt out for a single test that legitimately exercises an error path:
 *
 *   test.use({ allowConsoleErrors: [/expected: foo/] });
 *   test('invalid input shows message', async () => { ... });
 */
export const test = base.extend<{
  allowConsoleErrors: RegExp[];
  _consoleErrorGuard: void;
}>({
  allowConsoleErrors: [[], { option: true }],

  _consoleErrorGuard: [
    async ({ page, allowConsoleErrors }, use) => {
      const errors: string[] = [];
      const isAllowed = (text: string) =>
        allowConsoleErrors.some((re) => re.test(text));

      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (isAllowed(text)) return;
        errors.push(`[console.error] ${text}`);
      });
      page.on('pageerror', (err) => {
        const text = err.message;
        if (isAllowed(text)) return;
        errors.push(`[pageerror] ${text}`);
      });

      await use();

      if (errors.length > 0) {
        const unique = Array.from(new Set(errors));
        throw new Error(
          `Browser logged ${errors.length} error(s) during this test:\n` +
            unique.map((e) => '  - ' + e).join('\n'),
        );
      }
    },
    { auto: true },
  ],
});
