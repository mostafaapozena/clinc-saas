import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/Icon';
import { Metric } from '../components/Metric';
import { PageHeader } from '../components/PageHeader';
import { ConfirmAction, DataTable, DateText, DescriptionList, FilterBar, Money, Pagination, Quantity, Skeleton } from '../components/data';
import { ActionBar, CardGrid, IconLabel, MetricGrid, ModuleTabs } from '../components/layout';
import { Badge, EmptyState, Field, Notice } from '../components/ui';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { ThemeSwitcher } from '../components/ThemeSwitcher';

// Development-only catalog of the design system (docs/DESIGN_SYSTEM.md). Mounted at /dev/gallery
// only when `import.meta.env.DEV` is true, so it is never part of a production build. Sample data
// is invented and generic; review a component here in both languages and themes before using it.

type Row = { id: string; code: string; name: string; qty: number; unit: string; expiry: string | null; value: number };
const ROWS: Row[] = [
  { id: '1', code: 'GLV-M', name: 'Examination gloves (M)', qty: 400, unit: 'piece', expiry: null, value: 60000 },
  { id: '2', code: 'ANS-2', name: 'Local anesthetic cartridge', qty: 60, unit: 'cartridge', expiry: '2026-12-12', value: 108000 },
  { id: '3', code: 'CMP-A2', name: 'Composite resin A2', qty: 8, unit: 'syringe', expiry: '2027-12-02', value: 256000 },
];

