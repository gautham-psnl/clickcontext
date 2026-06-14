import { describe, it, expect } from 'vitest';
import { bookmarkletUrl } from '../cli/src/cli';

describe('bookmarkletUrl', () => {
  it('injects the token into the placeholder and builds a javascript: URL', () => {
    const code = 'var t="__UI_CONTEXT_TOKEN_PLACEHOLDER__";fetch("/x",{headers:{t}})';
    const url = bookmarkletUrl(code, 'deadbeef');
    const decoded = decodeURIComponent(url.slice('javascript:'.length));
    expect(url.startsWith('javascript:')).toBe(true);
    expect(decoded).toContain('"deadbeef"');
    expect(decoded).not.toContain('PLACEHOLDER');
  });

  it('replaces every occurrence of the placeholder', () => {
    const code = '__UI_CONTEXT_TOKEN_PLACEHOLDER__ and __UI_CONTEXT_TOKEN_PLACEHOLDER__';
    const decoded = decodeURIComponent(bookmarkletUrl(code, 'tok').slice('javascript:'.length));
    expect(decoded).toBe('tok and tok');
  });
});
