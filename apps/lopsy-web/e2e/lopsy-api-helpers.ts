/**
 * Calling the public command API, `window.lopsy`, from a spec, as an agent
 * would: through `page.evaluate`, getting back the JSON outcome. For specs
 * that test that API on the editor (`lopsy-api-editor.spec.ts`,
 * `build-preview.spec.ts`); the command specs in `e2e/api/` use their
 * harness instead.
 */
import { expect, type Page } from './fixtures';

export interface Invocation {
  readonly op: string;
  readonly [param: string]: unknown;
}

export interface LopsyError {
  name: string;
  code: string;
  message: string;
  result?: unknown;
  completed?: unknown[];
  index?: number;
}

export type Outcome =
  | { ok: true; result: unknown }
  | { ok: true; results: unknown[] }
  | { ok: false; error: LopsyError };

export interface Description {
  id: string;
  summary: string;
  surface: string;
  params: Record<string, unknown>;
}

export interface LopsyWindow {
  lopsy?: {
    describe: () => Description[];
    run: (invocation: unknown) => Promise<Outcome>;
    guestbook: (note?: unknown) => Promise<Outcome>;
  };
}

export async function waitForLopsy(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as LopsyWindow).lopsy);
}

export async function lopsy(page: Page, invocation: Invocation | readonly Invocation[]): Promise<Outcome> {
  return page.evaluate((payload) => (window as unknown as LopsyWindow).lopsy!.run(payload), invocation as unknown);
}

/** Runs through window.lopsy and returns the result, failing the test on an error outcome. */
export async function lopsyResult<T>(page: Page, invocation: Invocation): Promise<T> {
  const outcome = await lopsy(page, invocation);
  if (!outcome.ok) throw new Error(`${invocation.op} failed: ${outcome.error.code}: ${outcome.error.message}`);
  if (!('result' in outcome)) throw new Error('expected a single result');
  return outcome.result as T;
}

export async function lopsyDescribe(page: Page): Promise<Description[]> {
  return page.evaluate(() => (window as unknown as LopsyWindow).lopsy!.describe());
}

/** What describe() must be: the document commands, each once, as JSON, and no ui command. */
export function expectDocumentCommandsOnly(description: readonly Description[]): void {
  expect(description.length).toBeGreaterThan(100);
  expect(description.every((d) => d.surface === 'document')).toBe(true);
  expect(description.filter((d) => d.id.startsWith('ui.'))).toEqual([]);
  const ids = description.map((d) => d.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toEqual(expect.arrayContaining(['doc.new', 'doc.info', 'layer.add', 'paint.fill', 'history.undo']));
  expect(JSON.parse(JSON.stringify(description))).toEqual(description);
}
