import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { ColorWheel } from '../../../components/ColorWheel/ColorWheel';
import { ColorPicker } from '../../../components/ColorPicker/ColorPicker';
import { GradientEditor } from '../../../components/GradientEditor/GradientEditor';
import { IconButton } from '../../../components/IconButton/IconButton';
import { Slider } from '../../../components/Slider/Slider';
import { DEFAULT_GRADE_BLENDING, DEFAULT_TONE_STOPS } from '../../../filters/color-grading';
import type { GradientStop } from '../../../tools/gradient/gradient';
import type { Color } from '../../../types';
import type { ColorGradeWheel, ColorGradingNode } from '../../../types/adjustment-nodes';
import type { NodeControlProps } from './types';
import styles from '../AdjustmentsPanel.module.css';

type WheelKey = 'shadows' | 'midtones' | 'highlights' | 'global';

const WHEELS: readonly { key: WheelKey; label: string }[] = [
  { key: 'shadows', label: 'Shadows' },
  { key: 'midtones', label: 'Midtones' },
  { key: 'highlights', label: 'Highlights' },
  { key: 'global', label: 'Global' },
];

/** The bar's fixed axis: shadows at the left, highlights at the right. */
const TONE_AXIS = 'linear-gradient(to right, #000, #fff)';

type GradeMode = 'wheels' | 'bar';

const MODES: readonly { key: GradeMode; label: string }[] = [
  { key: 'wheels', label: 'Wheels' },
  { key: 'bar', label: 'Tone bar' },
];

export function ColorGradingControls(props: NodeControlProps<ColorGradingNode>) {
  const { node, onChange } = props;
  const mode: GradeMode = node.toneStops ? 'bar' : 'wheels';
  const handleMode = (next: GradeMode) => {
    if (next === mode) return;
    onChange({ toneStops: next === 'bar' ? DEFAULT_TONE_STOPS : undefined });
  };
  return (
    <div className={styles.sliders}>
      <div className={styles.gradeTabs} role="tablist" aria-label="Color grading mode">
        {MODES.map(({ key, label }) => (
          <button key={key} type="button" role="tab"
            aria-selected={mode === key}
            className={`${styles.gradeTab} ${mode === key ? styles.gradeTabActive : ''}`}
            onClick={() => handleMode(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {node.toneStops
        ? <ToneStopControls {...props} toneStops={node.toneStops} />
        : <WheelControls {...props} />}
    </div>
  );
}

/**
 * Tone stops on a black-to-white bar. A stop tints the tones at its position
 * with its colour; the picker below edits the selected stop's colour, and
 * Blend sets how sharply one stop hands over to the next.
 */
function ToneStopControls({ node, onChange, toneStops }: NodeControlProps<ColorGradingNode> & {
  toneStops: readonly GradientStop[];
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const sorted = [...toneStops].sort((a, b) => a.position - b.position);
  const index = Math.min(selectedIndex, sorted.length - 1);
  const selectedStop = sorted[index];

  const handleColorChange = (color: Color) => {
    onChange({ toneStops: sorted.map((stop, i) => (i === index ? { ...stop, color } : stop)) });
  };
  const handleDelete = () => {
    if (sorted.length <= 2) return;
    onChange({ toneStops: sorted.filter((_, i) => i !== index) });
    setSelectedIndex(Math.min(index, sorted.length - 2));
  };

  return (
    <div className={styles.gradientMapSection}>
      <GradientEditor
        stops={sorted}
        selectedIndex={index}
        onStopsChange={(stops) => onChange({ toneStops: stops })}
        onSelectStop={setSelectedIndex}
        barBackground={TONE_AXIS}
        label="Tone"
      />
      <div className={styles.gradientStopInfo}>
        {selectedStop && (
          <>
            <span>Stop {index + 1} of {sorted.length}</span>
            <span>Tone: {Math.round(selectedStop.position * 100)}%</span>
            <IconButton
              icon={<Trash2 size={12} />}
              label="Delete stop"
              onClick={handleDelete}
              disabled={sorted.length <= 2}
            />
          </>
        )}
      </div>
      {selectedStop && <ColorPicker color={selectedStop.color} onChange={handleColorChange} />}
      <Slider label="Blend" value={node.blending} min={0} max={100} step={1} defaultValue={DEFAULT_GRADE_BLENDING}
        onChange={(v) => onChange({ blending: v })} />
    </div>
  );
}

function WheelControls({ node, onChange }: NodeControlProps<ColorGradingNode>) {
  const [selected, setSelected] = useState<WheelKey>('midtones');
  const wheel = node[selected];
  const updateWheel = (key: WheelKey, params: Partial<ColorGradeWheel>) =>
    onChange({ [key]: { ...node[key], ...params } });
  return (
    <div className={styles.sliders}>
      <div className={styles.gradeWheels}>
        {WHEELS.map(({ key, label }) => (
          <ColorWheel
            key={key}
            label={label}
            hue={node[key].hue}
            saturation={node[key].saturation}
            isActive={selected === key}
            onActivate={() => setSelected(key)}
            onChange={(hue, saturation) => updateWheel(key, { hue, saturation })}
          />
        ))}
      </div>
      <div className={styles.gradeTabs} role="tablist" aria-label="Tone range">
        {WHEELS.map(({ key, label }) => (
          <button key={key} type="button" role="tab"
            aria-selected={selected === key}
            className={`${styles.gradeTab} ${selected === key ? styles.gradeTabActive : ''}`}
            onClick={() => setSelected(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <Slider label="Hue" value={wheel.hue} min={0} max={360} step={1} defaultValue={0} suffix="°"
        onChange={(v) => updateWheel(selected, { hue: v })} />
      <Slider label="Saturation" value={wheel.saturation} min={0} max={100} step={1} defaultValue={0}
        onChange={(v) => updateWheel(selected, { saturation: v })} />
      <Slider label="Luminance" value={wheel.luminance} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => updateWheel(selected, { luminance: v })} />
      <div className={styles.gradeDivider} />
      <Slider label="Blending" value={node.blending} min={0} max={100} step={1} defaultValue={DEFAULT_GRADE_BLENDING}
        onChange={(v) => onChange({ blending: v })} />
      <Slider label="Balance" value={node.balance} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ balance: v })} />
    </div>
  );
}
