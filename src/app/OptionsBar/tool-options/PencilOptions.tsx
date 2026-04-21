import { FlipHorizontal2, FlipVertical2, Flower2 } from 'lucide-react';
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
  const symmetryRadial = useToolSettingsStore((s) => s.symmetryRadial);
  const symmetrySegments = useToolSettingsStore((s) => s.symmetrySegments);
  const setSymRadial = useToolSettingsStore((s) => s.setSymmetryRadial);
  const setSymSegments = useToolSettingsStore((s) => s.setSymmetrySegments);

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
      <IconButton
        icon={<Flower2 size={16} />}
        label="Radial Symmetry (Mandala)"
        isActive={symmetryRadial}
        onClick={() => setSymRadial(!symmetryRadial)}
      />
      {symmetryRadial && (
        <Slider label="Segments" value={symmetrySegments} min={2} max={32} onChange={setSymSegments} />
      )}
    </>
  );
}
