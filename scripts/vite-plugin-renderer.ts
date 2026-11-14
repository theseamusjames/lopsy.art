/**
 * Dev server only: lets one page load run either build of the engine.
 *
 *   /?renderer=wgpu    the wgpu build (src/engine-wasm/pkg-wgpu)
 *   /?renderer=webgl   the WebGL build (src/engine-wasm/pkg)
 *   neither            LOPSY_RENDERER, or WebGL when that is unset
 *
 * `wasm-bridge.ts` imports the engine package statically. Here that import
 * resolves to a generated module that awaits the chosen build and re-exports
 * it (src/engine-wasm/renderer-selector.ts). A production build never runs
 * this plugin, so it imports `pkg` directly and contains nothing of the wgpu
 * build.
 */
import type { Plugin } from 'vite';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { glueExportNames, parseRenderer, renderSelectorModule } from '../src/engine-wasm/renderer-selector';

const SELECTOR_ID = '\0lopsy-renderer-selector';
const BRIDGE = 'src/engine-wasm/wasm-bridge.ts';
const PACKAGE_IMPORT = './pkg/lopsy_wasm';
const WEBGL_GLUE = 'src/engine-wasm/pkg/lopsy_wasm.js';
const WGPU_GLUE = 'src/engine-wasm/pkg-wgpu/lopsy_wasm.js';

interface RendererPluginOptions {
  root: string;
}

export function rendererPlugin(options: RendererPluginOptions): Plugin {
  return {
    name: 'lopsy-renderer',
    apply: 'serve',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source !== PACKAGE_IMPORT || !importer) return null;
      const importerPath = importer.split('?')[0]?.replace(/\\/g, '/') ?? '';
      return importerPath.endsWith(BRIDGE) ? SELECTOR_ID : null;
    },
    configureServer(server) {
      // The selector lists the package's exports, so a rebuilt package
      // needs a new one. Vite does not tie a generated module to the files
      // it was made from.
      const glue = [join(options.root, WEBGL_GLUE), join(options.root, WGPU_GLUE)];
      const refresh = (file: string) => {
        if (!glue.includes(file)) return;
        const selector = server.moduleGraph.getModuleById(SELECTOR_ID);
        if (selector) server.moduleGraph.invalidateModule(selector);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.add(glue);
      server.watcher.on('add', refresh);
      server.watcher.on('change', refresh);
    },
    load(id) {
      if (id !== SELECTOR_ID) return null;
      const webglGlue = join(options.root, WEBGL_GLUE);
      return renderSelectorModule({
        exportNames: glueExportNames(readFileSync(webglGlue, 'utf8')),
        webglUrl: `/${WEBGL_GLUE}`,
        wgpuUrl: existsSync(join(options.root, WGPU_GLUE)) ? `/${WGPU_GLUE}` : null,
        defaultRenderer: parseRenderer(process.env.LOPSY_RENDERER) ?? 'webgl',
      });
    },
  };
}
