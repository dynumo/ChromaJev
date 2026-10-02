import type Provider from 'oidc-provider';
import type { AccountService } from './accounts/service.js';
import type { SettingsService } from './accounts/settings.js';
import type { ChangelogService } from './changelog/service.js';
import type { AppConfig } from './config.js';
import type { DB } from './db/database.js';
import type { SemanticCache } from './jev/cache.js';
import type { JevClient } from './jev/client.js';
import type { MailTransport } from './mail/mailer.js';
import type { SchemeService } from './schemes/service.js';

/** Everything the interfaces (web, API, MCP) share. One service layer. */
export interface AppContext {
  config: AppConfig;
  db: DB;
  jev: JevClient;
  cache: SemanticCache;
  schemes: SchemeService;
  accounts: AccountService;
  settings: SettingsService;
  changelog: ChangelogService;
  mail: MailTransport;
  provider: Provider;
}
