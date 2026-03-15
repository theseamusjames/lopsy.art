import { useToolSettingsStore } from '../../tool-settings-store';
import { Slider } from '../../../components/Slider/Slider';

export function PencilOptions() {
  const pencilSize = useToolSettingsStore((s) => s.pencilSize);
  const setPencilSize = useToolSettingsStore((s) => s.setPencilSize);

  return <Slider label="Size" value={pencilSize} min={1} max={100} onChange={setPencilSize} />;
}
