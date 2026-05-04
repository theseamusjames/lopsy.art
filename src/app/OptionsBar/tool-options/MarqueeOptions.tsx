import { AspectRatioControl } from './AspectRatioControl';
import { Slider } from '../../../components/Slider/Slider';
import { useToolSettingsStore } from '../../tool-settings-store';

export function MarqueeOptions() {
  const marqueeFeather = useToolSettingsStore((s) => s.marqueeFeather);
  const setMarqueeFeather = useToolSettingsStore((s) => s.setMarqueeFeather);

  return (
    <>
      <AspectRatioControl />
      <Slider label="Feather" value={marqueeFeather} min={0} max={250} onChange={setMarqueeFeather} />
    </>
  );
}
