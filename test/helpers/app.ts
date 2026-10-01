import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, type AppConfig } from '../../src/config.js';
import { createApp } from '../../src/app.js';
import { openDatabase } from '../../src/db/database.js';
import { MemoryTransport } from '../../src/mail/mailer.js';
import { FakeJevClient } from './fakeJev.js';
import request from 'supertest';

export const ADMIN = { email: 'admin@example.com', password: 'correct horse battery' };

export async function makeApp(env: Record<string, string> = {}) {
  const config: AppConfig = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_BASE_URL: 'http://localhost:3000',
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'chromajev-test-')),
    ADMIN_EMAIL: ADMIN.email,
    ADMIN_PASSWORD: ADMIN.password,
    MAIL_TRANSPORT: 'log',
    ...env,
  });
  const jev = new FakeJevClient();
  const mail = new MemoryTransport();
  const db = openDatabase(':memory:');
  const built = await createApp(config, { jev, mail, db, log: () => undefined });
  await built.ctx.accounts.bootstrapAdmin();
  built.stop();
  return { ...built, jev, mail, db, config };
}

export type TestApp = Awaited<ReturnType<typeof makeApp>>;

export function csrfFrom(html: string): string {
  const m = /name="_csrf" value="([^"]+)"/.exec(html) ?? /name="csrf-token" content="([^"]+)"/.exec(html);
  if (!m) throw new Error('no csrf token in page');
  return m[1];
}

/** A supertest agent signed in through the real login form. */
export async function loginAgent(t: TestApp, email = ADMIN.email, password = ADMIN.password) {
  const agent = request.agent(t.app);
  const page = await agent.get('/login');
  const res = await agent.post('/login').type('form').send({ _csrf: csrfFrom(page.text), email, password, next: '/' });
  if (res.status !== 303) throw new Error(`login failed: ${res.status} ${res.text.slice(0, 300)}`);
  const home = await agent.get('/account');
  return { agent, csrf: csrfFrom(home.text) };
}

export async function createUser(t: TestApp, email: string, password = 'user password 123') {
  return t.ctx.accounts.createUserDirect({ email, password });
}
