import { describe, expect, it } from 'vitest';
import { amzDate, sha256Hex, signRequest } from './r2-sign';

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('signRequest', () => {
  // The "GET Object" example from AWS's Signature Version 4 documentation for S3.
  it('matches the published S3 GET Object example', async () => {
    const headers = await signRequest(
      {
        method: 'GET',
        url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
        headers: { Range: 'bytes=0-9' },
        payloadHash: EMPTY_SHA256,
        region: 'us-east-1',
        service: 's3',
        date: new Date('2013-05-24T00:00:00Z'),
      },
      { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
    );
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
    expect(headers['x-amz-date']).toBe('20130524T000000Z');
    expect(headers['x-amz-content-sha256']).toBe(EMPTY_SHA256);
    expect(headers.host).toBeUndefined();
  });

  it('signs the same request identically whatever the header case', async () => {
    const base = {
      method: 'PUT',
      url: new URL('https://acct.r2.cloudflarestorage.com/bucket/tutorials/a/0123456789ab/a.lopsy'),
      payloadHash: EMPTY_SHA256,
      region: 'auto',
      service: 's3',
      date: new Date('2026-11-10T12:00:00Z'),
    };
    const keys = { accessKeyId: 'id', secretAccessKey: 'secret' };
    const lower = await signRequest({ ...base, headers: { 'content-type': 'application/octet-stream' } }, keys);
    const upper = await signRequest({ ...base, headers: { 'Content-Type': 'application/octet-stream' } }, keys);
    expect(upper.authorization).toBe(lower.authorization);
  });
});

describe('sha256Hex', () => {
  it('hashes strings and bytes alike', async () => {
    expect(await sha256Hex('')).toBe(EMPTY_SHA256);
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('amzDate', () => {
  it('formats a basic ISO 8601 timestamp without milliseconds', () => {
    expect(amzDate(new Date('2026-11-10T22:05:09.123Z'))).toBe('20261110T220509Z');
  });
});
