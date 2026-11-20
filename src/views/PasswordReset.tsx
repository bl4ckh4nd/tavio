import React, { useEffect, useMemo, useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { ArrowLeft } from 'lucide-react';
import { Button, Input, Notice } from '../components/ui';
import { authClient } from '../lib/authClient';
import { AppView } from '../types';
import { AuthDesk } from './Auth';

interface PasswordResetProps {
  token?: string;
  onNavigate: (view: AppView) => void;
}

export const PasswordReset: React.FC<PasswordResetProps> = ({ token, onNavigate }) => {
  const { _ } = useLingui();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<{ password?: string; confirmPassword?: string }>({});

  const { resolvedToken, errorParam } = useMemo(() => {
    if (typeof window === 'undefined') {
      return { resolvedToken: token, errorParam: null as string | null };
    }
    const params = new URLSearchParams(window.location.search);
    return {
      resolvedToken: token || params.get('token') || undefined,
      errorParam: params.get('error'),
    };
  }, [token]);

  useEffect(() => {
    if (errorParam === 'INVALID_TOKEN') {
      setError(_(/* i18n */ 'Invalid or expired reset link. Please request a new password reset.'));
      return;
    }
    if (!resolvedToken || resolvedToken.length < 10) {
      setError(_(/* i18n */ 'Invalid or missing reset token. Please request a new password reset.'));
    }
  }, [resolvedToken, errorParam, _]);

  const validatePassword = (pwd: string): string | null => {
    if (pwd.length < 8) {
      return _(/* i18n */ 'Password must be at least 8 characters');
    }
    if (!/[A-Z]/.test(pwd)) {
      return _(/* i18n */ 'Password must contain at least one uppercase letter');
    }
    if (!/[a-z]/.test(pwd)) {
      return _(/* i18n */ 'Password must contain at least one lowercase letter');
    }
    if (!/[0-9]/.test(pwd)) {
      return _(/* i18n */ 'Password must contain at least one number');
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setValidationErrors({});

    if (!resolvedToken) {
      setError(_(/* i18n */ 'Invalid or missing reset token. Please request a new password reset.'));
      return;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      setValidationErrors({ password: passwordError });
      return;
    }

    if (password !== confirmPassword) {
      setValidationErrors({ confirmPassword: _(/* i18n */ 'Passwords do not match') });
      return;
    }

    setLoading(true);

    try {
      const result = await authClient.resetPassword({
        token: resolvedToken,
        newPassword: password,
      });
      if (result?.error) {
        throw new Error(result.error.message || _(/* i18n */ 'Failed to reset password. The link may have expired.'));
      }
      setSuccess(true);
      setTimeout(() => onNavigate(AppView.AUTH), 3000);
    } catch (err: any) {
      setError(err?.message || _(/* i18n */ 'Failed to reset password. The link may have expired.'));
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <AuthDesk onHome={() => onNavigate(AppView.LANDING)}>
        <div className="authsheet stock stock--lift">
          <div>
            <h1 className="th__h">
              <Trans>Password Reset Successful</Trans>
            </h1>
            <p className="muted mt-1.5 text-md">
              <Trans>Your password has been updated. Redirecting to login...</Trans>
            </p>
          </div>
          <Button onClick={() => onNavigate(AppView.AUTH)} className="btn--wide">
            <Trans>Go to Login</Trans>
          </Button>
        </div>
      </AuthDesk>
    );
  }

  return (
    <AuthDesk onHome={() => onNavigate(AppView.LANDING)}>
      <div className="authsheet stock stock--lift">
        <div>
          <h1 className="th__h">
            <Trans>Reset Your Password</Trans>
          </h1>
          <p className="muted mt-1.5 text-md">
            <Trans>Enter your new password below</Trans>
          </p>
        </div>

        {error && (
          <Notice variant="error">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => onNavigate(AppView.AUTH)}
              className="link mt-1 inline-block text-sm"
            >
              <Trans>Go to Login</Trans>
            </button>
          </Notice>
        )}

        <form onSubmit={handleSubmit} className="grid gap-4">
          <Input
            label={_(
              /* i18n */ 'New Password',
            )}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            error={validationErrors.password}
          />

          <Input
            label={_(
              /* i18n */ 'Confirm Password',
            )}
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            required
            error={validationErrors.confirmPassword}
          />

          <div className="field__help">
            <Trans>Password requirements:</Trans>
            <ul className="mt-1 list-inside list-disc">
              <li><Trans>At least 8 characters</Trans></li>
              <li><Trans>One uppercase letter</Trans></li>
              <li><Trans>One lowercase letter</Trans></li>
              <li><Trans>One number</Trans></li>
            </ul>
          </div>

          <Button
            type="submit"
            disabled={loading || !password || !confirmPassword}
            className="btn--wide max-sm:px-3"
            isLoading={loading}
          >
            {loading ? <Trans>Resetting...</Trans> : <Trans>Reset Password</Trans>}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => onNavigate(AppView.AUTH)}
          className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 text-sm text-ink-2 hover:text-ink"
        >
          <ArrowLeft className="icon" aria-hidden="true" />
          <Trans>Back to Login</Trans>
        </button>
      </div>
    </AuthDesk>
  );
};
