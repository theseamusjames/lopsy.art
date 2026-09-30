import { describe, expect, it } from 'vitest';
import { resolveOpenProjectUrl, searchWithoutOpenParam } from './project-url';

const PAGE = 'https://lopsy.art/?open=x';

describe('resolveOpenProjectUrl', () => {
  it('resolves a path against the page origin', () => {
    const url = resolveOpenProjectUrl('?open=%2Ftutorials%2Fneon%2Fneon.lopsy', PAGE);
    expect(url?.href).toBe('https://lopsy.art/tutorials/neon/neon.lopsy');
  });

  it('accepts an absolute http(s) URL', () => {
    expect(resolveOpenProjectUrl('?open=https://example.com/a.lopsy', PAGE)?.href).toBe('https://example.com/a.lopsy');
  });

  it('ignores a missing, blank or non-http parameter', () => {
    expect(resolveOpenProjectUrl('', PAGE)).toBeNull();
    expect(resolveOpenProjectUrl('?lighthouse', PAGE)).toBeNull();
    expect(resolveOpenProjectUrl('?open=%20', PAGE)).toBeNull();
    expect(resolveOpenProjectUrl('?open=javascript:alert(1)', PAGE)).toBeNull();
    expect(resolveOpenProjectUrl('?open=data:application/octet-stream,LOPSY', PAGE)).toBeNull();
  });
});

describe('searchWithoutOpenParam', () => {
  it('drops only the open parameter', () => {
    expect(searchWithoutOpenParam('?open=%2Fa.lopsy')).toBe('');
    expect(searchWithoutOpenParam('?lighthouse&open=%2Fa.lopsy&b=1')).toBe('?lighthouse&b=1');
  });
});
