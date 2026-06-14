import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

export function configDir() {
  return process.env.CLICKCONTEXT_HOME ?? join(homedir(), '.clickcontext');
}

export function tokenPath() {
  return join(configDir(), 'token');
}

export function ensureToken() {
  const dir = configDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = tokenPath();
  if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  const token = randomBytes(24).toString('hex');
  writeFileSync(p, token, { mode: 0o600 });
  return token;
}
