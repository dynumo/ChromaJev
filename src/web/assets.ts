import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** public/assets, from either src/web (dev) or dist/web (built). */
export const ASSETS_DIR = path.resolve(here, '..', '..', 'public', 'assets');

const memo = new Map<string, { stamp: string; version: string }>();

/**
 * "/assets/app.css?v=<content hash>". The hash changes exactly when the file
 * does, so browsers can cache each version forever and pick up a new release
 * on the next page load without a hard refresh. Re-hashed only when the
 * file's mtime or size changes, so it also follows rebuilds in development.
 */
export function assetUrl(name: string, dir: string = ASSETS_DIR): string {
  const file = path.join(dir, name);
  try {
    const st = fs.statSync(file);
    const stamp = `${st.mtimeMs}:${st.size}`;
    const hit = memo.get(file);
    if (hit?.stamp === stamp) return `/assets/${name}?v=${hit.version}`;
    const version = createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
    memo.set(file, { stamp, version });
    return `/assets/${name}?v=${version}`;
  } catch {
    return `/assets/${name}`; // missing file: unversioned, so a 404 is the only symptom
  }
}
