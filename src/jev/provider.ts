import type { AppConfig } from '../config.js';
import { TypeSafeJevClient, type JevClient } from './client.js';
import { CloudflareJevClient } from './cloudflare.js';

/** Pick the Jev route from configuration. Both produce identical answers. */
export function createJevClient(config: AppConfig): JevClient {
  const j = config.jev;
  if (j.provider === 'cloudflare') {
    return new CloudflareJevClient({
      accountId: j.cloudflare.accountId!,
      apiToken: j.cloudflare.apiToken!,
      gatewayId: j.cloudflare.gatewayId,
      model: j.cloudflare.model,
      baseUrl: j.cloudflare.baseUrl,
      timeoutMs: j.timeoutMs,
    });
  }
  return new TypeSafeJevClient({ apiKey: j.apiKey, model: j.model, timeoutMs: j.timeoutMs, baseUrl: j.baseUrl });
}
