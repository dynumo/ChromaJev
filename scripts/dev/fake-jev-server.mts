/**
 * Offline UI demo: runs ChromaJev with a deterministic *fake* Jev client so
 * the interface can be developed without spending credits. Judgements are
 * keyword-based stand-ins, not Jev's — never use this for real palettes.
 *
 *   npm run dev:demo   →  http://localhost:3111  (demo@example.com / demo password 1)
 */
import { loadConfig } from '../../src/config.js';
import { createApp } from '../../src/app.js';
import { FakeJevClient } from '../../test/helpers/fakeJev.js';

const port = 3111;
const config = loadConfig({
  ...process.env,
  NODE_ENV: 'development',
  DATA_DIR: './data-demo',
  ADMIN_EMAIL: 'demo@example.com',
  ADMIN_PASSWORD: 'demo password 1',
  MAIL_TRANSPORT: 'log',
  PORT: String(port),
  PUBLIC_BASE_URL: `http://localhost:${port}`,
});
const { app, ctx } = await createApp(config, { jev: new FakeJevClient() });
await ctx.accounts.bootstrapAdmin();
app.listen(port, () => console.log(`Demo (FAKE Jev) on http://localhost:${port} — demo@example.com / demo password 1`));
