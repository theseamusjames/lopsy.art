import { useToolSettingsStore } from '../../tool-settings-store';
import { useEditorStore } from '../../editor-store';
import { Slider } from '../../../components/Slider/Slider';
import { docScaledMax } from '../../../utils/slider-ranges';

export function SprayOptions() {
  const spraySize = useToolSettingsStore((s) => s.settings.spray.size);
  const sprayDensity = useToolSettingsStore((s) => s.settings.spray.density);
  const sprayOpacity = useToolSettingsStore((s) => s.settings.spray.opacity);
  const sprayHardness = useToolSettingsStore((s) => s.settings.spray.hardness);
  const setSpraySetting = useToolSettingsStore((s) => s.setSpraySetting);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const sizeMax = docScaledMax(docWidth, docHeight, 500);

  return (
    <>
      <Slider label="Size" value={spraySize} min={1} max={sizeMax} sliderMax={500} onChange={(v) => setSpraySetting('size', v)} />
      <Slider label="Density" value={sprayDensity} min={1} max={100} onChange={(v) => setSpraySetting('density', v)} />
      <Slider label="Opacity" value={sprayOpacity} min={1} max={100} onChange={(v) => setSpraySetting('opacity', v)} />
      <Slider label="Softness" value={sprayHardness} min={0} max={100} onChange={(v) => setSpraySetting('hardness', v)} />
    </>
  );
}
