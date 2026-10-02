import { randomUUID } from 'node:crypto';
import type { DB } from '../db/database.js';
import { nowIso } from '../db/database.js';
import { badRequest, notFound } from '../util/errors.js';

export const MAX_TITLE_LENGTH = 120;
export const MAX_BODY_LENGTH = 5000;

export interface ChangelogEntry {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  title: string;
  body: string;
  published_at: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const toEntry = (r: Row): ChangelogEntry => ({
  id: r.id,
  title: r.title,
  body: r.body,
  publishedAt: r.published_at,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function validateTitle(v: unknown): string {
  if (typeof v !== 'string') throw badRequest('A title is required.');
  const t = v.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!t) throw badRequest('A title is required.');
  if (t.length > MAX_TITLE_LENGTH) throw badRequest(`The title must be at most ${MAX_TITLE_LENGTH} characters.`);
  return t;
}

function validateBody(v: unknown): string {
  if (typeof v !== 'string') throw badRequest('Some text is required.');
  const b = v.replace(/\r\n?/g, '\n').trim();
  if (!b) throw badRequest('Some text is required.');
  if (b.length > MAX_BODY_LENGTH) throw badRequest(`The text must be at most ${MAX_BODY_LENGTH} characters.`);
  return b;
}

/** Accepts a YYYY-MM-DD date (from a date input); blank means "now". Shown as given. */
function validatePublishedAt(v: unknown): string {
  if (v === undefined || v === null || v === '') return nowIso();
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw badRequest('Enter the date as YYYY-MM-DD.');
  const d = new Date(`${v}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw badRequest('That is not a real date.');
  return d.toISOString();
}

/** Release notes shown on the public /changelog page; written by administrators. */
export class ChangelogService {
  constructor(private readonly db: DB) {}

  list(): ChangelogEntry[] {
    return (this.db.prepare('SELECT * FROM changelog_entries ORDER BY published_at DESC, created_at DESC').all() as Row[]).map(toEntry);
  }

  get(id: string): ChangelogEntry | null {
    const r = this.db.prepare('SELECT * FROM changelog_entries WHERE id = ?').get(id) as Row | undefined;
    return r ? toEntry(r) : null;
  }

  create(authorId: string | null, input: { title: unknown; body: unknown; publishedAt?: unknown }): ChangelogEntry {
    const title = validateTitle(input.title);
    const body = validateBody(input.body);
    const publishedAt = validatePublishedAt(input.publishedAt);
    const now = nowIso();
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO changelog_entries (id, title, body, published_at, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, title, body, publishedAt, authorId, now, now);
    return this.get(id)!;
  }

  update(id: string, input: { title: unknown; body: unknown; publishedAt?: unknown }): ChangelogEntry {
    const existing = this.get(id);
    if (!existing) throw notFound('Changelog entry');
    const title = validateTitle(input.title);
    const body = validateBody(input.body);
    // A blank date on edit keeps the original rather than jumping to "now".
    const publishedAt = input.publishedAt === undefined || input.publishedAt === '' ? existing.publishedAt : validatePublishedAt(input.publishedAt);
    this.db.prepare('UPDATE changelog_entries SET title = ?, body = ?, published_at = ?, updated_at = ? WHERE id = ?').run(title, body, publishedAt, nowIso(), id);
    return this.get(id)!;
  }

  delete(id: string): ChangelogEntry {
    const existing = this.get(id);
    if (!existing) throw notFound('Changelog entry');
    this.db.prepare('DELETE FROM changelog_entries WHERE id = ?').run(id);
    return existing;
  }
}
