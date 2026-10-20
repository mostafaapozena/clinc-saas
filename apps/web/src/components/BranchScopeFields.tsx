import { useTranslation } from 'react-i18next';
import type { Branch, BranchScope } from '../lib/types';

/** Radio + checkboxes for organization-wide or selected-branch access. */
export function BranchScopeFields({
  idPrefix,
  scope,
  branches,
  onChange,
  error,
}: {
  idPrefix: string;
  scope: BranchScope;
  branches: Branch[];
  onChange: (scope: BranchScope) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const toggle = (id: string, checked: boolean) =>
    onChange({
      type: 'selected',
      branchIds: checked ? [...scope.branchIds, id] : scope.branchIds.filter((b) => b !== id),
    });

  return (
    <fieldset className="fieldset">
      <legend>{t('team.scopeLabel')}</legend>
      <label className="choice">
        <input
          type="radio"
          name={`${idPrefix}-scope`}
          checked={scope.type === 'all'}
          onChange={() => onChange({ type: 'all', branchIds: [] })}
        />
        {t('team.scopeAll')}
      </label>
      <label className="choice">
        <input
          type="radio"
          name={`${idPrefix}-scope`}
          checked={scope.type === 'selected'}
          onChange={() => onChange({ type: 'selected', branchIds: scope.branchIds })}
        />
        {t('team.scopeSelected')}
      </label>
      {scope.type === 'selected' && (
        <div className="choice-group" role="group" aria-label={t('team.selectBranches')}>
          {branches.map((branch) => (
            <label key={branch.id} className="choice">
              <input
                type="checkbox"
                checked={scope.branchIds.includes(branch.id)}
                onChange={(e) => toggle(branch.id, e.target.checked)}
              />
              {branch.name}
            </label>
          ))}
        </div>
      )}
      {error && <p className="field-error">{error}</p>}
    </fieldset>
  );
}
