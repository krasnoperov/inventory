import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression: the document-navigation middleware fetches index.html through
// `c.env.ASSETS`, but the worker only receives that binding when the [assets]
// block declares `binding = "ASSETS"`. It was missing, so env.ASSETS was
// undefined and every document/asset request threw a 500 in stage + prod.
// (The failure was masked for a while by a separate auth-middleware leak that
// returned 401 before the middleware ever ran.)
const CONFIGS = ['wrangler.toml', 'wrangler.dev.toml'];

function assetsBlock(toml: string): string {
  const start = toml.indexOf('[assets]');
  assert.notStrictEqual(start, -1, 'expected an [assets] block');
  const rest = toml.slice(start + '[assets]'.length);
  const next = rest.search(/^\s*\[/m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('worker assets binding', () => {
  for (const file of CONFIGS) {
    it(`${file} exposes the ASSETS binding to the worker`, () => {
      const toml = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
      assert.match(
        assetsBlock(toml),
        /binding\s*=\s*"ASSETS"/,
        `${file} [assets] must declare binding = "ASSETS" or env.ASSETS is undefined at runtime`
      );
    });
  }
});
