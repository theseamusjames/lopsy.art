import { useToolSettingsStore } from '../../tool-settings-store';
import { Slider } from '../../../components/Slider/Slider';

export function SprayOptions() {
  const spraySize = useToolSettingsStore((s) => s.spraySize);
  const sprayDensity = useToolSettingsStore((s) => s.sprayDensity);
  const sprayOpacity = useToolSettingsStore((s) => s.sprayOpacity);
  const sprayHardness = useToolSettingsStore((s) => s.sprayHardness);
  const setSpraySize = useToolSettingsStore((s) => s.setSpraySize);
  const setSprayDensity = useToolSettingsStore((s) => s.setSprayDensity);
  const setSprayOpacity = useToolSettingsStore((s) => s.setSprayOpacity);
  const setSprayHardness = useToolSettingsStore((s) => s.setSprayHardness);

  return (
    <>
      <Slider label="Size" value={spraySize} min={1} max={500} onChange={setSpraySize} />
      <Slider label="Density" value={sprayDensity} min={1} max={100} onChange={setSprayDensity} />
      <Slider label="Opacity" value={sprayOpacity} min={1} max={100} onChange={setSprayOpacity} />
      <Slider label="Softness" value={sprayHardness} min={0} max={100} onChange={setSprayHardness} />
    </>
  );
}
