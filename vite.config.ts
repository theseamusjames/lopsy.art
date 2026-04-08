import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { resolve } from 'path';
import { statSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Vite plugin that checks whether the WASM build output is older than any
 * Rust/GLSL source file. Prints a warning at dev-server start so stale
 * builds are immediately obvious.
 */
function wasmFreshnessCheck(): Plugin {
  return {
    name: 'wasm-freshness-check',
    buildStart() {
      const root = resolve(__dirname);
      const wasmFile = join(root, 'src/engine-wasm/pkg/lopsy_wasm_bg.wasm');
      const srcDir = join(root, 'engine-rs/crates');

      let wasmMtime: number;
      try {
        wasmMtime = statSync(wasmFile).mtimeMs;
      } catch {
        this.warn(
          '\x1b[33m⚠ WASM build output not found. Run: npm run wasm:build\x1b[0m',
        );
        return;
      }

      const newerFiles: string[] = [];
      function walk(dir: string) {
        let entries: string[];
        try {
          entries = readdirSync(dir);
        } catch {
          return;
        }
        for (const entry of entries) {
          const full = join(dir, entry);
          try {
            const stat = statSync(full);
            if (stat.isDirectory()) {
              if (entry === 'target' || entry === 'pkg') continue;
              walk(full);
            } else if (/\.(rs|glsl|toml)$/.test(entry) && stat.mtimeMs > wasmMtime) {
              newerFiles.push(full.replace(root + '/', ''));
            }
          } catch {
            // skip
          }
        }
      }

      walk(srcDir);

      if (newerFiles.length > 0) {
        this.warn(
          `\x1b[33m⚠ WASM build is stale — ${newerFiles.length} source file(s) are newer than the WASM output.\n` +
          `  Run: npm run wasm:build\n` +
          `  Changed: ${newerFiles.slice(0, 5).join(', ')}${newerFiles.length > 5 ? ` (+${newerFiles.length - 5} more)` : ''}\x1b[0m`,
        );
      }
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [react(), wasm(), topLevelAwait(), wasmFreshnessCheck()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  css: {
    modules: {
      localsConvention: 'camelCaseOnly',
    },
  },
  define: {
    __FONT_ASSETS_URL__: JSON.stringify(process.env.FONT_ASSETS_URL ?? ''),
  },
  build: {
    chunkSizeWarningLimit: 750,
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        // Suppress eval warning from wasm-pack generated code
        if (warning.code === 'EVAL' && warning.id?.includes('lopsy_wasm')) return;
        // wasm-bridge is dynamically imported by engine-state for lazy init
        // but statically imported everywhere else — this is intentional
        if (warning.message?.includes('wasm-bridge.ts is dynamically imported')) return;
        defaultHandler(warning);
      },
    },
  },
});
