/**
 * Lets one page load run either build of the engine.
 *
 *   /?renderer=wgpu    the wgpu build (src/engine-wasm/pkg-wgpu)
 *   /?renderer=webgl   the WebGL build (src/engine-wasm/pkg)
 *   neither            the choice stored by View > Renderer, else
 *                      LOPSY_RENDERER, else WebGL
 *
 * `wasm-bridge.ts` imports the engine package statically. Here that import
 * resolves to a generated module that holds the WebGL package and calls
 * the wgpu one instead when the page asks for it
 * (src/engine-wasm/renderer-selector.ts). A page that runs WebGL fetches
 * nothing of the wgpu build.
 *
 * `npm run wasm:build:wgpu` builds the wgpu package. Without it the
 * selector offers WebGL only.
 */
import type { Plugin } from 'vite';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseRenderer } from '../src/engine-wasm/renderer-choice';
import { glueExports, renderSelectorModule } from '../src/engine-wasm/renderer-selector';

const SELECTOR_ID = '\0lopsy-renderer-selector';
const BRIDGE = 'src/engine-wasm/wasm-bridge.ts';
const PACKAGE_IMPORT = './pkg/lopsy_wasm';
const WEBGL_GLUE = 'src/engine-wasm/pkg/lopsy_wasm.js';
const WGPU_GLUE = 'src/engine-wasm/pkg-wgpu/lopsy_wasm.js';
const CHOICE = 'src/engine-wasm/renderer-choice.ts';

interface RendererPluginOptions {
  root: string;
}

export function rendererPlugin(options: RendererPluginOptions): Plugin {
  const path = (file: string) => join(options.root, file).replace(/\\/g, '/');
  return {
    name: 'lopsy-renderer',
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
      const glue = [path(WEBGL_GLUE), path(WGPU_GLUE)];
      const refresh = (file: string) => {
        if (!glue.includes(file.replace(/\\/g, '/'))) return;
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
      return renderSelectorModule({
        exports: glueExports(readFileSync(path(WEBGL_GLUE), 'utf8')),
        webglUrl: path(WEBGL_GLUE),
        wgpuUrl: existsSync(path(WGPU_GLUE)) ? path(WGPU_GLUE) : null,
        choiceUrl: path(CHOICE),
        defaultRenderer: parseRenderer(process.env.LOPSY_RENDERER) ?? 'webgl',
      });
    },
  };
}