export function Gallery() {
  const { i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'qty', dir: 'desc' });
  return (
    <main className="content gallery" id="main-content" dir={i18n.dir()}>
      <PageHeader
        title="Design system gallery"
        subtitle="Development only · every shared component and its states"
        back={{ to: '/', label: 'Home' }}
        help="Static policy text lives here, not in a banner."
      >
        <ThemeSwitcher />
        <LanguageSwitcher />
      </PageHeader>

      <section className="card" aria-labelledby="g-patterns">
        <h2 id="g-patterns">Page patterns (docs/UI_PAGE_PATTERNS.md)</h2>
        <h3>Header: back link, secondary actions, one primary action with an icon</h3>
        <PageHeader title="Supplier · Medical Supplies Co." subtitle="Detail page" back={{ to: '/dev/gallery', label: 'Suppliers' }}>
          <button type="button" className="button button--secondary">
            Print
          </button>
          <button type="button" className="button button--primary">
            <Icon name="plus" /> New purchase order
          </button>
        </PageHeader>
        <CardGrid wide>
          <section className="card" aria-labelledby="g-detail">
            <h3 id="g-detail">Detail: description list, status, consequential action last</h3>
            <DescriptionList
              items={[
                { label: 'Status', value: <Badge tone="success">Active</Badge> },
                { label: 'Payment terms', value: '30 days' },
                { label: 'Since', value: <DateText value="2026-01-15" /> },
              ]}
            />
            <ConfirmAction
              label="Archive supplier"
              message="New orders will not offer this supplier. Existing documents are kept."
              onConfirm={() => {}}
            />
          </section>
          <form className="card" aria-labelledby="g-form" onSubmit={(e) => e.preventDefault()}>
            <h3 id="g-form">Create / edit: fields, then one action row</h3>
            <div className="form-grid">
              <Field id="g-supplier" label="Supplier name" hint="As on their invoices.">
                <input id="g-supplier" required />
              </Field>
              <Field id="g-terms" label="Payment terms (days)" error="Enter a whole number of days.">
                <input id="g-terms" inputMode="numeric" defaultValue="3o" />
              </Field>
            </div>
            <ActionBar>
              <button type="submit" className="button button--primary">
                Save supplier
              </button>
              <button type="button" className="button button--secondary">
                Cancel
              </button>
            </ActionBar>
          </form>
        </CardGrid>
        <h3>Grouped module tabs: related pages share a primary tab with a second row</h3>
        <ModuleTabs
          label="Grouped example"
          groups={{ books: 'Books' }}
          items={[
            { to: '/dev/gallery/sample-overview', label: 'Overview', end: true },
            { to: '/dev/gallery', label: 'Journal', group: 'books', end: true },
            { to: '/dev/gallery/sample-chart', label: 'Chart of accounts', group: 'books' },
            { to: '/dev/gallery/sample-periods', label: 'Periods' },
          ]}
        />
      </section>

      <section className="card" aria-labelledby="g-tabs">
        <h2 id="g-tabs">ModuleTabs</h2>
        <ModuleTabs
          label="Example tabs"
          items={['Overview', 'Accounts', 'Journal', 'Statements and reports', 'Cash flow', 'Budgets', 'Commitments', 'Staff funds', 'Periods'].map(
            (l, i) => ({
              // Only the first is the current page; the others are samples.
              to: i === 0 ? '/dev/gallery' : `/dev/gallery/sample-${i}`,
              label: l,
              end: true,
            }),
          )}
        />
      </section>

      <section className="card" aria-labelledby="g-badges">
        <h2 id="g-badges">Badge tones and buttons</h2>
        <ActionBar>
          <Badge tone="success">Active</Badge>
          <Badge tone="warning">Below reorder level</Badge>
          <Badge tone="danger">Expired</Badge>
          <Badge tone="info">Draft</Badge>
          <Badge>Neutral</Badge>
        </ActionBar>
        <ActionBar>
          <button type="button" className="button button--primary">
            Primary
          </button>
          <button type="button" className="button button--secondary">
            Secondary
          </button>
          <button type="button" className="button button--ghost">
            Ghost
          </button>
          <button type="button" className="button button--danger-outline">
            Danger outline
          </button>
          <button type="button" className="button button--danger">
            Danger
          </button>
          <button type="button" className="button button--secondary button--sm">
            Small
          </button>
        </ActionBar>
        <ConfirmAction
          label="Archive item"
          message="The item will no longer be offered for new operations. You can restore it later."
          onConfirm={() => {}}
        />
      </section>

      <section className="card" aria-labelledby="g-metrics">
        <h2 id="g-metrics">MetricGrid</h2>
        <MetricGrid>
          <Metric icon="box" label="Active items" value={4} />
          <Metric icon="alert" tone="warn" label="Below reorder level" value={1} to="/dev/gallery" linkLabel="Review items below reorder level" />
          <Metric icon="wallet" label="Owed by patients" value={15000} hint="From documents" format={(v) => `EGP ${(v / 100).toFixed(2)}`} />
          <Metric icon="ban" label="Expired lots" value={0} />
        </MetricGrid>
      </section>

      <section className="card" aria-labelledby="g-table">
        <h2 id="g-table">FilterBar, DataTable, Pagination</h2>
        <FilterBar active={Boolean(filter)} onReset={() => setFilter('')}>
          <Field id="g-filter" label="Warehouse">
            <select id="g-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">All warehouses</option>
              <option value="main">Main store</option>
            </select>
          </Field>
        </FilterBar>
        <DataTable
          caption="Stock"
          rows={ROWS}
          rowKey={(r) => r.id}
          sort={sort}
          onSort={setSort}
          columns={[
            { key: 'code', label: 'Code', cell: (r) => <bdi dir="ltr">{r.code}</bdi> },
            { key: 'name', label: 'Item', cell: (r) => r.name, sortable: true },
            { key: 'expiry', label: 'Expiry', cell: (r) => <DateText value={r.expiry} /> },
            { key: 'qty', label: 'Quantity', numeric: true, sortable: true, cell: (r) => <Quantity value={r.qty} unit={r.unit} /> },
            { key: 'value', label: 'Value', numeric: true, cell: (r) => <Money minor={r.value} currency="EGP" /> },
          ]}
        />
        <Pagination page={page} pageSize={20} total={57} onPage={setPage} />
      </section>

      <CardGrid wide>
        <section className="card" aria-labelledby="g-details">
          <h2 id="g-details">DescriptionList</h2>
          <DescriptionList
            items={[
              { label: 'Code', value: <bdi dir="ltr">ANS-2</bdi> },
              { label: 'Base unit', value: 'cartridge' },
              { label: 'Next expiry', value: <DateText value="2026-12-12" /> },
            ]}
          />
        </section>
        <section className="card" aria-labelledby="g-states">
          <h2 id="g-states">States</h2>
          <EmptyState icon="box" action={<a href="#g-table">Add the first item</a>}>
            No items yet.
          </EmptyState>
          <Skeleton lines={3} />
          <Notice kind="info">Info: something to know now.</Notice>
          <Notice kind="warning">Warning: something needs action.</Notice>
          <Notice kind="error">Error: what failed and what to do.</Notice>
          <Notice kind="success">Saved.</Notice>
        </section>
      </CardGrid>

      <section className="card" aria-labelledby="g-fields">
        <h2 id="g-fields">Field states</h2>
        <form className="form-grid" onSubmit={(e) => e.preventDefault()}>
          <Field id="g-name" label="Name" hint="As printed on invoices.">
            <input id="g-name" required />
          </Field>
          <Field id="g-amount" label="Amount" error="Enter an amount like 750.50.">
            <input id="g-amount" inputMode="decimal" defaultValue="7,5" />
          </Field>
          <Field id="g-date" label="Date">
            <input id="g-date" type="date" />
          </Field>
          <Field id="g-select" label="Branch">
            <select id="g-select">
              <option>Main branch</option>
            </select>
          </Field>
        </form>
        <IconLabel icon="help" title="IconLabel" description="An icon box beside wrapping text; the icon never touches the text." />
      </section>
    </main>
  );
}
