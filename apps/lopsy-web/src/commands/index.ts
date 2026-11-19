import { setSettle } from './registry';
import { settled } from './settled';

// Command families are imported here for their side effect of registering their commands.
import './document/document';
import './history/history';

setSettle(settled);

export {
  runCommand,
  runInvocation,
  runInvocations,
  describeCommands,
  getCommand,
} from './registry';
export { CommandError, isCommandError } from './command';
