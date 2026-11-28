/**
 * The text of an error as a person is shown it, in an import's or an
 * export's list of files. Errors this package makes (StorageError and the
 * library's own) say what happened in a sentence and are shown as they
 * are. A programming error (TypeError and its kin) or a framework's
 * message (React's minified "error #185") means nothing to the person:
 * it is logged in full for the console and shown as a plain sentence.
 */

const INTERNAL_TEXT = /react\.dev\/errors|Minified React error|Maximum update depth|is not a function|Cannot read properties of/i;

export const UNEXPECTED_ERROR_TEXT = 'Something unexpected went wrong in the app';

function isInternal(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  if (error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError || error instanceof SyntaxError) return true;
  return INTERNAL_TEXT.test(error.message) || error.message === '';
}

export function shownMessage(error: unknown, where: string): string {
  if (!isInternal(error)) return (error as Error).message;
  console.error(`${where}: unexpected error`, error);
  return UNEXPECTED_ERROR_TEXT;
}
