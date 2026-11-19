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
import './paint/fill';
import './color/color';
import './tool/tool';
import './adjust/adjust';
import './filter/filter';
import './image/image';
import './document/color-mode';
import './document/files';
import './layer/add-image';
import './view/view';

setSettle(settled);

export {
  runCommand,
  runInvocation,
  runInvocations,
  describeCommands,
  getCommand,
} from './registry';
export { CommandError, isCommandError } from './command';
