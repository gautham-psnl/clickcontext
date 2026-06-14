import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const LATEST_CAPTURE_FILENAME = 'clickcontext-latest.json';

export function latestCapturePath(): string {
  return join(tmpdir(), LATEST_CAPTURE_FILENAME);
}
