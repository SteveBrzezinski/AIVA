import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';

export interface AudioPlayer {
  play(filePath: string): Promise<void>;
}

async function ensureReadable(filePath: string): Promise<void> {
  await access(filePath, constants.R_OK);
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Audio player exited with code ${code ?? 'unknown'}.`));
    });
  });
}

function spawnPlayer(command: string, args: string[]): Promise<void> {
  const child = spawn(command, args, { stdio: 'ignore', shell: false });
  return waitForExit(child);
}

export class ShellAudioPlayer implements AudioPlayer {
  async play(filePath: string): Promise<void> {
    await ensureReadable(filePath);

    const platform = process.platform;

    if (platform === 'win32') {
      const escapedPath = filePath.replace(/'/g, "''");
      await spawnPlayer('powershell.exe', [
        '-NoProfile',
        '-Command',
        `(New-Object Media.SoundPlayer '${escapedPath}').PlaySync();`,
      ]);
      return;
    }

    if (platform === 'darwin') {
      await spawnPlayer('afplay', [filePath]);
      return;
    }

    try {
      await spawnPlayer('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'error', filePath]);
      return;
    } catch {
      await spawnPlayer('aplay', [filePath]);
    }
  }
}

export class NoopAudioPlayer implements AudioPlayer {
  async play(): Promise<void> {
    return Promise.resolve();
  }
}
