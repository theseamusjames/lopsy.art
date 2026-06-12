import { Slider } from '../../../components/Slider/Slider';
import type { ChannelMixerNode } from '../../../types/adjustment-nodes';
import type { NodeControlProps } from './types';
import styles from '../AdjustmentsPanel.module.css';

export function ChannelMixerControls({ node, onChange }: NodeControlProps<ChannelMixerNode>) {
  return (
    <div className={styles.sliders}>
      <div className={styles.channelTabs} role="tablist" aria-label="Output channel">
        {(['red', 'green', 'blue'] as const).map((ch) => (
          <button key={ch} type="button" role="tab"
            aria-selected={node.outputChannel === ch}
            className={`${styles.channelTab} ${node.outputChannel === ch ? styles.channelTabActive : ''}`}
            style={{ '--channel-color': ch === 'red' ? '#ff5e5e' : ch === 'green' ? '#5eff7e' : '#5e9eff' } as React.CSSProperties}
            onClick={() => onChange({ outputChannel: ch })}
          >
            {ch.charAt(0).toUpperCase()}
          </button>
        ))}
      </div>
      <Slider label="Red" value={node.red} min={-200} max={200} step={1} defaultValue={node.outputChannel === 'red' ? 100 : 0}
        onChange={(v) => onChange({ red: v })} />
      <Slider label="Green" value={node.green} min={-200} max={200} step={1} defaultValue={node.outputChannel === 'green' ? 100 : 0}
        onChange={(v) => onChange({ green: v })} />
      <Slider label="Blue" value={node.blue} min={-200} max={200} step={1} defaultValue={node.outputChannel === 'blue' ? 100 : 0}
        onChange={(v) => onChange({ blue: v })} />
      <Slider label="Constant" value={node.constant} min={-200} max={200} step={1} defaultValue={0}
        onChange={(v) => onChange({ constant: v })} />
    </div>
  );
}
