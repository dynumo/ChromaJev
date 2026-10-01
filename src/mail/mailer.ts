/**
 * Small mail abstraction. Account logic only knows `Mailer.send`; the
 * Elastic Email specifics live in one transport.
 */
export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Category for logs/tests ("invitation", "verify_email", "reset_password"). */
  kind: string;
}

export interface MailTransport {
  readonly name: string;
  send(message: MailMessage): Promise<void>;
}

export class MailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailDeliveryError';
  }
}

export interface ElasticEmailOptions {
  apiKey: string;
  fromAddress: string;
  fromName: string;
  endpoint?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Elastic Email REST API v4 transactional send:
 * POST https://api.elasticemail.com/v4/emails/transactional
 * Header X-ElasticEmail-ApiKey. Transactional sends are not subject to
 * marketing unsubscribe handling, which is right for account mail.
 */
export class ElasticEmailTransport implements MailTransport {
  readonly name = 'elastic-email';
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ElasticEmailOptions) {
    this.endpoint = options.endpoint ?? 'https://api.elasticemail.com/v4/emails/transactional';
    this.fetchImpl = options.fetch ?? fetch;
  }

  async send(message: MailMessage): Promise<void> {
    const body = {
      Recipients: { To: [message.to] },
      Content: {
        From: `${this.options.fromName} <${this.options.fromAddress}>`,
        Subject: message.subject,
        Body: [
          { ContentType: 'HTML', Charset: 'utf-8', Content: message.html },
          { ContentType: 'PlainText', Charset: 'utf-8', Content: message.text },
        ],
      },
      Options: { TrackOpens: 'false', TrackClicks: 'false' },
    };
    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-ElasticEmail-ApiKey': this.options.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 15000),
      });
    } catch (err) {
      throw new MailDeliveryError(`Could not reach Elastic Email: ${(err as Error).message}`);
    }
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 300);
      } catch {
        /* ignore */
      }
      throw new MailDeliveryError(`Elastic Email rejected the message (HTTP ${res.status})${detail ? `: ${detail}` : ''}`);
    }
  }
}

/** Development only: prints the message (including links) to the console. */
export class LogTransport implements MailTransport {
  readonly name = 'log';
  constructor(private readonly log: (line: string) => void = (l) => console.log(l)) {}
  async send(message: MailMessage): Promise<void> {
    this.log(
      `\n──── [dev mail] ${message.kind} → ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n────────────────────────────────\n`,
    );
  }
}

/** Captures messages in memory. Used by tests. */
export class MemoryTransport implements MailTransport {
  readonly name = 'memory';
  readonly sent: MailMessage[] = [];
  failNext: Error | null = null;
  async send(message: MailMessage): Promise<void> {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    this.sent.push(message);
  }
  last(kind?: string): MailMessage | undefined {
    return [...this.sent].reverse().find((m) => !kind || m.kind === kind);
  }
}

/** Production without mail configured: fail loudly at send time, never log secrets. */
export class UnconfiguredTransport implements MailTransport {
  readonly name = 'unconfigured';
  async send(): Promise<void> {
    throw new MailDeliveryError(
      'Email delivery is not configured. Set ELASTIC_EMAIL_API_KEY and MAIL_FROM_ADDRESS on the server.',
    );
  }
}
