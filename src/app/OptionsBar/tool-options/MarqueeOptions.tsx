import { AspectRatioControl } from './AspectRatioControl';
import { Slider } from '../../../components/Slider/Slider';
import { useToolSettingsStore } from '../../tool-settings-store';

export function MarqueeOptions() {
  const feather = useToolSettingsStore((s) => s.settings.marquee.feather);
  const setMarqueeSetting = useToolSettingsStore((s) => s.setMarqueeSetting);

  return (
    <>
      <AspectRatioControl />
      <Slider
        label="Feather"
        value={feather}
        min={0}
        max={250}
        onChange={(v) => setMarqueeSetting('feather', v)}
      />
    </>
  );
}
