import { useToolSettingsStore } from '../../tool-settings-store';
import { Slider } from '../../../components/Slider/Slider';

export function SmudgeOptions() {
  const smudgeSize = useToolSettingsStore((s) => s.smudgeSize);
  const smudgeStrength = useToolSettingsStore((s) => s.smudgeStrength);
  const setSmudgeSize = useToolSettingsStore((s) => s.setSmudgeSize);
  const setSmudgeStrength = useToolSettingsStore((s) => s.setSmudgeStrength);

  return (
    <>
      <Slider label="Size" value={smudgeSize} min={1} max={200} onChange={setSmudgeSize} />
      <Slider label="Strength" value={smudgeStrength} min={0} max={100} onChange={setSmudgeStrength} />
    </>
  );
}
