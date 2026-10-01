import path from 'node:path';
import { ConfigError, loadConfig } from './config.js';
import { createApp } from './app.js';
import { closeDatabase } from './db/database.js';

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`Configuration error: ${err.message}`);
      process.exit(78); // EX_CONFIG
    }
    throw err;
  }

  if (config.env === 'production' && !path.isAbsolute(process.env.DATA_DIR ?? '/data')) {
    console.warn(
      `DATA_DIR is relative ("${process.env.DATA_DIR}" → ${config.dataDir}). In Docker this is inside the container and is lost on redeploy; use DATA_DIR=/data with a volume mounted at /data.`,
    );
  }
  console.log(`Data directory: ${config.dataDir}`);

  const { app, ctx, stop } = await createApp(config);
  // A bad ADMIN_EMAIL/ADMIN_PASSWORD must not take the whole service down
  // (that only shows up as "bad gateway"); say exactly what is wrong instead.
  try {
    const bootstrap = await ctx.accounts.bootstrapAdmin();
    if (bootstrap === 'skipped-not-configured' && ctx.accounts.countUsers() === 0) {
      console.warn('No accounts exist yet. Set ADMIN_EMAIL and ADMIN_PASSWORD and restart to create the first administrator.');
    }
  } catch (err) {
    console.error(
      `Initial administrator NOT created: ${(err as Error).message} Fix ADMIN_EMAIL / ADMIN_PASSWORD and redeploy. The app is running, but nobody can sign in yet.`,
    );
  }
  if (ctx.jev.configured) console.log(`Jev provider: ${ctx.jev.provider}`);
  else console.warn('Jev is not configured (set TYPESAFE_API_KEY, or CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN): only cached concepts can be generated.');
  if (ctx.mail.name === 'unconfigured') console.warn('Email is not configured: invitations, verification and password resets will fail.');
  if (ctx.mail.name === 'log') console.warn('Development mail transport: emails (including links) are printed to the console.');

  const server = app.listen(config.port, config.host, () => {
    console.log(`ChromaJev listening on http://${config.host}:${config.port} — public URL ${config.publicBaseUrl.origin}`);
  });
  server.keepAliveTimeout = 65_000;

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`${signal} received, shutting down…`);
    stop();
    server.close(() => {
      closeDatabase(ctx.db);
      process.exit(0);
    });
    server.closeIdleConnections?.();
    // Don't hang forever on long-lived connections.
    setTimeout(() => {
      closeDatabase(ctx.db);
      process.exit(0);
    }, 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(`ChromaJev failed to start: ${(err as Error)?.message ?? err}`);
  console.error(err);
  process.exit(1);
});
