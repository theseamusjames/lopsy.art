import { describe, expect, it } from 'vitest';
import headers from '../../public/_headers?raw';

/** The policy the site is served with: public/_headers explains each host. */
describe('the Content-Security-Policy', () => {
  const policy = headers.split('\n').find((line) => line.trim().startsWith('Content-Security-Policy:')) ?? '';
  const directive = (name: string): string => policy.split(';').find((part) => part.trim().startsWith(`${name} `)) ?? '';

  it('lets the analytics Cloudflare adds at its edge run', () => {
    expect(directive('script-src')).toContain('https://static.cloudflareinsights.com');
    expect(directive('connect-src')).toContain('https://cloudflareinsights.com');
    // Zaraz is served from this origin, under /cdn-cgi/zaraz/.
    expect(directive('script-src')).toContain("'self'");
    expect(directive('connect-src')).toContain("'self'");
  });

  it('allows no advertising or third-party analytics host, and no inline scripts', () => {
    for (const host of ['doubleclick.net', 'googleadservices.com', 'googlesyndication.com', 'google.com/ads', 'googletagmanager.com', 'google-analytics.com', 'facebook', 'bing.com']) {
      expect(policy).not.toContain(host);
    }
    expect(directive('script-src')).not.toContain("'unsafe-inline'");
  });
});
