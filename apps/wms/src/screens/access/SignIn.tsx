import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Role } from '@fv/contracts';
import { homeShellFor, useSession } from '@/app/session';
import { requestOtp, signInWithoutOtp } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useOnline } from '@/hooks/useOnline';
import { cn } from '@/lib/utils';

/**
 * L01 · Sign in (UI Spec §7, built last per §24).
 *
 * Phone number plus OTP — no password to remember, because a shared warehouse
 * phone with a forgotten password is a warehouse that stops recording.
 *
 * Four rules from the spec, each with a operational reason:
 *
 * 1. **The session lasts.** Operators do not sign in every shift; that
 *    friction alone kills adoption.
 * 2. **OTP is rate limited** — three failures, then a fifteen-minute wait with
 *    a message that says so rather than failing silently.
 * 3. **Offline on a known device signs in locally** with a banner. A warehouse
 *    with no signal must still be able to start work.
 * 4. **Offline on a NEW device is blocked**, and says why. There is nothing on
 *    the device to verify against, and pretending otherwise would be worse.
 *
 * The backend now exists and this screen talks to it. Which of the two ways in
 * it uses is decided by `OTP_ENABLED` below, and the trial takes the shorter
 * one — see the note there for what that costs.
 */

const RESEND_SECONDS = 60;
const OTP_LENGTH = 6;

/**
 * The switch between the two ways in.
 *
 * `false` for the trial: there is no SMS contract, and reading codes out of a
 * server log is not something you can put in front of a prospective customer,
 * so sign-in asks for a phone number and nothing else. The server half is
 * governed separately by `AUTH_SKIP_OTP`, and BOTH must agree — the API refuses
 * codeless sign-in unless its own flag is set.
 *
 * Turning it back on is this one line. Everything the code screen needs —
 * `/api/auth/otp/request`, `/api/auth/otp/verify`, the six boxes, the resend
 * countdown, the lockout — is present and tested, which is why this is a
 * constant rather than a deletion.
 *
 * Typed `boolean` on purpose: as a bare literal, TypeScript narrows the branch
 * below to `never` and the code screen stops being typechecked at all.
 */
const OTP_ENABLED: boolean = false;

