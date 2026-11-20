import { setPreflight, setSettle } from './registry';
import { settled } from './settled';
import { gpuContextPreflight } from './context';

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
import './filter/session-filters';
import './image/image';
import './document/color-mode';
import './document/files';
import './layer/add-image';
import './view/view';
import './clipboard/clipboard';
import './path/path';
import './guide/guide';
import './pattern/pattern';
import './brush/brush';
import './quick-mask/quick-mask';
import './paint/clear';
import './mask/clear';
import './paint/stroke';
import './paint/drag';
import './selection/tool-select';
import './layer/move';
import './gesture/gesture';
import './layer/nudge';
import './text/text';
import './layer/transform';
import './ui/dialogs';
import './ui/file';
import './ui/edit';
import './ui/image';
import './ui/layer';
import './ui/filter';
import './ui/view';
import './ui/help';
import './ui/quick-mask';

setSettle(settled);
setPreflight(gpuContextPreflight);

export {
  runCommand,
  runInvocation,
  runInvocations,
  describeCommands,
  getCommand,
} from './registry';
export { CommandError, isCommandError } from './command';
