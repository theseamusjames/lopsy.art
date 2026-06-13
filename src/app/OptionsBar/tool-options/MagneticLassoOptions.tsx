import { useToolSettingsStore } from '../../tool-settings-store';
import { Slider } from '../../../components/Slider/Slider';

export function MagneticLassoOptions() {
  const width = useToolSettingsStore((s) => s.settings.magneticLasso.width);
  const contrast = useToolSettingsStore((s) => s.settings.magneticLasso.contrast);
  const frequency = useToolSettingsStore((s) => s.settings.magneticLasso.frequency);
  const setSetting = useToolSettingsStore((s) => s.setMagneticLassoSetting);

  return (
    <>
      <Slider label="Width" value={width} min={1} max={40} onChange={(v) => setSetting('width', v)} />
      <Slider label="Contrast" value={contrast} min={1} max={100} onChange={(v) => setSetting('contrast', v)} />
      <Slider label="Frequency" value={frequency} min={0} max={200} onChange={(v) => setSetting('frequency', v)} />
    </>
  );
}
