
import React, { useState } from 'react';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { GitHubIcon, GoogleIcon } from '../components/BrandIcons';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { Button, IconButton, Input, MeetingRecord, Notice, Stamp } from '../components/ui';
import { BrandMark } from '../components/BrandMark';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { AppView } from '../types';
import { authClient } from '../lib/authClient';

interface AuthProps {
  initialMode?: 'login' | 'register';
  onLogin: () => void;
  onSignup: () => void;
  onNavigate: (view: AppView) => void;
}

// Errors a single field can own. Everything else is shown above the action.
const ERROR_FIELD: Record<string, 'email' | 'password'> = {
  INVALID_EMAIL: 'email',
  INVALID_EMAIL_OR_PASSWORD: 'password',
  PASSWORD_TOO_SHORT: 'password',
  PASSWORD_TOO_LONG: 'password',
};

// A room's things lying on the desk. All sample content, so none of it reaches assistive tech.
const DeskObjects: React.FC = () => (
  <div className="objects hidden xl:block" aria-hidden="true">
    <figure className="print stock stock--lift obj-board">
      <img src="/threshold/board-canvas.webp" width={1400} height={706} alt="" />
    </figure>
    <MeetingRecord
      className="absolute left-0 top-[188px] z-[3] w-[452px] rotate-[-1.1deg]"
      title="Design sync"
      names={'Lena\u00A0R., James\u00A0M., Ava\u00A0K., Tom\u00A0C., Sara\u00A0L., Morgan\u00A0O., Priya\u00A0N.'}
      rows={[
        { label: <Trans>Duration</Trans>, value: '18:42' },
        { label: <Trans>Participants</Trans>, value: '7' },
        { label: <Trans>Chat messages</Trans>, value: '12' },
      ]}
    >
      <p className="record__part">
        <b><Trans>Up next</Trans></b>
        <Trans>Share the prototype by Friday.</Trans>
      </p>
      <p className="record__rec"><Trans>A recording was made and is processing</Trans></p>
      <div className="mt-3.5"><Stamp size="l"><Trans>Saved in this room</Trans></Stamp></div>
    </MeetingRecord>
    <p className="linktag stock stock--lift absolute left-[486px] top-[372px] z-[4] rotate-[1.4deg]">
      <span className="linktag__label"><Trans>Room link</Trans></span>
      <span className="linktag__url">tavio.app/room/design-sync</span>
    </p>
  </div>
);

/** The desk behind login, register and password reset: the sheet on the left, the objects on the right. */
export const AuthDesk: React.FC<{ onHome: () => void; children: React.ReactNode }> = ({ onHome, children }) => {
  const { _ } = useLingui();
  return (
    <main className="th g-desk">
      <div className="th__top">
        <button
          type="button"
          onClick={onHome}
          aria-label={_(/* i18n */ 'Tavio home')}
          className="flex min-h-11 cursor-pointer items-center rounded-input"
        >
          <BrandMark logoClassName="bar__logo" />
        </button>
        <LanguageSwitcher className="text-ink-2" />
      </div>
      <div className="authgrid max-xl:grid-cols-[minmax(0,1fr)] max-xl:justify-items-center">
        {children}
        <DeskObjects />
      </div>
    </main>
  );
};

