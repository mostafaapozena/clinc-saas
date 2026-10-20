import { useSpecialtyNames } from '../lib/specialties';

/**
 * A group of specialty checkboxes. `options` limits the choice (e.g. a branch can only offer the
 * organization's specialties); without it, the whole platform catalog is offered.
 */
export function SpecialtyCheckboxes({
  id,
  legend,
  hint,
  error,
  value,
  onChange,
  options,
}: {
  id: string;
  legend: string;
  hint?: string;
  error?: string;
  value: string[];
  onChange: (codes: string[]) => void;
  options?: string[];
}) {
  const specialties = useSpecialtyNames();
  const codes = options ?? specialties.list.map((s) => s.code);
  // Keeps the catalog order, whatever order the boxes were ticked in.
  const toggle = (code: string, checked: boolean) => {
    const next = new Set(value);
    if (checked) next.add(code);
    else next.delete(code);
    onChange(codes.filter((c) => next.has(c)));
  };
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <fieldset className="fieldset" id={id} aria-describedby={describedBy} aria-invalid={error ? true : undefined}>
      <legend>{legend}</legend>
      {hint && !error && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
      <div className="choice-group choice-group--flush">
        {codes.map((code) => (
          <label key={code} className="choice">
            <input
              type="checkbox"
              name={id}
              value={code}
              checked={value.includes(code)}
              onChange={(e) => toggle(code, e.target.checked)}
            />
            <span>{specialties.name(code)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
