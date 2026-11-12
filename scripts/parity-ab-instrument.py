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
