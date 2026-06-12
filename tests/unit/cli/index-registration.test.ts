import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import pkg from '../../../package.json';

describe('CLI command registration', () => {
  it('exposes the documented short lcb binary and help name', async () => {
    const source = await readFile(join(process.cwd(), 'src', 'cli', 'index.ts'), 'utf8');

    expect(pkg.name).toBe('@shaoyahu/lcb');
    expect(pkg.bin).toEqual({ lcb: './bin/lark-channel-bridge.mjs' });
    expect(source).toContain(".name('lcb')");
  });

  it('registers the documented migrate command', async () => {
    const source = await readFile(join(process.cwd(), 'src', 'cli', 'index.ts'), 'utf8');

    expect(source).toMatch(/\.command\(['"]migrate['"]\)/);
    expect(source).toContain('runMigrate');
  });

  it('registers app-secret options for non-interactive app bootstrap commands', async () => {
    const source = await readFile(join(process.cwd(), 'src', 'cli', 'index.ts'), 'utf8');

    const appSecretOptions = source.match(/--app-secret <secret>/g) ?? [];
    expect(appSecretOptions.length).toBeGreaterThanOrEqual(3);
  });
});
