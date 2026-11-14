"""Temporarily instrument e2e specs for an engine A/B comparison.

The parity compositions (npm run parity:check) do not reach every tool.
When a PR changes how a group of tools renders, this script instruments
the specs that exercise them so the old and new engine can be compared
checkpoint by checkpoint. See docs/engine-migration-plan.md, "A/B on a
cluster".

usage: python3 scripts/parity-ab-instrument.py <spec-name>...
       (spec names without the .spec.ts suffix, run from the repo root)

After each `await page.screenshot(...)` line and after each test, the
instrumented spec records, when PARITY_OUT is set:
  - the engine's export composite and a hash of every layer (e2e/parity.ts)
  - the canvas pixels, which also show what is drawn only to the screen

Set PARITY_PIN_RANDOM=1 when running the instrumented specs to replace
Math.random in the page with a fixed sequence. Filters that take a random
seed (Add Noise, Clouds, Smoke, Fibers), spray and brush scatter then
repeat exactly, so they can be compared too.

Set PARITY_READS=1 to also record what the engine hands back to the app
rather than draws: the composite, layer and channel thumbnails and the
selection and quick-mask readbacks.

The edits are not meant to be committed. Revert with: git checkout -- e2e
"""
import re, sys
root, specs = '.', sys.argv[1:]
if not specs:
    sys.exit(__doc__)
for name in specs:
    f = f'{root}/e2e/{name}.spec.ts'
    src = open(f).read().split('\n')
    last_import = max(i for i, l in enumerate(src) if l.startswith('import '))
    j = last_import
    while not src[j].rstrip().endswith(';'): j += 1
    helper = f"""// TEMP A/B instrumentation — not for commit
import {{ parityCheckpoint as __parity }} from './parity';
import {{ test as __pwTest }} from '@playwright/test';
import {{ mkdirSync as __mk, writeFileSync as __wf }} from 'node:fs';
let __n = 0;
async function __pc(page: import('@playwright/test').Page, tag = 'shot'): Promise<void> {{
  const out = process.env.PARITY_OUT;
  if (!out) return;
  const title = __pwTest.info().title.replace(/[^a-z0-9]+/gi, '-').slice(0, 60);
  const id = `${{title}}-${{String(__n++).padStart(2, '0')}}-${{tag}}`;
  const canvas = await page.evaluate(async () => {{
    const read = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      (() => Promise<{{ width: number; height: number; pixels: number[] }} | null>) | undefined;
    if (!read) return null;
    const r = await read();
    if (!r) return null;
    let binary = '';
    const bytes = Uint8Array.from(r.pixels);
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return {{ width: r.width, height: r.height, b64: btoa(binary) }};
  }}).catch(() => null);
  if (canvas) {{
    const dir = `${{out}}/{name}`;
    __mk(dir, {{ recursive: true }});
    __wf(`${{dir}}/${{id}}-canvas.rgba`, Buffer.from(canvas.b64, 'base64'));
    __wf(`${{dir}}/${{id}}-canvas.json`, JSON.stringify({{ width: canvas.width, height: canvas.height, layers: [] }}));
  }}
  await __parity(page, '{name}', id).catch(() => undefined);
  if (process.env.PARITY_READS) {{
    const reads = await page.evaluate(async () => {{
      const w = window as unknown as {{
        __editorStore: {{ getState: () => {{ document: {{ layerOrder: string[]; layers: Array<{{ id: string; name: string }}> }} }} }};
        __engineState: {{ getEngine: () => unknown }};
        __wasmBridge: Record<string, (...args: unknown[]) => Uint8Array>;
      }};
      const sha = async (bytes: Uint8Array): Promise<string> => {{
        const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource));
        return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
      }};
      const engine = w.__engineState.getEngine();
      const br = w.__wasmBridge;
      const doc = w.__editorStore.getState().document;
      const out: Array<{{ name: string; sha256: string }}> = [];
      out.push({{ name: 'composite-thumbnail', sha256: await sha(await br.readCompositeThumbnail(engine, 256)) }});
      out.push({{ name: 'selection-mask', sha256: await sha(await br.readSelectionMask(engine)) }});
      out.push({{ name: 'quick-mask', sha256: await sha(br.readQuickMaskPixels(engine)) }});
      for (const [i, id] of doc.layerOrder.entries()) {{
        out.push({{ name: `layer-thumbnail:${{i}}`, sha256: await sha(await br.readLayerThumbnail(engine, id, 64)) }});
        for (let c = 0; c < 4; c++) {{
          out.push({{ name: `channel-thumbnail:${{i}}:${{c}}`, sha256: await sha(await br.readChannelThumbnail(engine, id, c, 64)) }});
        }}
      }}
      return out;
    }}).catch(() => null);
    if (reads) {{
      const dir = `${{out}}/{name}`;
      __mk(dir, {{ recursive: true }});
      __wf(`${{dir}}/${{id}}-reads.rgba`, Buffer.alloc(0));
      __wf(`${{dir}}/${{id}}-reads.json`, JSON.stringify({{ width: 0, height: 0, layers: reads.map((r) => ({{ ...r, type: 'read', x: 0, y: 0, width: 0, height: 0 }})) }}));
    }}
  }}
}}
__pwTest.afterEach(async ({{ page }}) => {{ await __pc(page, 'end'); }});
__pwTest.beforeEach(async ({{ page }}) => {{
  if (!process.env.PARITY_PIN_RANDOM) return;
  await page.addInitScript(() => {{
    let a = 0x9e3779b9;
    Math.random = () => {{
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }};
  }});
}});""".split('\n')
    out, n = [], 0
    for i, l in enumerate(src):
        out.append(l)
        if i == j: out.extend(helper)
        if re.search(r'^\s*await page\.screenshot\(.*\);\s*$', l):
            n += 1
            out.append(re.match(r'^\s*', l).group(0) + 'await __pc(page);')
    open(f, 'w').write('\n'.join(out))
    print(name, 'screenshot checkpoints:', n)
