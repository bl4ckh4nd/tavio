
import React, { useEffect, useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { ArrowRight, Check } from 'lucide-react';
import { Button, Input, Avatar, Notice, Tag } from '../components/ui';
import { BrandMark } from '../components/BrandMark';
import { authClient } from '../lib/authClient';

interface OnboardingProps {
  onComplete: () => void;
}

export const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const [step, setStep] = useState(1);
  const { data: session } = authClient.useSession();
  const sessionName = session?.user?.name ?? '';
  const [name, setName] = useState('');
  const [permissionStatus, setPermissionStatus] = useState<'pending' | 'granted' | 'denied'>('pending');

  // Prefill with the name given at sign-up instead of asking for it twice.
  useEffect(() => {
    if (sessionName) setName((current) => current || sessionName);
  }, [sessionName]);

  const handleNext = () => {
    const trimmedName = name.trim();
    if (step === 2 && trimmedName && trimmedName !== sessionName) {
      void authClient.updateUser({ name: trimmedName }).catch((error) => {
        console.error('Could not save display name', error);
      });
    }
    if (step < 4) {
      setStep(step + 1);
    } else {
      onComplete();
    }
  };

  const requestPermissions = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      setPermissionStatus('granted');
    } catch (e) {
      console.error(e);
      setPermissionStatus('denied');
    }
  };

  const steps = [
    { id: 1, title: t`Welcome` },
    { id: 2, title: t`Profile` },
    { id: 3, title: t`Access` },
    { id: 4, title: t`Ready` },
  ];

  return (
    <main className="th g-desk">
      <div className="th__top">
        <BrandMark logoClassName="bar__logo" />

        {/* Progress Steps: ink rules with the word. On a phone only the current word stays visible. */}
        <ol className="flex items-end gap-2 sm:gap-3">
          {steps.map((s) => (
            <li key={s.id} aria-current={step === s.id ? 'step' : undefined} className="grid min-w-6 gap-1">
              <span className={`text-xs ${step === s.id ? 'font-medium text-ink' : 'text-muted max-sm:sr-only'}`}>
                {s.title}
              </span>
              <i className={`block h-[3px] rounded-[1px] ${step >= s.id ? 'bg-ink' : 'bg-rule-2'}`} />
            </li>
          ))}
        </ol>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] items-center justify-items-center px-[var(--gutter)] pb-10 sm:pb-[72px]">
        <div className="authsheet stock stock--lift min-h-[400px] grid-rows-[1fr_auto]">

          {/* Step 1: Welcome */}
          {step === 1 && (
            <div className="grid content-start gap-4">
              <div>
                <h1 className="th__h"><Trans>Welcome to Tavio</Trans></h1>
                <p className="muted mt-1.5 text-md">
                  <Trans>You've taken the first step towards secure, high-performance video infrastructure. Let's get your workspace set up in less than a minute.</Trans>
                </p>
              </div>
              <ul className="border-t border-rule-2 text-sm font-medium text-print">
                <li className="border-b border-rule-2 py-2"><Trans>Privacy First</Trans></li>
                <li className="border-b border-rule-2 py-2"><Trans>Fast Everywhere</Trans></li>
                <li className="border-b border-rule-2 py-2"><Trans>Guest-Ready</Trans></li>
              </ul>
            </div>
          )}

          {/* Step 2: Profile */}
          {step === 2 && (
            <div className="grid content-start gap-4">
              <div>
                <h1 className="th__h"><Trans>Create your profile</Trans></h1>
                <p className="muted mt-1.5 text-md"><Trans>How should you appear in meetings?</Trans></p>
              </div>

              <Avatar name={name || 'User'} size="xl" />

              <Input
                label={t`Display Name`}
                placeholder={t`e.g. Sarah Miller`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
          )}

          {/* Step 3: Permissions */}
          {step === 3 && (
            <div className="grid content-start justify-items-start gap-4">
              <div>
                <h1 className="th__h"><Trans>Enable Access</Trans></h1>
                <p className="muted mt-1.5 text-md"><Trans>Tavio needs access to your camera and microphone.</Trans></p>
              </div>

              {permissionStatus === 'pending' && (
                <Button onClick={requestPermissions} size="lg" className="btn--wide max-sm:px-3">
                  <Trans>Request Permissions</Trans>
                </Button>
              )}
              {permissionStatus === 'granted' && (
                <Tag>
                  <Check className="icon" aria-hidden="true" /> <Trans>Access Granted</Trans>
                </Tag>
              )}
              {permissionStatus === 'denied' && (
                <>
                  <Notice variant="error" className="w-full">
                    <p className="font-medium"><Trans>Access Denied</Trans></p>
                    <p className="mt-1">
                      <Trans>You can still continue, but camera and microphone won't work until you allow access in your browser settings.</Trans>
                    </p>
                  </Notice>
                  <Button variant="secondary" onClick={requestPermissions}>
                    <Trans>Try Again</Trans>
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Step 4: Ready */}
          {step === 4 && (
            <div className="grid content-start gap-4">
              <div>
                <h1 className="th__h"><Trans>You're all set!</Trans></h1>
                <p className="muted mt-1.5 text-md">
                  <Trans>Your workspace has been created. You can now create rooms, invite team members, and start meetings.</Trans>
                </p>
              </div>

              <div className="border-t border-rule-2 pt-3 text-sm">
                <h2 className="font-semibold text-print"><Trans>Next Steps:</Trans></h2>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-2">
                  <li><Trans>Create your first permanent room</Trans></li>
                  <li><Trans>Invite team members via email</Trans></li>
                  <li><Trans>Customize your lobby branding</Trans></li>
                </ul>
              </div>
            </div>
          )}

          {/* Footer Navigation */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-rule pt-4">
            {step > 1 ? (
              <Button variant="ghost" className="max-sm:px-3" onClick={() => setStep(step - 1)}><Trans>Back</Trans></Button>
            ) : (
              <div></div>
            )}

            <Button
              onClick={handleNext}
              size="lg"
              className="ml-auto max-sm:px-3"
              variant={step === 3 && permissionStatus === 'pending' ? 'secondary' : 'primary'}
              disabled={step === 2 && name.trim().length === 0}
            >
               {step === 4 ? t`Go to Dashboard` : t`Continue`}
               {step !== 4 && <ArrowRight className="icon" aria-hidden="true" />}
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
};
