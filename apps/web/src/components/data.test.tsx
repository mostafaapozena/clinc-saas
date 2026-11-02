import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { useUrlState } from '../lib/useUrlState';
import { ConfirmAction, DataTable, DateText, DescriptionList, Money, Pagination, Quantity } from './data';

type Row = { id: string; name: string; qty: number };
const rows: Row[] = [
  { id: 'a', name: 'Gloves', qty: 12 },
  { id: 'b', name: 'Masks', qty: 3 },
];

describe('DataTable', () => {
  it('labels cells for stacked rows and aligns numeric columns', () => {
    render(
      <DataTable
        testId="t"
        rows={rows}
        rowKey={(r) => r.id}
        columns={[{ key: 'name', label: 'الصنف', cell: (r) => r.name }, { key: 'qty', label: 'الكمية', numeric: true, cell: (r) => r.qty }, false]}
      />,
    );
    const cells = screen.getAllByRole('cell');
    expect(cells).toHaveLength(4);
    expect(cells[1]).toHaveAttribute('data-label', 'الكمية');
    expect(cells[1]).toHaveClass('num');
    expect(screen.getAllByRole('columnheader')[1]).toHaveClass('num');
  });

  it('asks for the next order from the server instead of sorting the page', () => {
    const onSort = vi.fn();
    render(
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        sort={{ key: 'qty', dir: 'asc' }}
        onSort={onSort}
        columns={[
          { key: 'name', label: 'الصنف', cell: (r) => r.name, sortable: true },
          { key: 'qty', label: 'الكمية', numeric: true, sortable: true, cell: (r) => r.qty },
        ]}
      />,
    );
    const [name, qty] = screen.getAllByRole('columnheader');
    expect(qty).toHaveAttribute('aria-sort', 'ascending');
    expect(name).not.toHaveAttribute('aria-sort');
    fireEvent.click(screen.getByRole('button', { name: /الكمية/ }));
    expect(onSort).toHaveBeenCalledWith({ key: 'qty', dir: 'desc' });
    // Rows keep the server's order.
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Gloves');
  });
});

describe('Pagination', () => {
  it('states the position and stops at the ends', () => {
    const onPage = vi.fn();
    render(<Pagination page={1} pageSize={50} total={120} onPage={onPage} />);
    expect(screen.getByRole('navigation')).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: 'السابق' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it('is not shown when everything fits on one page', () => {
    const { container } = render(<Pagination page={1} pageSize={50} total={10} onPage={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('formatting components', () => {
  it('formats a calendar date, never the raw ISO text', () => {
    render(<DateText value="2026-10-31" />);
    const time = screen.getByText((_, el) => el?.tagName === 'TIME');
    expect(time).toHaveAttribute('datetime', '2026-10-31');
    expect(time.textContent).not.toBe('2026-10-31');
    expect(time.textContent).toContain('2026');
  });

  it('shows money with its currency and a dash when there is none', () => {
    const { rerender } = render(<Money minor={150050} currency="EGP" />);
    expect(screen.getByText(/1,500\.50/)).toBeInTheDocument();
    rerender(<Money minor={150050} currency={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('signs incoming quantities', () => {
    render(<Quantity value={5} unit="علبة" signed />);
    expect(screen.getByText('+5')).toBeInTheDocument();
  });

  it('lists label and value pairs, skipping hidden ones', () => {
    render(<DescriptionList items={[{ label: 'الكود', value: 'A-1' }, false, { label: 'الحالة', value: 'نشط' }]} />);
    expect(screen.getAllByRole('term')).toHaveLength(2);
    expect(screen.getAllByRole('definition')[0]).toHaveTextContent('A-1');
  });
});

describe('ConfirmAction', () => {
  it('confirms in place and moves focus to cancel', () => {
    const onConfirm = vi.fn();
    render(<ConfirmAction label="أرشفة الصنف" message="لن يظهر الصنف في العمليات الجديدة." onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'أرشفة الصنف' }));
    expect(screen.getByText('لن يظهر الصنف في العمليات الجديدة.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إلغاء' })).toHaveFocus();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'أرشفة الصنف' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('Escape and cancel close without acting and return focus to the button that opened it', () => {
    const onConfirm = vi.fn();
    render(<ConfirmAction label="أرشفة الصنف" message="لن يظهر الصنف في العمليات الجديدة." onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'أرشفة الصنف' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'إلغاء' }), { key: 'Escape' });
    expect(screen.queryByText('لن يظهر الصنف في العمليات الجديدة.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'أرشفة الصنف' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'أرشفة الصنف' }));
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }));
    expect(screen.getByRole('button', { name: 'أرشفة الصنف' })).toHaveFocus();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('useUrlState', () => {
  function Probe() {
    const url = useUrlState();
    const location = useLocation();
    return (
      <>
        <output>{location.search}</output>
        <button type="button" onClick={() => url.set({ item: 'i1', page: null })}>
          filter
        </button>
        <button type="button" onClick={() => url.set({ item: '' })}>
          reset
        </button>
      </>
    );
  }

  it('keeps filters in the address and drops empty ones', () => {
    render(
      <MemoryRouter initialEntries={['/x?page=3']}>
        <Probe />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'filter' }));
    expect(screen.getByRole('status')).toHaveTextContent('?item=i1');
    fireEvent.click(screen.getByRole('button', { name: 'reset' }));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
