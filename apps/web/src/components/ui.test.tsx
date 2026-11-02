import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Field } from './ui';

describe('Field with a native date input', () => {
  it('states the chosen day with the month by name and ties it to the input', () => {
    // 03/04/2026 in a native field is 4 March or 3 April depending on the browser's language.
    render(
      <Field id="due" label="تاريخ الاستحقاق" hint="آخر يوم للسداد">
        <input id="due" type="date" value="2026-03-04" onChange={() => {}} />
      </Field>,
    );
    const day = screen.getByText(/4 مارس 2026/);
    expect(day).toHaveAttribute('id', 'due-date');
    expect(screen.getByLabelText('تاريخ الاستحقاق')).toHaveAttribute('aria-describedby', 'due-date due-hint');
  });

  it('says nothing while the date is empty or not a date input', () => {
    render(
      <>
        <Field id="empty" label="من">
          <input id="empty" type="date" value="" onChange={() => {}} />
        </Field>
        <Field id="text" label="نص">
          <input id="text" value="2026-03-04" onChange={() => {}} />
        </Field>
      </>,
    );
    expect(document.querySelector('.date-echo')).toBeNull();
    expect(screen.getByLabelText('من')).not.toHaveAttribute('aria-describedby');
  });
});
