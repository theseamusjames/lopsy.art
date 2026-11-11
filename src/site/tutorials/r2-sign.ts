/**
 * AWS Signature Version 4 for R2's S3-compatible API, so the tutorial upload
 * script can talk to the bucket without an SDK dependency. Uses Web Crypto,
 * which Node 22 and browsers both provide, and imports nothing else.
 */

export interface SigningCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface SignableRequest {
  method: string;
  url: URL;
  /** Headers to sign besides `host`, `x-amz-date` and `x-amz-content-sha256`. */
  headers: Record<string, string>;
  /** Hex SHA-256 of the body; the hash of the empty string for HEAD/GET. */
  payloadHash: string;
  region: string;
  service: string;
  date: Date;
}

const encoder = new TextEncoder();

function encodeRfc3986(text: string): string {
  return encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalUri(url: URL): string {
  return url.pathname
    .split('/')
    .map((segment) => encodeRfc3986(decodeURIComponent(segment)))
    .join('/');
}

function canonicalQuery(url: URL): string {
  return [...url.searchParams]
    .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
    .sort()
    .join('&');
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(data: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  return toHex(await crypto.subtle.digest('SHA-256', bytes));
}

async function hmac(key: ArrayBuffer | Uint8Array<ArrayBuffer>, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

export function amzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Returns the request's headers plus `x-amz-date`, `x-amz-content-sha256` and `authorization`. */
export async function signRequest(
  request: SignableRequest,
  credentials: SigningCredentials,
): Promise<Record<string, string>> {
  const timestamp = amzDate(request.date);
  const day = timestamp.slice(0, 8);
  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k.toLowerCase(), v.trim()])),
    host: request.url.host,
    'x-amz-date': timestamp,
    'x-amz-content-sha256': request.payloadHash,
  };
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    request.method,
    canonicalUri(request.url),
    canonicalQuery(request.url),
    names.map((name) => `${name}:${headers[name]}\n`).join(''),
    signedHeaders,
    request.payloadHash,
  ].join('\n');

  const scope = `${day}/${request.region}/${request.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', timestamp, scope, await sha256Hex(canonicalRequest)].join('\n');
  const dateKey = await hmac(encoder.encode(`AWS4${credentials.secretAccessKey}`), day);
  const regionKey = await hmac(dateKey, request.region);
  const serviceKey = await hmac(regionKey, request.service);
  const signingKey = await hmac(serviceKey, 'aws4_request');
  const signature = toHex(await hmac(signingKey, stringToSign));

  const { host: _host, ...sent } = headers;
  return {
    ...sent,
    authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