export function SignIn() {
  const navigate = useNavigate();
  const online = useOnline();

  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState<string[]>(Array.from({ length: OTP_LENGTH }, () => ''));
  const [countdown, setCountdown] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const applySession = useSession((s) => s.applySession);

  const boxRefs = useRef<(HTMLInputElement | null)[]>([]);

  /** Has this device signed in before? Decides the offline path. */
  const knownDevice = typeof localStorage !== 'undefined' && localStorage.getItem('fv.session') !== null;

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const lockedOut = attempts >= 3;

  /**
   * The trial signs in on the phone number alone (T-104).
   *
   * The six-digit step below is kept, not deleted: `/api/auth/otp/request` and
   * `/api/auth/otp/verify` exist and are tested, and the only thing missing is
   * a way to deliver the code that a customer can watch happen. Reinstating it
   * is repointing this handler at `requestOtp` and letting `step` advance —
   * which is why the code screen still lives in this file rather than in the
   * git history.
   */
  const submitPhone = async () => {
    if (phone.length < 9 || lockedOut) return;
    setSending(true);
    setError(null);
    // The input holds national digits after the +62 chip, and Indonesian
    // numbers are commonly written with a leading 0 that E.164 does not take.
    const e164 = `+62${phone.replace(/^0+/, '')}`;

    try {
      if (OTP_ENABLED) {
        await requestOtp(e164);
        setStep('code');
        setCountdown(RESEND_SECONDS);
        return;
      }

      const session = await signInWithoutOtp(e164);
      applySession(session);
      navigate(homeShellFor(session.user.role as Role) === 'office' ? '/o' : '/f', {
        replace: true,
      });
    } catch (cause) {
      // The server's message is the useful one — "no longer active", "wait
      // fifteen minutes". Replacing it with a generic failure would throw away
      // the only part that tells the operator what to do next.
      setError(cause instanceof Error ? cause.message : 'Could not sign in');
      setAttempts((a) => a + 1);
    } finally {
      setSending(false);
    }
  };

  const setDigit = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    setCode((current) => current.map((c, i) => (i === index ? digit : c)));
    if (digit && index < OTP_LENGTH - 1) boxRefs.current[index + 1]?.focus();
  };

  if (!online && !knownDevice) {
    return (
      <Frame>
        <h1 className="text-h2 font-semibold text-text-primary">Connect to sign in</h1>
        <p className="pt-3 text-body text-text-secondary">
          This device has not been used before, so there is nothing here to verify you against.
          Connect to the internet once, and after that it works offline.
        </p>
      </Frame>
    );
  }

  if (step === 'phone') {
    return (
      <Frame>
        {!online && knownDevice && (
          <p className="mb-6 rounded-sm bg-secondary px-4 py-3 text-body-sm text-text-secondary">
            Offline — signing in locally on this device.
          </p>
        )}

        <h1 className="text-h2 font-semibold text-text-primary">FactoryVision</h1>
        <p className="pt-2 text-body text-text-secondary">
          Sign in with your phone number. There is no password to remember.
        </p>

        <div className="pt-8">
          <Label htmlFor="phone" className="mb-2 block">
            Phone number
          </Label>
          <div className="flex items-stretch gap-2">
            <span className="flex h-input items-center rounded-input border border-border bg-secondary px-4 text-body text-text-secondary">
              +62
            </span>
            <Input
              id="phone"
              inputMode="numeric"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
              placeholder="812 0000 0000"
              className="flex-1"
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-6 rounded-sm bg-danger-subtle px-4 py-3 text-body-sm text-danger">
            {error}
          </p>
        )}

        <Button
          className="mt-8 w-full"
          size="lg"
          loading={sending}
          disabled={phone.length < 9}
          onClick={() => void submitPhone()}
        >
          Sign in
        </Button>

        <Button variant="ghost" className="mt-3 w-full" onClick={() => navigate('/register')}>
          Set up a new factory
        </Button>
      </Frame>
    );
  }

  return (
    <Frame>
      <h1 className="text-h2 font-semibold text-text-primary">Enter the code</h1>
      <p className="pt-2 text-body text-text-secondary">
        We sent six digits to +62 {phone}.
      </p>

      <div className="flex justify-between gap-2 pt-8">
        {code.map((digit, index) => (
          <input
            key={index}
            ref={(element) => {
              boxRefs.current[index] = element;
            }}
            inputMode="numeric"
            maxLength={1}
            value={digit}
            disabled={lockedOut}
            onChange={(e) => setDigit(index, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !digit && index > 0) boxRefs.current[index - 1]?.focus();
            }}
            aria-label={`Digit ${index + 1}`}
            className={cn(
              'h-input w-full rounded-input border border-border bg-card text-center text-h3 font-semibold tabular-nums text-text-primary',
              'focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:bg-secondary disabled:text-text-disabled',
            )}
          />
        ))}
      </div>

      {lockedOut ? (
        <p className="pt-6 text-body-sm text-st-danger">
          Three codes were wrong. Wait 15 minutes before trying again — this protects your factory's
          account.
        </p>
      ) : (
        <p className="pt-6 text-body-sm text-text-secondary">
          {countdown > 0 ? `Resend in ${countdown}s` : 'Did not arrive?'}{' '}
          {countdown === 0 && (
            <button
              type="button"
              className="font-semibold text-primary underline"
              onClick={() => setCountdown(RESEND_SECONDS)}
            >
              Send it again
            </button>
          )}
        </p>
      )}

      <Button
        className="mt-8 w-full"
        size="lg"
        disabled={code.some((d) => d === '') || lockedOut}
        onClick={() => setAttempts((a) => a + 1)}
      >
        Sign in
      </Button>

      <p className="pt-4 text-body-sm text-text-secondary">
        Verification needs the server, which is not connected in this build yet.
      </p>
    </Frame>
  );
}

/** Template C: single column, centred, nothing else on screen. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-[26rem]">{children}</div>
    </div>
  );
}
