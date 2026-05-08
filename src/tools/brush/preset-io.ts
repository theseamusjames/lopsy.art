import type { BrushPreset, BrushTipData } from '../../types/brush';
import { useToolSettingsStore } from '../../app/tool-settings-store';

interface SerializedTip {
  width: number;
  height: number;
  data: string;
}

interface SerializedPreset {
  name: string;
  tip: SerializedTip | null;
  size: number;
  hardness: number;
  spacing: number;
  scatter: number;
  angle: number;
  opacity: number;
  flow: number;
  sizeJitter?: number;
  hardnessJitter?: number;
  angleJitter?: number;
  opacityJitter?: number;
  speedSize?: number;
  speedSizeInvert?: boolean;
  speedSensitivity?: 'low' | 'med' | 'high';
  fade?: number;
  taper?: number;
}

function tipToJson(tip: BrushTipData): SerializedTip {
  let binary = '';
  for (let i = 0; i < tip.data.length; i++) {
    binary += String.fromCharCode(tip.data[i]!);
  }
  return { width: tip.width, height: tip.height, data: btoa(binary) };
}

function tipFromJson(s: SerializedTip): BrushTipData {
  const binary = atob(s.data);
  const data = new Uint8ClampedArray(binary.length);
  for (let i = 0; i < binary.length; i++) {
    data[i] = binary.charCodeAt(i);
  }
  return { width: s.width, height: s.height, data };
}

let nextImportId = 1;

export function exportPresets(): void {
  const state = useToolSettingsStore.getState();
  const customs = state.presets.filter((p) => p.isCustom);
  if (customs.length === 0) return;

  const serialized: SerializedPreset[] = customs.map((p) => ({
    name: p.name,
    tip: p.tip ? tipToJson(p.tip) : null,
    size: p.size,
    hardness: p.hardness,
    spacing: p.spacing,
    scatter: p.scatter,
    angle: p.angle,
    opacity: p.opacity,
    flow: p.flow,
    sizeJitter: p.sizeJitter,
    hardnessJitter: p.hardnessJitter,
    angleJitter: p.angleJitter,
    opacityJitter: p.opacityJitter,
    speedSize: p.speedSize,
    speedSizeInvert: p.speedSizeInvert,
    speedSensitivity: p.speedSensitivity,
    fade: p.fade,
    taper: p.taper,
  }));

  const json = JSON.stringify({ version: 1, presets: serialized }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'lopsy-brushes.json';
  a.click();
  URL.revokeObjectURL(url);
}

export async function importPresets(): Promise<number> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { resolve(0); return; }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result as string) as { version: number; presets: SerializedPreset[] };
          const presets: BrushPreset[] = parsed.presets.map((s) => ({
            id: `imported-${nextImportId++}`,
            name: s.name,
            tip: s.tip ? tipFromJson(s.tip) : null,
            size: s.size,
            hardness: s.hardness,
            spacing: s.spacing,
            scatter: s.scatter,
            angle: s.angle,
            opacity: s.opacity,
            flow: s.flow,
            isCustom: true,
            sizeJitter: s.sizeJitter,
            hardnessJitter: s.hardnessJitter,
            angleJitter: s.angleJitter,
            opacityJitter: s.opacityJitter,
            speedSize: s.speedSize,
            speedSizeInvert: s.speedSizeInvert,
            speedSensitivity: s.speedSensitivity,
            fade: s.fade,
            taper: s.taper,
          }));
          useToolSettingsStore.getState().addPresets(presets);
          resolve(presets.length);
        } catch {
          resolve(0);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  });
}
