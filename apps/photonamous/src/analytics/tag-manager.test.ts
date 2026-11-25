// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import headers from '../../public/_headers?raw';
import { startTagManager, tagManagerId } from './tag-manager';

afterEach(() => {
  document.head.innerHTML = '';
  Reflect.deleteProperty(window, 'dataLayer');
});

describe('tagManagerId', () => {
  it('takes a container ID and nothing else', () => {
    expect(tagManagerId('GTM-ABC1234')).toBe('GTM-ABC1234');
    expect(tagManagerId(' GTM-ABC1234 ')).toBe('GTM-ABC1234');
    expect(tagManagerId(undefined)).toBeNull();
    expect(tagManagerId('')).toBeNull();
    expect(tagManagerId('G-ABC1234')).toBeNull();
    expect(tagManagerId('GTM-ABC1234&l=other')).toBeNull();
    expect(tagManagerId('GTM-abc1234')).toBeNull();
  });
});

describe('startTagManager', () => {
  it('does nothing without a container ID', () => {
    expect(startTagManager(undefined)).toBe(false);
    expect(startTagManager('not-an-id')).toBe(false);
    expect(document.querySelector('script')).toBeNull();
    expect(Reflect.get(window, 'dataLayer')).toBeUndefined();
  });

  it('sets up the data layer, sends the js command and loads the container', () => {
    expect(startTagManager('GTM-ABC1234')).toBe(true);

    const script = document.querySelector('script');
    expect(script?.getAttribute('src')).toBe('https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234');
    expect(script?.async).toBe(true);

    const dataLayer: unknown = Reflect.get(window, 'dataLayer');
    expect(Array.isArray(dataLayer)).toBe(true);
    const first: unknown = Array.isArray(dataLayer) ? dataLayer[0] : null;
    // An `arguments` object, which is how Google's tag knows a command from data.
    expect(Object.prototype.toString.call(first)).toBe('[object Arguments]');
    expect(Reflect.get(first ?? {}, '0')).toBe('js');
    expect(Reflect.get(first ?? {}, '1')).toBeInstanceOf(Date);
  });

  it('keeps what is already in the data layer, and starts only once', () => {
    Reflect.set(window, 'dataLayer', [{ event: 'earlier' }]);
    expect(startTagManager('GTM-ABC1234')).toBe(true);
    expect(startTagManager('GTM-ABC1234')).toBe(false);
    expect(document.querySelectorAll('script')).toHaveLength(1);
    const dataLayer: unknown = Reflect.get(window, 'dataLayer');
    expect(Array.isArray(dataLayer) ? dataLayer.length : 0).toBe(2);
  });
});

describe('the Content-Security-Policy', () => {
  const policy = headers.split('\n').find((line) => line.trim().startsWith('Content-Security-Policy:')) ?? '';
  const directive = (name: string): string => policy.split(';').find((part) => part.trim().startsWith(`${name} `)) ?? '';

  it('lets Tag Manager load and Analytics be reached', () => {
    expect(directive('script-src')).toContain('https://*.googletagmanager.com');
    expect(directive('connect-src')).toContain('https://*.google-analytics.com');
    expect(directive('connect-src')).toContain('https://*.analytics.google.com');
    expect(directive('img-src')).toContain('https://*.google-analytics.com');
  });

  it('allows no advertising host, whatever the container is set to do', () => {
    for (const host of ['doubleclick.net', 'googleadservices.com', 'googlesyndication.com', 'google.com/ads', 'facebook', 'bing.com']) {
      expect(policy).not.toContain(host);
    }
    expect(directive('script-src')).not.toContain("'unsafe-inline'");
  });
});
