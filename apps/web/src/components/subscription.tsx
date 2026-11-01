import { useTranslation } from 'react-i18next';
import type { PlanPrice } from '../lib/operator';
import { Money } from './data';

// Shared by the clinic subscription page and the operator console.

export function SubscriptionStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return <span className={`badge badge--subscription-${status}`}>{t(`subscription.status.${status}`)}</span>;
}

export function PriceText({ price }: { price: PlanPrice }) {
  const { t } = useTranslation();
  return (
    <>
      <Money minor={price.amountMinor} currency={price.currency} /> / {t(`subscription.interval.${price.interval}`)}
    </>
  );
}
