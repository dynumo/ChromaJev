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

  const { app, ctx, stop } = await createApp(config);
  const bootstrap = await ctx.accounts.bootstrapAdmin();
  if (bootstrap === 'skipped-not-configured' && ctx.accounts.countUsers() === 0) {
    console.warn('No accounts exist yet. Set ADMIN_EMAIL and ADMIN_PASSWORD and restart to create the first administrator.');
  }
  if (!ctx.jev.configured) console.warn('TYPESAFE_API_KEY is not set: only cached concepts can be generated.');
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
  console.error(err);
  process.exit(1);
});
