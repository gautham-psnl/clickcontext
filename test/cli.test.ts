import { describe, it, expect } from 'vitest';
import { bookmarkletUrl } from '../cli/src/cli';
import { patchNextConfig } from '../cli/src/init';

describe('patchNextConfig', () => {
  const ESM_SEMICOLON = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    loader: "custom",
    loaderFile: "./lib/sanity/image-loader.ts",
  },
};

export default nextConfig;
`;

  // CJS with bare `}` — the innovin-website shape that was failing
  const CJS_NO_SEMICOLON = `/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.sanity.io',
      },
    ],
  },
}

module.exports = nextConfig
`;

  const CJS_SEMICOLON = `const nextConfig = {
  output: 'export',
};

module.exports = nextConfig;
`;

  it('patches ESM config with `};` closing', () => {
    const { result, alreadyDone, error } = patchNextConfig(ESM_SEMICOLON);
    expect(error).toBeUndefined();
    expect(alreadyDone).toBe(false);
    expect(result).toContain('@locator/webpack-loader');
    expect(result).toContain('isDev');
    expect(result).toContain('export default nextConfig');
  });

  it('patches CJS config with `};` closing', () => {
    const { result, alreadyDone, error } = patchNextConfig(CJS_SEMICOLON);
    expect(error).toBeUndefined();
    expect(alreadyDone).toBe(false);
    expect(result).toContain('@locator/webpack-loader');
    expect(result).toContain('module.exports = nextConfig');
  });

  it('patches CJS config with bare `}` closing (no semicolon)', () => {
    const { result, alreadyDone, error } = patchNextConfig(CJS_NO_SEMICOLON);
    expect(error).toBeUndefined();
    expect(alreadyDone).toBe(false);
    expect(result).toContain('@locator/webpack-loader');
    expect(result).toContain('isDev');
    expect(result).toContain('module.exports = nextConfig');
    // The output must be valid JS: config object should close with `};`
    expect(result).toMatch(/\}\;\s*\n+module\.exports/);
  });

  it('is idempotent — skips already-patched configs', () => {
    const { result } = patchNextConfig(ESM_SEMICOLON);
    const second = patchNextConfig(result);
    expect(second.alreadyDone).toBe(true);
    expect(second.result).toBe(result);
  });

  it('returns error when no export statement is found', () => {
    const { error } = patchNextConfig('const x = 1;\n');
    expect(error).toMatch(/export default|module\.exports/);
  });

  it('does not inject isDev twice if it already exists', () => {
    const { result } = patchNextConfig(ESM_SEMICOLON);
    const occurrences = (result.match(/const isDev/g) ?? []).length;
    expect(occurrences).toBe(1);
  });
});

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
