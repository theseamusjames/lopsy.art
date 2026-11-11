/**
 * Tutorial `.lopsy` projects live in R2, not git.
 *
 *   npm run tutorial:upload <slug> [<slug> ...]
 *     Uploads tutorials/<slug>/<file>.lopsy to R2 under a content-hashed key
 *     and writes that key into the tutorial's `project` frontmatter. The local
 *     file is gitignored; keep it or delete it. Skips the upload when the key
 *     is already in the bucket.
 *
 *   npm run tutorial:check
 *     Confirms every tutorial's `project` key is publicly served. CI runs
 *     this so a page never links to a project that isn't there.
 *
 * Upload credentials come from R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and
 * R2_SECRET_ACCESS_KEY, read from the environment or from ~/.config/lopsy/r2.env
 * (override with LOPSY_R2_ENV). Use an R2 token scoped to Object Read & Write
 * on the project bucket only. Never commit the values or print them.
 *
 * Runs on plain Node 22+ (built-in TypeScript type stripping), so it imports
 * src modules by their .ts path and those modules must not import anything.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setFrontmatterField } from '../src/site/tutorials/frontmatter-edit.ts';
import { signRequest, type SigningCredentials } from '../src/site/tutorials/r2-sign.ts';
import {
  PROJECT_FILES_BUCKET,
  PROJECT_KEY_PATTERN,
  hostedProjectKey,
  hostedProjectUrl,
} from '../src/site/tutorials/site-config.ts';

const TUTORIALS_DIR = resolve(import.meta.dirname, '..', 'tutorials');
const CHECK_CONCURRENCY = 16;

class UsageError extends Error {}

interface R2Config {
  endpoint: string;
  credentials: SigningCredentials;
}

function loadR2Config(): R2Config {
  const envFile = process.env.LOPSY_R2_ENV ?? join(homedir(), '.config', 'lopsy', 'r2.env');
  // Values already in the environment win over the file.
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const accountId = process.env.R2_ACCOUNT_ID ?? '';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? '';
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? '';
  const missing = [
    !accountId && 'R2_ACCOUNT_ID',
    !accessKeyId && 'R2_ACCESS_KEY_ID',
    !secretAccessKey && 'R2_SECRET_ACCESS_KEY',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new UsageError(`Missing ${missing.join(', ')}. Set them in ${envFile} or the environment.`);
  }
  return { endpoint: `https://${accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId, secretAccessKey } };
}

async function r2Request(
  config: R2Config,
  method: 'HEAD' | 'PUT',
  key: string,
  body?: Uint8Array,
  headers: Record<string, string> = {},
): Promise<Response> {
  const url = new URL(`${config.endpoint}/${PROJECT_FILES_BUCKET}/${key}`);
  const payloadHash = createHash('sha256').update(body ?? '').digest('hex');
  const signed = await signRequest(
    { method, url, headers, payloadHash, region: 'auto', service: 's3', date: new Date() },
    config.credentials,
  );
  return fetch(url, { method, headers: signed, body });
}

function projectFileFor(slug: string): string {
  const dir = join(TUTORIALS_DIR, slug);
  if (!existsSync(join(dir, 'index.md'))) throw new UsageError(`tutorials/${slug}/index.md does not exist.`);
  const projects = readdirSync(dir).filter((file) => file.toLowerCase().endsWith('.lopsy'));
  if (projects.length === 1 && projects[0]) return projects[0];
  if (projects.includes(`${slug}.lopsy`)) return `${slug}.lopsy`;
  throw new UsageError(
    projects.length === 0
      ? `tutorials/${slug} has no .lopsy file to upload. Save the project there as ${slug}.lopsy.`
      : `tutorials/${slug} has several .lopsy files; name the one to publish ${slug}.lopsy.`,
  );
}

async function upload(config: R2Config, slug: string): Promise<void> {
  const file = projectFileFor(slug);
  const bytes = readFileSync(join(TUTORIALS_DIR, slug, file));
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  const key = hostedProjectKey(slug, digest, file);

  const existing = await r2Request(config, 'HEAD', key);
  if (existing.status === 404) {
    const put = await r2Request(config, 'PUT', key, bytes, {
      'content-type': 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
    });
    if (!put.ok) throw new Error(`Uploading ${key} failed: HTTP ${put.status} ${await put.text()}`);
    const stored = await r2Request(config, 'HEAD', key);
    if (Number(stored.headers.get('content-length')) !== bytes.length) {
      throw new Error(`Uploaded ${key}, but the bucket reports a different size.`);
    }
    console.log(`Uploaded ${key} (${(bytes.length / 2 ** 20).toFixed(1)} MiB)`);
  } else if (existing.ok) {
    console.log(`Already in R2: ${key}`);
  } else {
    throw new Error(`Checking ${key} failed: HTTP ${existing.status}. Is the token scoped to ${PROJECT_FILES_BUCKET}?`);
  }

  const indexPath = join(TUTORIALS_DIR, slug, 'index.md');
  const updated = setFrontmatterField(readFileSync(indexPath, 'utf8'), 'project', key);
  if (updated === null) throw new Error(`tutorials/${slug}/index.md has no frontmatter block.`);
  writeFileSync(indexPath, updated);
  console.log(`tutorials/${slug}/index.md: project: ${key}`);
}

function projectKeys(): Array<{ slug: string; key: string }> {
  return readdirSync(TUTORIALS_DIR)
    .filter((slug) => !slug.startsWith('_') && !slug.startsWith('.'))
    .filter((slug) => existsSync(join(TUTORIALS_DIR, slug, 'index.md')))
    .flatMap((slug) => {
      const source = readFileSync(join(TUTORIALS_DIR, slug, 'index.md'), 'utf8');
      const frontmatter = source.split(/^---\s*$/m)[1] ?? '';
      const key = /^project:[ \t]*(\S*)[ \t]*$/m.exec(frontmatter)?.[1] ?? '';
      return key ? [{ slug, key }] : [];
    });
}

async function check(): Promise<boolean> {
  const queue = projectKeys();
  const total = queue.length;
  const failures: string[] = [];
  async function worker(): Promise<void> {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const { slug, key } = next;
      if (!PROJECT_KEY_PATTERN.test(key)) {
        failures.push(`tutorials/${slug}: "${key}" is not an R2 key; run npm run tutorial:upload ${slug}`);
        continue;
      }
      const response = await fetch(hostedProjectUrl(key), { method: 'HEAD' }).catch(() => null);
      if (!response?.ok) failures.push(`tutorials/${slug}: ${hostedProjectUrl(key)} -> ${response?.status ?? 'network error'}`);
    }
  }
  await Promise.all(Array.from({ length: CHECK_CONCURRENCY }, worker));
  for (const failure of failures.sort()) console.error(failure);
  console.log(`${total - failures.length}/${total} tutorial projects are served from R2.`);
  return failures.length === 0;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...slugs] = argv;
  if (command === 'check') return (await check()) ? 0 : 1;
  if (command === 'upload' && slugs.length > 0) {
    const config = loadR2Config();
    for (const slug of slugs) await upload(config, slug);
    return 0;
  }
  throw new UsageError('Usage: npm run tutorial:upload <slug> [<slug> ...] | npm run tutorial:check');
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(error instanceof UsageError ? 2 : 1);
  },
);
