import { FlipHorizontal2, FlipVertical2 } from 'lucide-react';
import { useToolSettingsStore } from '../../tool-settings-store';
import { Slider } from '../../../components/Slider/Slider';
import { IconButton } from '../../../components/IconButton/IconButton';

export function PencilOptions() {
  const pencilSize = useToolSettingsStore((s) => s.pencilSize);
  const setPencilSize = useToolSettingsStore((s) => s.setPencilSize);
  const symmetryH = useToolSettingsStore((s) => s.symmetryHorizontal);
  const symmetryV = useToolSettingsStore((s) => s.symmetryVertical);
  const setSymH = useToolSettingsStore((s) => s.setSymmetryHorizontal);
  const setSymV = useToolSettingsStore((s) => s.setSymmetryVertical);

  return (
    <>
      <Slider label="Size" value={pencilSize} min={1} max={100} onChange={setPencilSize} />
      <IconButton
        icon={<FlipVertical2 size={16} />}
        label="Symmetry Horizontal"
        isActive={symmetryH}
        onClick={() => setSymH(!symmetryH)}
      />
      <IconButton
        icon={<FlipHorizontal2 size={16} />}
        label="Symmetry Vertical"
        isActive={symmetryV}
        onClick={() => setSymV(!symmetryV)}
      />
    </>
  );
}
