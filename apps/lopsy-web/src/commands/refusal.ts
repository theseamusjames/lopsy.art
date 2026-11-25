import { CommandError, type CommandNotice } from './command';
import { notifyError, notifyInfo } from '../app/notifications-store';

/** Why an operation was refused, and whether the UI toasts that reason today. */
export interface Refusal {
  readonly reason: string;
  /** null for refusals the UI keeps silent. */
  readonly notice: CommandNotice;
}

export function refusalError(refusal: Refusal): CommandError {
  return new CommandError('refused', refusal.reason, { notice: refusal.notice });
}

/** Shows the toast the UI shows for this refusal, if any. */
export function announceRefusal(refusal: Refusal): void {
  if (refusal.notice === 'info') notifyInfo(refusal.reason);
  else if (refusal.notice === 'error') notifyError(refusal.reason);
}
