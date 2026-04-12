import { useToolSettingsStore } from '../../tool-settings-store';
import { Slider } from '../../../components/Slider/Slider';

export function MagneticLassoOptions() {
  const width = useToolSettingsStore((s) => s.magneticLassoWidth);
  const contrast = useToolSettingsStore((s) => s.magneticLassoContrast);
  const frequency = useToolSettingsStore((s) => s.magneticLassoFrequency);
  const setWidth = useToolSettingsStore((s) => s.setMagneticLassoWidth);
  const setContrast = useToolSettingsStore((s) => s.setMagneticLassoContrast);
  const setFrequency = useToolSettingsStore((s) => s.setMagneticLassoFrequency);

  return (
    <>
      <Slider label="Width" value={width} min={1} max={40} onChange={setWidth} />
      <Slider label="Contrast" value={contrast} min={1} max={100} onChange={setContrast} />
      <Slider label="Frequency" value={frequency} min={0} max={200} onChange={setFrequency} />
    </>
  );
}