export const Auth: React.FC<AuthProps> = ({ initialMode = 'login', onLogin, onSignup, onNavigate }) => {
  const { _ } = useLingui();
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>(initialMode);
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setIsLoading(true);
    setError(null);
    setErrorCode(null);

    try {
      if (mode === 'login') {
        const { error } = await authClient.signIn.email({
          email,
          password,
          rememberMe: true,
        });
        if (error) {
          throw error;
        }
        onLogin();
      } else if (mode === 'register') {
        const { error } = await authClient.signUp.email({
          email,
          password,
          name: displayName.trim() || email,
        });
        if (error) {
          throw error;
        }
        onSignup();
      } else if (mode === 'forgot') {
        const redirectTo = typeof window !== 'undefined'
          ? `${window.location.origin}/auth/reset`
          : '/auth/reset';
        const { error } = await authClient.requestPasswordReset({
          email,
          redirectTo,
        });
        if (error) {
          throw error;
        }
        setResetSent(true);
      }
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('Auth error', err);
      const knownErrors: Record<string, string> = {
        INVALID_EMAIL_OR_PASSWORD: _(/* i18n */ 'Email or password is incorrect.'),
        USER_ALREADY_EXISTS: _(/* i18n */ 'An account with this email already exists. Sign in instead.'),
        USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: _(/* i18n */ 'An account with this email already exists. Sign in instead.'),
        PASSWORD_TOO_SHORT: _(/* i18n */ 'Password must be at least 8 characters.'),
        PASSWORD_TOO_LONG: _(/* i18n */ 'Password is too long.'),
        INVALID_EMAIL: _(/* i18n */ 'Enter a valid email address.'),
      };
      const message =
        (err?.code && knownErrors[err.code]) ||
        (err && (err.data?.error?.message || err.message)) ||
        (mode === 'forgot'
          ? _(/* i18n */ 'Could not send reset link. Please try again.')
          : _(/* i18n */ 'Authentication failed. Please check your details and try again.'));
      setError(message);
      setErrorCode(err?.code && knownErrors[err.code] ? err.code : null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSocialSignIn = async (provider: 'github' | 'google') => {
    setIsLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      await authClient.signIn.social({
        provider,
        callbackURL: '/admin',
      });
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('Social auth error', err);
      setError(_(/* i18n */ 'Social sign-in failed. Please try again.'));
      setIsLoading(false);
    }
  };

  const errorField = errorCode ? ERROR_FIELD[errorCode] : undefined;
  const emailError = error && errorField === 'email' ? error : undefined;
  const passwordError = error && errorField === 'password' && mode !== 'forgot' ? error : undefined;
  const formError = error && !emailError && !passwordError ? error : null;

  return (
    <AuthDesk onHome={() => onNavigate(AppView.LANDING)}>
      <div className="authsheet stock stock--lift">
        {mode === 'forgot' && resetSent ? (
          <>
            <div>
              <h1 className="th__h">
                <Trans>Check your email</Trans>
              </h1>
              <p className="muted mt-1.5 text-md [overflow-wrap:anywhere]">
                <Trans>We've sent a password reset link to <span className="font-medium text-ink">{email}</span>.</Trans>
              </p>
            </div>
            <Button onClick={() => setMode('login')} className="btn--wide">
              <Trans>Back to Sign In</Trans>
            </Button>
          </>
        ) : (
          <>
            <div>
              <h1 className="th__h">
                {mode === 'login' && <Trans>Welcome back</Trans>}
                {mode === 'register' && <Trans>Create an account</Trans>}
                {mode === 'forgot' && <Trans>Reset password</Trans>}
              </h1>
              <p className="muted mt-1.5 text-md">
                {mode === 'login' && <Trans>Enter your credentials to access your workspace.</Trans>}
                {mode === 'register' && <Trans>Free to use. Signing up asks for no payment details.</Trans>}
                {mode === 'forgot' && <Trans>Enter your email to receive a reset link.</Trans>}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="grid gap-4">
              {mode === 'register' && (
                <Input
                  label={_(/* i18n */ 'Display Name')}
                  type="text"
                  placeholder={_(/* i18n */ 'e.g. Sarah Miller')}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  autoComplete="name"
                  helperText={_(/* i18n */ 'How you appear in meetings')}
                  readOnly={isLoading}
                />
              )}

              <Input
                label={_(/* i18n */ 'Email Address')}
                type="email"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                error={emailError}
                readOnly={isLoading}
              />

              {mode !== 'forgot' && (
                <div className="field relative">
                  <Input
                    label={_(/* i18n */ 'Password')}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    className="!pr-12"
                    rightIcon={
                      <IconButton
                        onClick={() => setShowPassword(v => !v)}
                        label={showPassword ? _(/* i18n */ 'Hide password') : _(/* i18n */ 'Show password')}
                        className="-mr-1"
                      >
                        {showPassword ? <EyeOff className="icon" aria-hidden="true" /> : <Eye className="icon" aria-hidden="true" />}
                      </IconButton>
                    }
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={mode === 'register' ? 8 : undefined}
                    autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                    helperText={mode === 'register' && password.length === 0 ? _(/* i18n */ 'At least 8 characters') : undefined}
                    error={passwordError}
                    readOnly={isLoading}
                  />
                  {mode === 'register' && password.length > 0 && (() => {
                    const len = password.length;
                    const hasUpper = /[A-Z]/.test(password);
                    const hasNum = /[0-9]/.test(password);
                    const hasSpecial = /[^A-Za-z0-9]/.test(password);
                    const score = (len >= 8 ? 1 : 0) + (len >= 10 ? 1 : 0) + ((hasUpper ? 1 : 0) + (hasNum ? 1 : 0) + (hasSpecial ? 1 : 0) >= 2 ? 1 : 0);
                    const levels = [
                      _(/* i18n */ 'Weak'),
                      _(/* i18n */ 'Fair'),
                      _(/* i18n */ 'Good'),
                      _(/* i18n */ 'Strong'),
                    ];
                    return (
                      <>
                        <div className="strength mt-0.5" aria-hidden="true">
                          {levels.map((level, i) => (
                            <i key={level} className={i <= score ? 'on' : undefined} />
                          ))}
                        </div>
                        <p className="field__help flex justify-between gap-2">
                          <span>{levels[Math.min(score, 3)]}</span>
                          {len < 8 && <span>{_(/* i18n */ 'At least 8 characters')}</span>}
                        </p>
                      </>
                    );
                  })()}
                  {mode === 'login' && (
                    <button
                      type="button"
                      onClick={() => setMode('forgot')}
                      className="link absolute right-0 top-0 bg-transparent text-sm pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-top-5 pointer-coarse:after:-bottom-1 pointer-coarse:after:content-['']"
                    >
                      <Trans>Forgot password?</Trans>
                    </button>
                  )}
                </div>
              )}

              {formError && (
                <Notice variant="error">
                  <p>{formError}</p>
                  {errorCode?.startsWith('USER_ALREADY_EXISTS') && (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setErrorCode(null);
                        setMode('login');
                      }}
                      className="link mt-1 inline-block text-sm"
                    >
                      <Trans>Log in</Trans>
                    </button>
                  )}
                </Notice>
              )}

              <Button type="submit" className="btn--wide disabled:opacity-75 max-sm:px-3" isLoading={isLoading} size="lg">
                {mode === 'login' && <Trans>Sign In</Trans>}
                {mode === 'register' && <Trans>Create Account</Trans>}
                {mode === 'forgot' && <Trans>Send Reset Link</Trans>}
              </Button>
            </form>

            {mode !== 'forgot' && (
              <>
                <div className="divider">
                  <i />
                  <span><Trans>Or continue with</Trans></span>
                  <i />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    className="w-full px-3 text-sm"
                    type="button"
                    onClick={() => handleSocialSignIn('github')}
                    disabled={isLoading}
                  >
                    <GitHubIcon className="icon" /> <Trans>GitHub</Trans>
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full px-3 text-sm"
                    type="button"
                    onClick={() => handleSocialSignIn('google')}
                    disabled={isLoading}
                  >
                    <GoogleIcon className="icon" /> <Trans>Google</Trans>
                  </Button>
                </div>
              </>
            )}

            {mode === 'login' ? (
              <p className="muted text-center text-sm">
                <Trans>Don't have an account?{' '}</Trans>
                <button
                  type="button"
                  onClick={() => setMode('register')}
                  className="link relative bg-transparent text-ink pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-3 pointer-coarse:after:content-['']"
                >
                  <Trans>Sign up</Trans>
                </button>
              </p>
            ) : mode === 'register' ? (
              <p className="muted text-center text-sm">
                <Trans>Already have an account?{' '}</Trans>
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="link relative bg-transparent text-ink pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-3 pointer-coarse:after:content-['']"
                >
                  <Trans>Log in</Trans>
                </button>
              </p>
            ) : (
              <button
                type="button"
                onClick={() => setMode('login')}
                className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 text-sm text-ink-2 hover:text-ink"
              >
                <ArrowLeft className="icon" aria-hidden="true" /> <Trans>Back to Sign In</Trans>
              </button>
            )}
          </>
        )}
      </div>
    </AuthDesk>
  );
};
