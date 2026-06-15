import { describe, it, expect } from 'vitest';
import { bookmarkletUrl } from '../cli/src/cli';
import { patchNextConfig, detectNextRunner } from '../cli/src/init';

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
    // Turbopack block inserted before closing `}`, original `}` preserved
    expect(result).toMatch(/webpack-loader[\s\S]+\}\s*\n+module\.exports/);
  });

  it('is idempotent — skips already-patched configs', () => {
    const { result } = patchNextConfig(ESM_SEMICOLON);
    const second = patchNextConfig(result);
    expect(second.alreadyDone).toBe(true);
    expect(second.result).toBe(result);
  });

  it('returns error when no export statement is found', () => {
    const { error } = patchNextConfig('const x = 1;\n');
    expect(error).toMatch(/locate|config object/);
  });

  it('patches withNextIntl wrapper — export default withNextIntl(nextConfig)', () => {
    const src = `import createNextIntlPlugin from 'next-intl/plugin';
const withNextIntl = createNextIntlPlugin();
const nextConfig = {
  reactStrictMode: true,
};
export default withNextIntl(nextConfig);
`;
    const { result, error } = patchNextConfig(src);
    expect(error).toBeUndefined();
    expect(result).toContain('@locator/webpack-loader');
    expect(result).toContain('export default withNextIntl(nextConfig)');
  });

  it('patches withSentryConfig wrapper — export default withSentryConfig(nextConfig, sentryOpts)', () => {
    const src = `import { withSentryConfig } from '@sentry/nextjs';
const nextConfig = {
  output: 'standalone',
};
export default withSentryConfig(nextConfig, { silent: true });
`;
    const { result, error } = patchNextConfig(src);
    expect(error).toBeUndefined();
    expect(result).toContain('@locator/webpack-loader');
  });

  it('patches CJS withBundleAnalyzer wrapper', () => {
    const src = `const withBundleAnalyzer = require('@next/bundle-analyzer')({ enabled: false });
const nextConfig = {
  reactStrictMode: true,
};
module.exports = withBundleAnalyzer(nextConfig);
`;
    const { result, error } = patchNextConfig(src);
    expect(error).toBeUndefined();
    expect(result).toContain('@locator/webpack-loader');
  });

  it('handles string values containing braces without losing count', () => {
    const src = `const nextConfig = {
  env: { MESSAGE: 'open { bracket' },
};
export default nextConfig;
`;
    const { result, error } = patchNextConfig(src);
    expect(error).toBeUndefined();
    expect(result).toContain('@locator/webpack-loader');
    expect(result).toContain('export default nextConfig');
  });

  it('handles inline export default object', () => {
    const src = `export default {
  reactStrictMode: true,
  images: { domains: ['cdn.example.com'] },
};
`;
    const { result, error } = patchNextConfig(src);
    expect(error).toBeUndefined();
    expect(result).toContain('@locator/webpack-loader');
  });

  it('patches config with satisfies keyword', () => {
    const src = `import type { NextConfig } from 'next';
const nextConfig = {
  output: 'export',
} satisfies NextConfig;
export default nextConfig;
`;
    const { result, error } = patchNextConfig(src);
    expect(error).toBeUndefined();
    expect(result).toContain('@locator/webpack-loader');
  });

  it('does not inject isDev twice if it already exists', () => {
    const { result } = patchNextConfig(ESM_SEMICOLON);
    const occurrences = (result.match(/const isDev/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  // --- runner: webpack ---
  it('injects webpack function for runner=webpack', () => {
    const { result, error } = patchNextConfig(CJS_SEMICOLON, 'webpack');
    expect(error).toBeUndefined();
    expect(result).toContain('config.module.rules.push');
    expect(result).toContain('@locator/webpack-loader');
    expect(result).not.toContain('isDev');
  });

  it('errors when runner=webpack and webpack function already exists', () => {
    const src = `const nextConfig = {
  webpack: (config, { dev }) => { return config; },
};
module.exports = nextConfig;
`;
    const { error } = patchNextConfig(src, 'webpack');
    expect(error).toMatch(/already has a webpack function/);
  });

  // --- runner: experimental-turbo ---
  it('injects experimental.turbo block for runner=experimental-turbo', () => {
    const { result, error } = patchNextConfig(ESM_SEMICOLON, 'experimental-turbo');
    expect(error).toBeUndefined();
    expect(result).toContain('experimental');
    expect(result).toContain('turbo');
    expect(result).toContain('@locator/webpack-loader');
  });

  // --- withPlugins([...], config) pattern ---
  it('patches withPlugins([...], nextConfig) — config as 2nd arg after array', () => {
    const src = `const withPlugins = require('next-compose-plugins');
const nextConfig = {
  reactStrictMode: true,
};
module.exports = withPlugins([[require('@next/bundle-analyzer')({ enabled: false })]], nextConfig);
`;
    const { result, error } = patchNextConfig(src);
    expect(error).toBeUndefined();
    expect(result).toContain('@locator/webpack-loader');
  });
});

describe('detectNextRunner', () => {
  const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
  const { join } = require('node:path');
  const { tmpdir } = require('node:os');

  function makePkg(nextVer: string, devScript = 'next dev') {
    const dir = mkdtempSync(join(tmpdir(), 'cc-test-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { next: nextVer },
      scripts: { dev: devScript },
    }));
    return dir;
  }

  it('returns turbopack for Next.js 15', () => {
    const dir = makePkg('^15.0.0');
    expect(detectNextRunner(dir)).toBe('turbopack');
    rmSync(dir, { recursive: true });
  });

  it('returns webpack for Next.js 14 without --turbo', () => {
    const dir = makePkg('^14.2.5');
    expect(detectNextRunner(dir)).toBe('webpack');
    rmSync(dir, { recursive: true });
  });

  it('returns experimental-turbo for Next.js 14 with --turbo', () => {
    const dir = makePkg('^14.2.5', 'next dev --turbo');
    expect(detectNextRunner(dir)).toBe('experimental-turbo');
    rmSync(dir, { recursive: true });
  });

  it('returns webpack for Next.js 15 with --no-turbo', () => {
    const dir = makePkg('^15.0.0', 'next dev --no-turbo');
    expect(detectNextRunner(dir)).toBe('webpack');
    rmSync(dir, { recursive: true });
  });

  it('defaults to webpack when no package.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-test-'));
    expect(detectNextRunner(dir)).toBe('webpack');
    rmSync(dir, { recursive: true });
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
