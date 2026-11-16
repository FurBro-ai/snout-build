import fs from 'fs';
import os from 'os';
import path from 'path';

const UPLOAD_DIR_NAME = 'uploads';
const TEMP_UPLOAD_DIR_NAME = 'snout-uploads';

function ensureWritableDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveUploadsDir(): string {
  const configuredDir = process.env.UPLOADS_DIR?.trim();
  if (configuredDir) {
    const resolved = path.resolve(configuredDir);
    if (ensureWritableDir(resolved)) return resolved;
    console.warn(
      `[uploads] UPLOADS_DIR "${resolved}" is not writable; falling back to a temporary upload directory.`
    );
  }

  const cwdUploads = path.resolve(process.cwd(), UPLOAD_DIR_NAME);
  if (ensureWritableDir(cwdUploads)) return cwdUploads;

  console.warn(
    `[uploads] "${cwdUploads}" is not writable (read-only deployment?); falling back to ${os.tmpdir()}.`
  );
  const tempUploads = path.join(os.tmpdir(), TEMP_UPLOAD_DIR_NAME);
  if (ensureWritableDir(tempUploads)) return tempUploads;

  // Last resort: the OS temp directory itself is expected to be writable.
  return os.tmpdir();
}

/**
 * Shared upload directory used by both the static file middleware and the
 * messages upload router. Prefers UPLOADS_DIR, then <cwd>/uploads, then the
 * OS temp directory so read-only/serverless deployments do not crash.
 */
export const UPLOADS_DIR = resolveUploadsDir();

export function ensureUploadsDir(): string {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  return UPLOADS_DIR;
}
