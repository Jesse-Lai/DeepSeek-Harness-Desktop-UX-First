import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { release } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

export const supportsNativeCompanion = () => process.platform === 'darwin' && Number(release().split('.')[0]) >= 25;
export function companionConfiguration(userDataPath) {
  return { token: randomBytes(32).toString('hex'), dataRoot: join(userDataPath, 'companion') };
}
export async function launchCompanion({ app, harness, configuration, sourceRoot, onCommand, onExit }) {
  const bundle = app.isPackaged
    ? join(process.resourcesPath, 'DSH Companion.app')
    : join(sourceRoot, 'dist', 'native', 'DSH Companion.app');
  const executable = join(bundle, 'Contents', 'MacOS', 'JesseCompanion');
  await access(executable);
  for (let i = 0; i < 100 && !harness.companionUrl; i++) await delay(50);
  if (!harness.companionUrl) throw new Error('DSH companion service did not become ready');
  const child = spawn(executable, [], {
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
      DSH_COMPANION_URL: harness.companionUrl, DSH_COMPANION_TOKEN: configuration.token,
      DSH_COMPANION_DATA: configuration.dataRoot,
      DSH_COMPANION_LOGIN: app.getLoginItemSettings().openAtLogin ? '1' : '0',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout });
  const send = (command) => { if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(command) + '\n'); };
  let stopped = false;
  child.stdin.on('error', () => {});
  child.stderr.on('data', (chunk) => console.error('[DSH Companion]', chunk.toString().trim()));
  lines.on('line', (line) => {
    try {
      const command = JSON.parse(line);
      Promise.resolve(onCommand(command, send)).catch((e) => console.error('Companion command failed:', e.message));
    } catch { /* Native diagnostics are not host commands. */ }
  });
  child.once('error', (e) => console.error('Companion launch failed:', e.message));
  child.once('exit', () => { lines.close(); if (!stopped) onExit?.(); });
  return {
    send,
    get running() { return child.exitCode === null && child.signalCode === null; },
    async stop() {
      stopped = true; send({ type: 'quit' });
      for (let i = 0; i < 30 && child.exitCode === null && child.signalCode === null; i++) await delay(50);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    },
  };
}
