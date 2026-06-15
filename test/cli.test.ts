import { describe, it, expect } from 'vitest';
import { transformSync } from 'esbuild';
import { bookmarkletUrl, parsePort } from '../cli/src/cli';
import { patchNextConfig, detectNextRunner } from '../cli/src/init';

/** Assert the patched output is still syntactically valid JS/TS — the failure
 *  mode unit-level "contains loader string" assertions miss. */
function expectValidJs(code: string, loader: 'ts' | 'js' = 'ts') {
  expect(() => transformSync(code, { loader, format: 'esm' })).not.toThrow();
}

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

  // --- output validity: single-line / no-trailing-comma objects (regression) ---
  // These previously fused the injected block onto the last property without a
  // comma, producing invalid JS that silently broke the user's dev server.
  it('produces valid JS for a single-line config object', () => {
    const src = `const nextConfig = { reactStrictMode: true };
export default nextConfig;
`;
    for (const runner of ['turbopack', 'experimental-turbo', 'webpack'] as const) {
      const { result, error } = patchNextConfig(src, runner);
      expect(error).toBeUndefined();
      expectValidJs(result);
    }
  });

  it('produces valid JS for `as const` config', () => {
    const src = `const nextConfig = { reactStrictMode: true } as const;
export default nextConfig;
`;
    const { result, error } = patchNextConfig(src);
    expect(error).toBeUndefined();
    expectValidJs(result);
  });

  it('produces valid JS for parenthesized default export', () => {
    const src = `const nextConfig = { reactStrictMode: true };
export default (nextConfig);
`;
    const { result, error } = patchNextConfig(src);
    expect(error).toBeUndefined();
    expectValidJs(result);
  });

  it('produces valid JS when const is declared after module.exports', () => {
    const src = `module.exports = withSentryConfig(nextConfig, {});
const nextConfig = { reactStrictMode: true };
`;
    const { result, error } = patchNextConfig(src);
    expect(error).toBeUndefined();
    expectValidJs(result, 'js');
  });

  it('all standard fixtures produce valid JS, not just the loader string', () => {
    for (const [src, loader] of [
      [ESM_SEMICOLON, 'ts'], [CJS_SEMICOLON, 'js'], [CJS_NO_SEMICOLON, 'js'],
    ] as const) {
      for (const runner of ['turbopack', 'experimental-turbo', 'webpack'] as const) {
        const { result, error } = patchNextConfig(src, runner);
        if (error) continue; // graceful bail is acceptable
        expectValidJs(result, loader);
      }
    }
  });

  // Function-form configs can't be patched by object insertion — must bail gracefully.
  it('gracefully errors on function-form config (no object literal to patch)', () => {
    const src = `export default async () => {
  return { reactStrictMode: true };
};
`;
    const { error, result } = patchNextConfig(src);
    expect(error).toMatch(/locate|config object/);
    expect(result).not.toContain('@locator'); // original returned untouched
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

  it('injects a custom port and leaves no port placeholder', () => {
    const code = 'fetch("http://127.0.0.1:__CLICKCONTEXT_PORT_PLACEHOLDER__/capture")';
    const decoded = decodeURIComponent(bookmarkletUrl(code, 'tok', 7500).slice('javascript:'.length));
    expect(decoded).toContain('127.0.0.1:7500/capture');
    expect(decoded).not.toContain('PLACEHOLDER');
  });

  it('defaults the port to 7456 when not given', () => {
    const code = 'http://127.0.0.1:__CLICKCONTEXT_PORT_PLACEHOLDER__/capture';
    const decoded = decodeURIComponent(bookmarkletUrl(code, 'tok').slice('javascript:'.length));
    expect(decoded).toContain('127.0.0.1:7456/capture');
  });
});

describe('parsePort', () => {
  it('parses --port <n>', () => {
    expect(parsePort(['daemon', '--port', '7500'])).toBe(7500);
  });
  it('parses --port=<n>', () => {
    expect(parsePort(['daemon', '--port=8080'])).toBe(8080);
  });
  it('defaults to 7456 when absent', () => {
    expect(parsePort(['daemon'])).toBe(7456);
  });
  it('ignores out-of-range / non-numeric values', () => {
    expect(parsePort(['daemon', '--port', '99999'])).toBe(7456);
    expect(parsePort(['daemon', '--port', 'abc'])).toBe(7456);
    expect(parsePort(['daemon', '--port', '0'])).toBe(7456);
  });
});

describe('function-form config detection', () => {
  it('gives a function-specific message for arrow/function configs', () => {
    for (const src of [
      'export default () => ({ reactStrictMode: true });',
      'export default async (phase) => {\n  return { reactStrictMode: true };\n};',
      'module.exports = function (phase) { return { reactStrictMode: true }; };',
    ]) {
      const { error } = patchNextConfig(src);
      expect(error).toMatch(/exports a function/);
    }
  });

  it('still auto-patches a named-const config (not a false positive)', () => {
    const src = `const nextConfig = { reactStrictMode: true };
export default nextConfig;
`;
    const { error } = patchNextConfig(src);
    expect(error).toBeUndefined();
  });
});
