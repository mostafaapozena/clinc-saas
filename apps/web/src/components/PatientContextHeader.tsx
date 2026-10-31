import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '../lib/format';
import { useOrg } from '../org/context';
import { PageHeader } from './PageHeader';
import { ModuleTabs } from './layout';

/**
 * The header of every page about one patient (record, account): the same name, file number and
 * tabs between them, with the way back to the patient list. The viewer stays in the patient's
 * context instead of jumping between modules (UX-018). Tabs follow the viewer's permissions.
 */
export function PatientContextHeader({
  patient,
  children,
}: {
  patient: { id: string; fullName: string; patientNumber: number };
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const { orgId, can } = useOrg();
  const fmt = useFormatters();
  return (
    <>
      <PageHeader
        title={patient.fullName}
        subtitle={t('patients.numberLabel', { number: fmt.number(patient.patientNumber) })}
        back={can('patient.list') ? { to: `/app/${orgId}/patients`, label: t('nav.patients') } : undefined}
      >
        {children}
      </PageHeader>
      <ModuleTabs
        label={t('patients.contextNav')}
        items={[
          ...(can('patient.read') ? [{ to: `/app/${orgId}/patients/${patient.id}`, label: t('finance.patientFile'), end: true }] : []),
          ...(can('finance.account.read') ? [{ to: `/app/${orgId}/finance/patients/${patient.id}`, label: t('finance.account'), end: true }] : []),
        ]}
      />
    </>
  );
}
