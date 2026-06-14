import { writeLatestCapture } from '@ui/shared/capture-file';
import type { UiContext } from '@ui/shared';

let latest: UiContext | null = null;

export function setLatest(ctx: UiContext): void {
  latest = ctx;
  writeLatestCapture(ctx);
}

export function getLatest(): UiContext | null {
  return latest;
}
