import { useTranslation } from 'react-i18next';
import { formatMoney } from '../lib/finance';
import type { PlanPrice } from '../lib/operator';

// Shared by the clinic subscription page and the operator console.

export function SubscriptionStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return <span className={`badge badge--subscription-${status}`}>{t(`subscription.status.${status}`)}</span>;
}

export function PriceText({ price }: { price: PlanPrice }) {
  const { t, i18n } = useTranslation();
  return (
    <>
      {formatMoney(price.amountMinor, price.currency, i18n.resolvedLanguage ?? 'ar')} / {t(`subscription.interval.${price.interval}`)}
    </>
  );
}
