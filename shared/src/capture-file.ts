import { writeFileSync, renameSync, readFileSync, existsSync } from 'node:fs';
import { latestCapturePath } from './node-paths';
import type { UiContext } from './types';

export function writeLatestCapture(ctx: UiContext, filePath: string = latestCapturePath()): void {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(ctx, null, 2), 'utf8');
  renameSync(tmp, filePath);
}

export function readLatestCapture(filePath: string = latestCapturePath()): UiContext | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as UiContext;
  } catch {
    return null;
  }
}
