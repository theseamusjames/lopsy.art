/**
 * Publishes repository Markdown files at the site root (e.g. SKILL.md →
 * https://lopsy.art/SKILL.md) so agents can fetch the same documents that
 * live in the repo. `public/llms.txt` points at them.
 *
 *   dev:   served from disk on every request, so edits show up immediately.
 *   build: emitted into dist/ unchanged.
 */
import type { Plugin } from 'vite';
import { readFileSync } from 'fs';
import { join } from 'path';

interface AgentDocsPluginOptions {
  root: string;
  files: readonly string[];
}

export function agentDocsPlugin(options: AgentDocsPluginOptions): Plugin {
  let isBuild = false;
  const read = (file: string) => readFileSync(join(options.root, file), 'utf8');
  return {
    name: 'lopsy-agent-docs',
    configResolved(config) {
      isBuild = config.command === 'build';
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? '';
        const file = options.files.find((f) => path === `/${f}`);
        if (!file) return next();
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(read(file));
      });
    },
    generateBundle() {
      if (!isBuild) return;
      for (const file of options.files) {
        this.emitFile({ type: 'asset', fileName: file, source: read(file) });
      }
    },
  };
}
