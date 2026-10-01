import type { DB } from '../db/database.js';
import { nowIso } from '../db/database.js';

/** Persistent, admin-editable application settings (not environment variables). */
export interface Settings {
  'registration.public': boolean;
}

const DEFAULTS: Settings = {
  'registration.public': false,
};

export class SettingsService {
  constructor(private readonly db: DB) {}

  get<K extends keyof Settings>(key: K): Settings[K] {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return DEFAULTS[key];
    try {
      return JSON.parse(row.value) as Settings[K];
    } catch {
      return DEFAULTS[key];
    }
  }

  set<K extends keyof Settings>(key: K, value: Settings[K], updatedBy: string | null = null): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      )
      .run(key, JSON.stringify(value), nowIso(), updatedBy);
  }

  publicRegistration(): boolean {
    return this.get('registration.public') === true;
  }
}
