import { setSettle } from './registry';
import { settled } from './settled';

// Command families are imported here for their side effect of registering their commands.
import './document/document';
import './history/history';
import './layer/layer';
import './layer/effects';
import './layer/rasterize';
import './mask/mask';
import './selection/selection';

setSettle(settled);

export {
  runCommand,
  runInvocation,
  runInvocations,
  describeCommands,
  getCommand,
} from './registry';
export { CommandError, isCommandError } from './command';
