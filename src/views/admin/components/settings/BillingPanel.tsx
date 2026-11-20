import React from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { Button, Notice, Skeleton, Tag } from '../../../../components/ui';

type BillingPanelProps = {
  billing: any;
  billingLoading: boolean;
  billingError: string | null;
  activeOrg: any;
  onUpgradeToPro: () => void;
};

// Pro and Business are product names; Free is a word.
const planLabel = (planName?: string) => (!planName || planName === 'Free' ? t`Free` : planName);

// Stripe's subscription statuses, stored as they arrive from the webhook.
const statusLabel = (status: string = 'active') => {
  switch (status) {
    case 'active': return t`Active`;
    case 'trialing': return t`Trial`;
    case 'past_due': return t`Past due`;
    case 'canceled': return t`Canceled`;
    case 'unpaid': return t`Unpaid`;
    case 'paused': return t`Paused`;
    case 'incomplete':
    case 'incomplete_expired': return t`Incomplete`;
    default: return status;
  }
};

export const BillingPanel: React.FC<BillingPanelProps> = ({
  billing,
  billingLoading,
  billingError,
  activeOrg,
  onUpgradeToPro,
}) => {
  const loading = billing === undefined;
  const value = (content: React.ReactNode) => (loading ? <Skeleton className="h-4 w-12" /> : content);

  return (
    <div className="dash-columns dash-columns--7-5">
      <section className="sheet dash-sheet">
        <h2 className="h-sec text-print"><Trans>Plan & Billing</Trans></h2>

        <div className="record__rows dash-plan-rows">
          <div className="record__row"><span><Trans>Current Plan</Trans></span><span className="font-semibold">{value(planLabel(billing?.planName))}</span></div>
          <div className="record__row"><span><Trans>Status</Trans></span><span>{value(statusLabel(billing?.status))}</span></div>
          <div className="record__row">
            <span><Trans>Rooms</Trans></span>
            {billing?.limits?.maxRooms
              ? <span className="fig">{billing.usage?.roomsCount ?? 0}/{billing.limits.maxRooms}</span>
              : <span>{value(<Trans>Room limit: not set</Trans>)}</span>}
          </div>
          <div className="record__row">
            <span><Trans>Recording minutes</Trans></span>
            {billing?.limits?.recordingMinutesIncluded != null
              ? <span className="fig">{billing.usage?.recordingMinutesUsed ?? 0}/{billing.limits.recordingMinutesIncluded}</span>
              : <span>{value(<Trans>Recording mins: not set</Trans>)}</span>}
          </div>
        </div>

        <p><Trans>Pro adds more rooms, higher participant limits and more recording minutes.</Trans></p>

        <div className="dash-plan-actions">
          <Button onClick={onUpgradeToPro} isLoading={billingLoading} disabled={billingLoading || !activeOrg}>
            <Trans>Upgrade to Pro</Trans>
          </Button>
          <Tag variant="quiet"><Trans>Billing portal coming soon</Trans></Tag>
        </div>

        {billingError && (
          <div className="dash-retry">
            <Notice variant="error">{billingError}</Notice>
            <Button variant="secondary" onClick={onUpgradeToPro} disabled={billingLoading || !activeOrg}><Trans>Try Again</Trans></Button>
          </div>
        )}
      </section>

      <p className="muted">
        <Trans>
          Set <code className="fig">STRIPE_SECRET_KEY</code>, <code className="fig">STRIPE_PRICE_PRO</code>, and <code className="fig">SITE_URL</code> in your Convex environment to enable Checkout. Billing portal support will be added in a later release.
        </Trans>
      </p>
    </div>
  );
};
