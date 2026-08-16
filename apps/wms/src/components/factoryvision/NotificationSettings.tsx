import { Bell } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getPushState, subscribeToPush, unsubscribeFromPush, type PushState } from '@/lib/push/webPush';

/**
 * Push notification control, shown on L03 (PRD F11).
 *
 * Permission is asked for here, on a deliberate tap — never on first launch.
 * A prompt that arrives before the app has shown any value gets denied
 * permanently, and there is no second chance at it.
 *
 * Each state says what is actually true rather than hiding behind a disabled
 * toggle: unsupported browser, denied permission, or a backend that does not
 * exist yet.
 */
export function NotificationSettings() {
  const [state, setState] = useState<PushState>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getPushState().then(setState);
  }, []);

  if (!state) return null;

  const toggle = async () => {
    setBusy(true);
    try {
      if (state.subscribed) {
        await unsubscribeFromPush();
        setState(await getPushState());
      } else {
        setState(await subscribeToPush());
      }
    } finally {
      setBusy(false);
    }
  };

  const message = (() => {
    switch (state.support) {
      case 'unsupported':
        return 'This browser cannot receive push notifications. Alerts still appear inside the app.';
      case 'denied':
        return 'Notifications are blocked for this site. You will need to allow them in your browser settings.';
      case 'backend-missing':
        return 'Push is not switched on for this build yet. Alerts appear inside the app in the meantime.';
      default:
        return state.subscribed
          ? 'You will be told about overdue material issues and approvals waiting on you.'
          : 'Get told about overdue material issues without opening the app.';
    }
  })();

  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-card">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-title font-semibold text-text-primary">
            <Bell size={20} aria-hidden />
            Notifications
          </h2>
          <p className="pt-1 text-body-sm text-text-secondary">{message}</p>
        </div>

        {state.support === 'ready' && (
          <Button variant={state.subscribed ? 'outline' : 'default'} loading={busy} onClick={() => void toggle()}>
            {state.subscribed ? 'Turn off' : 'Turn on'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
