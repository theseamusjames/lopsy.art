/**
 * Helpers for the specs that run the drivers published in SKILL.md and
 * SKILL-UI.md: start one as a child process, and send it requests whose
 * headers `fetch` will not let a test set (Host, Origin, Sec-Fetch-Site).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { request } from 'node:http';
import { connect, createServer } from 'node:net';
import { networkInterfaces } from 'node:os';

export interface RawResponse {
  readonly status: number;
  readonly text: string;
}

export interface RawRequest {
  readonly method?: string;
  readonly path?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

/** One HTTP request to 127.0.0.1:port; `headers.host` replaces the Host header Node would send. */
export function rawRequest(port: number, { method = 'GET', path = '/', headers = {}, body }: RawRequest): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** This machine's first non-loopback IPv4 address, or null when it has none. */
export function lanAddress(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (!address.internal && address.family === 'IPv4') return address.address;
    }
  }
  return null;
}

/** 'connected', or the error code a TCP connection to host:port failed with. */
export function tryConnect(host: string, port: number): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    socket.setTimeout(5_000);
    socket.on('connect', () => {
      socket.destroy();
      resolve('connected');
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve('timeout');
    });
    socket.on('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? String(error)));
  });
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

export interface RunningDriver {
  readonly process: ChildProcess;
  readonly exited: Promise<number | null>;
  log(): string;
  isRunning(): boolean;
  kill(): void;
}

/** Starts `node driverPath`; its stdout and stderr collect in log(). */
export function spawnDriver(driverPath: string, cwd: string, env: Record<string, string>): RunningDriver {
  let log = '';
  const child = spawn(process.execPath, [driverPath], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
  child.stdout!.on('data', (chunk: Buffer) => { log += chunk.toString(); });
  child.stderr!.on('data', (chunk: Buffer) => { log += chunk.toString(); });
  const isRunning = () => child.exitCode === null && child.signalCode === null;
  return {
    process: child,
    exited,
    log: () => log,
    isRunning,
    kill: () => {
      if (isRunning()) child.kill('SIGKILL');
    },
  };
}

/** Headers a browser sends with a request a web page makes to the driver. */
export const FROM_A_WEB_PAGE: ReadonlyArray<{ readonly what: string; readonly headers: Record<string, string> }> = [
  { what: 'an Origin header', headers: { origin: 'https://evil.example' } },
  { what: 'Origin: null (a sandboxed page)', headers: { origin: 'null' } },
  { what: 'Sec-Fetch-Site: cross-site', headers: { 'sec-fetch-site': 'cross-site' } },
  { what: 'Sec-Fetch-Site: same-site', headers: { 'sec-fetch-site': 'same-site' } },
];

/** Host headers a request reaching the driver by DNS rebinding or from another machine carries. */
export function foreignHosts(port: number): string[] {
  return ['evil.example', `evil.example:${port}`, `192.168.0.10:${port}`, `127.0.0.1:${port + 1}`, `localhost.evil.example:${port}`];
}
