import { Check, FileSpreadsheet, PackagePlus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '@/app/session';
import { registerFactory } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

/**
 * Register, create tenant, and onboarding (T-101, T-102, T-103; UI Spec §24).
 *
 * The whole flow is shaped by one PRD number: **time-to-value under 48 hours,
 * signup to first transaction.** Every field that is not needed to record a
 * delivery is a field that pushes that number out, so this asks for three
 * things and then gets out of the way.
 *
 * The starting-data step matters more than it looks. A factory that begins
 * with an empty product list has to type before it can work, and PRD Risk #5
 * says the Excel import is where a sale is won or lost — so importing is
 * offered as the FIRST option, not buried in settings.
 */

type Step = 1 | 2 | 3;

export function Register() {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>(1);
  const [factoryName, setFactoryName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [start, setStart] = useState<'import' | 'blank'>('import');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const applySession = useSession((s) => s.applySession);

  /**
   * Creates the factory for real (T-102).
   *
   * The wizard collected these three fields from the first screen onward but
   * never sent them anywhere; finishing navigated straight into an app with a
   * demo tenant. Registration returns a live session, so the operator lands on
   * their OWN factory — signed in already, which is the point of B-013: three
   * fields and you are working.
   */
  const createFactory = async () => {
    setCreating(true);
    setError(null);
    try {
      const session = await registerFactory({
        factoryName,
        ownerName,
        // Same +62 chip as sign-in, same leading-zero habit to strip.
        phone: `+62${phone.replace(/^0+/, '')}`,
      });
      applySession(session);
      navigate(start === 'import' ? '/o/import' : '/f', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the factory');
    } finally {
      setCreating(false);
    }
  };

  const canContinue =
    step === 1 ? factoryName.trim() !== '' && ownerName.trim() !== '' && phone.length >= 9 : true;

  return (
    <div className="flex min-h-dvh justify-center bg-background p-6">
      <div className="w-full max-w-form">
        <Progress value={(step / 3) * 100} className="mb-8" />

        {step === 1 && (
          <>
            <h1 className="text-h2 font-semibold text-text-primary">Set up your factory</h1>
            <p className="pt-2 text-body text-text-secondary">
              Three things now. Everything else can wait until you need it.
            </p>

            <div className="space-y-5 pt-8">
              <div>
                <Label htmlFor="factory" className="mb-2 block">
                  Factory name
                </Label>
                <Input
                  id="factory"
                  value={factoryName}
                  onChange={(e) => setFactoryName(e.target.value)}
                  placeholder="As people say it, not as the deed says it"
                />
              </div>

              <div>
                <Label htmlFor="owner" className="mb-2 block">
                  Your name
                </Label>
                <Input id="owner" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
              </div>

              <div>
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
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                    className="flex-1"
                  />
                </div>
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1 className="text-h2 font-semibold text-text-primary">How do you want to start?</h1>
            <p className="pt-2 text-body text-text-secondary">
              Most factories already have their stock in a spreadsheet. That is the fastest way in.
            </p>

            <div className="space-y-3 pt-8">
              {(
                [
                  {
                    value: 'import' as const,
                    icon: FileSpreadsheet,
                    title: 'Import my Excel file',
                    body: 'Products, locations, and opening stock. Messy files are expected — merged cells, headers part-way down, numbers stored as text.',
                  },
                  {
                    value: 'blank' as const,
                    icon: PackagePlus,
                    title: 'Start from scratch',
                    body: 'Add products as deliveries arrive. Slower to begin, but nothing to prepare.',
                  },
                ]
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setStart(option.value)}
                  className="w-full text-left"
                >
                  <Card
                    className={cn(
                      'transition-colors',
                      start === option.value ? 'border-primary bg-accent' : 'hover:bg-accent',
                    )}
                  >
                    <CardContent className="flex items-start gap-4 p-card">
                      <option.icon size={24} className="mt-1 shrink-0 text-primary" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="text-title font-semibold text-text-primary">{option.title}</p>
                        <p className="pt-1 text-body-sm text-text-secondary">{option.body}</p>
                      </div>
                      {start === option.value && (
                        <Check size={20} className="mt-1 shrink-0 text-primary" aria-hidden />
                      )}
                    </CardContent>
                  </Card>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1 className="text-h2 font-semibold text-text-primary">
              {factoryName || 'Your factory'} is ready
            </h1>
            <p className="pt-2 text-body text-text-secondary">
              Your trial runs for 30 days with everything switched on. No card needed, and nothing
              stops working when it ends — you keep read access to your own data either way.
            </p>

            <Card className="mt-8">
              <CardContent className="space-y-3 p-card">
                <p className="text-body font-semibold text-text-primary">During the trial</p>
                <ul className="space-y-2 text-body-sm text-text-secondary">
                  <li>· Every feature, no limits on users or transactions</li>
                  <li>· Your data is yours — export to Excel at any time</li>
                  <li>· Upgrade whenever you are ready, not when we prompt you</li>
                </ul>
              </CardContent>
            </Card>

            {error && (
              <p role="alert" className="mt-6 rounded-sm bg-danger-subtle px-4 py-3 text-body-sm text-danger">
                {error}
              </p>
            )}

            <Button
              className="mt-8 w-full"
              size="lg"
              loading={creating}
              onClick={() => void createFactory()}
            >
              {start === 'import' ? 'Import my Excel file' : 'Start working'}
            </Button>
          </>
        )}

        {step < 3 && (
          <div className="flex gap-3 pt-8">
            {step > 1 && (
              <Button variant="outline" size="lg" onClick={() => setStep((s) => (s - 1) as Step)}>
                Back
              </Button>
            )}
            <Button
              className="flex-1"
              size="lg"
              disabled={!canContinue}
              onClick={() => setStep((s) => (s + 1) as Step)}
            >
              Continue
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
