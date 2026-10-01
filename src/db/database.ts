import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrations } from './migrations.js';

export type DB = Database.Database;

/**
 * Open (or create) the SQLite database and bring the schema up to date.
 * WAL mode gives safe concurrent reads with one writer and survives abrupt
 * container stops; `closeDatabase` checkpoints on graceful shutdown.
 */
export function openDatabase(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function migrate(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version),
  );
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        new Date().toISOString(),
      );
    })();
  }
}

export function closeDatabase(db: DB): void {
  if (!db.open) return;
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    /* ignore: closing is what matters */
  }
  db.close();
}

export function nowIso(): string {
  return new Date().toISOString();
}
