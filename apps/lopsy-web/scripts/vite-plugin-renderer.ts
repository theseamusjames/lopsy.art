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
 *
 * The defaults are Lopsy's; Photonamous passes its own import, choice
 * module and default (`RendererPluginOptions`).
 */
import type { Plugin } from 'vite';
import { existsSync, readFileSync } from 'fs';
import { isAbsolute, join } from 'path';
import { parseRenderer, type Renderer } from '../src/engine-wasm/renderer-choice';
import { glueExports, renderSelectorModule } from '../src/engine-wasm/renderer-selector';

const SELECTOR_ID = '\0lopsy-renderer-selector';
const ENGINE_WASM = 'src/engine-wasm';
const BRIDGE = `${ENGINE_WASM}/wasm-bridge.ts`;
const PACKAGE_IMPORT = './pkg/lopsy_wasm';
const WEBGL_GLUE = `${ENGINE_WASM}/pkg/lopsy_wasm.js`;
const WGPU_GLUE = `${ENGINE_WASM}/pkg-wgpu/lopsy_wasm.js`;
const CHOICE = `${ENGINE_WASM}/renderer-choice.ts`;

/**
 * Everything but `root` has Lopsy's value by default. Photonamous uses the
 * same plugin with its own (apps/photonamous/vite.config.ts).
 */
export interface RendererPluginOptions {
  /** The directory the other paths are relative to. */
  root: string;
  /**
   * Whether an import of `source` by `importer` (a path, query removed) is
   * of the engine package and goes to the selector. Lopsy: `./pkg/lopsy_wasm`
   * imported by wasm-bridge.ts.
   */
  isEngineImport?: (source: string, importer: string) => boolean;
  /** The WebGL build's JS glue. */
  webglGlue?: string;
  /** The wgpu build's JS glue; the selector offers WebGL only when it does not exist. */
  wgpuGlue?: string;
  /**
   * The module that decides (renderer-choice.ts in Lopsy): it exports
   * `requestedRenderer(fallback, hasWgpuBuild)`, `canUseWebGpu()` and
   * `noteRunningRenderer(renderer)`, and `setWebglFallback` with `fallsBackInPage`.
   */
  choice?: string;
  /** What a page that names no renderer gets. Lopsy: LOPSY_RENDERER, else WebGL. */
  defaultRenderer?: Renderer;
  /** See `SelectorOptions.fallsBackInPage`. Lopsy reloads instead. */
  fallsBackInPage?: boolean;
}

function isLopsyBridgeImport(source: string, importer: string): boolean {
  return source === PACKAGE_IMPORT && importer.endsWith(BRIDGE);
}

export function rendererPlugin(options: RendererPluginOptions): Plugin {
  const path = (file: string) => (isAbsolute(file) ? file : join(options.root, file)).replace(/\\/g, '/');
  const isEngineImport = options.isEngineImport ?? isLopsyBridgeImport;
  const webglGlue = path(options.webglGlue ?? WEBGL_GLUE);
  const wgpuGlue = path(options.wgpuGlue ?? WGPU_GLUE);
  const choice = path(options.choice ?? CHOICE);
  return {
    name: 'lopsy-renderer',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer) return null;
      const importerPath = importer.split('?')[0]?.replace(/\\/g, '/') ?? '';
      return isEngineImport(source, importerPath) ? SELECTOR_ID : null;
    },
    configureServer(server) {
      // The selector lists the package's exports, so a rebuilt package
      // needs a new one. Vite does not tie a generated module to the files
      // it was made from.
      const glue = [webglGlue, wgpuGlue];
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
        exports: glueExports(readFileSync(webglGlue, 'utf8')),
        webglUrl: webglGlue,
        wgpuUrl: existsSync(wgpuGlue) ? wgpuGlue : null,
        choiceUrl: choice,
        defaultRenderer: options.defaultRenderer ?? parseRenderer(process.env.LOPSY_RENDERER) ?? 'webgl',
        fallsBackInPage: options.fallsBackInPage ?? false,
      });
    },
  };
}
