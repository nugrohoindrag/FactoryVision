import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors.js';
import { log } from '../common/logger.js';
import { ENV, type Env } from '../config/env.js';

/**
 * B-015 — the seam where an SMS provider plugs in (BP-03, still open).
 *
 * Two implementations and no third. `console` writes the code to the log and is
 * legitimate in development, in tests and in a demo; `http` POSTs to whatever
 * gateway the business signs with. Which one is live is configuration, and
 * `env.ts` refuses `console` in production rather than trusting a checklist —
 * a build that prints login codes to a shared log is a build that has to be
 * caught by something other than memory.
 *
 * BP-03 is a cost decision, not a technical one: per-message price times thirty
 * users times twenty-five factories is a running cost that has never appeared
 * in the unit economics. The code does not need the answer; the business does.
 */
export interface OtpSender {
  send(phone: string, code: string): Promise<void>;
}

@Injectable()
export class OtpSenderService implements OtpSender {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async send(phone: string, code: string): Promise<void> {
    if (this.env.OTP_PROVIDER === 'console') {
      // Not redacted: this branch exists precisely so a developer can read it.
      log().info({ phone, otp: code }, 'OTP (console provider — not sent by SMS)');
      return;
    }

    const url = this.env.OTP_HTTP_URL;
    if (!url) {
      throw new AppError('NOT_CONFIGURED', 'SMS provider is not configured');
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.env.OTP_HTTP_TOKEN ? { authorization: `Bearer ${this.env.OTP_HTTP_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        to: phone,
        text: `${code} adalah kode masuk FactoryVision Anda. Berlaku ${Math.round(
          this.env.OTP_TTL_SECONDS / 60,
        )} menit. Jangan bagikan kode ini.`,
      }),
    });

    if (!response.ok) {
      // The gateway being down is retryable; the operator is told to try again
      // rather than told nothing.
      log().error({ status: response.status }, 'OTP gateway rejected the send');
      throw new AppError('NOT_CONFIGURED', 'Could not send the code right now. Try again shortly.');
    }
  }
}

export const OTP_SENDER = Symbol('OTP_SENDER');
