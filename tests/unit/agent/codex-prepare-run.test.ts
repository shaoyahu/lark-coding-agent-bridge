import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexAdapter } from '../../../src/agent/codex/adapter.js';
import { writeVersionExecutable } from '../../helpers/fake-executable.js';

const cleanups: Array<() => Promise<void>> = [];

describe('CodexAdapter prepareRun', () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it('allows a run when the configured Codex binary returns a version without stored metadata', async () => {
    const binary = await writeCodexBinary('codex 1.2.3');
    const launcherBinary = await writeAidenLauncher();
    const adapter = new CodexAdapter({
      binary,
      launcherBinary,
      profileStateDir: join(tmpdir(), 'codex-profile'),
    });

    await expect(adapter.prepareRun()).resolves.toBeUndefined();
  });

  it('reports a preflight diagnostic when the configured Codex binary is missing', async () => {
    const launcherBinary = join(tmpdir(), 'missing-aiden');
    const adapter = new CodexAdapter({
      binary: join(tmpdir(), 'missing-codex'),
      launcherBinary,
      profileStateDir: join(tmpdir(), 'codex-profile'),
    });

    await expect(adapter.prepareRun()).rejects.toMatchObject({
      code: 'agent-binary-not-found',
      diagnostic: {
        code: 'agent-binary-not-found',
        agentId: 'codex',
        agentName: 'Codex CLI',
      },
    });
  });
});

async function writeCodexBinary(version: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'codex-prepare-run-test-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return writeVersionExecutable(dir, 'codex', version);
}

async function writeAidenLauncher(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'aiden-prepare-run-test-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'aiden');
  await writeFile(
    file,
    [
      `#!${process.execPath}`,
      'if (process.argv.slice(2).join(" ") === "x codex --help") {',
      '  console.log("Usage: aiden x codex [options]");',
      '  process.exit(0);',
      '}',
      'console.error(`unexpected argv: ${process.argv.slice(2).join(" ")}`);',
      'process.exit(1);',
    ].join('\n'),
    'utf8',
  );
  await chmod(file, 0o755);
  return file;
}
