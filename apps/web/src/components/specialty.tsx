import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useFormatters } from '../lib/format';
import { useDentalChart, usePhysioCourses, useSpecialtySummary } from '../lib/specialty';
import {
  ENT_EXAMINATION,
  ENT_HISTORY,
  PERMANENT_ROWS,
  PLAN_STATUSES,
  PRIMARY_ROWS,
  SURFACES,
  isEditable,
  newItemId,
  withDefaults,
  type DentistryData,
  type EntData,
  type PhysioAssessmentData,
  type PhysioDischargeData,
  type PhysioSessionData,
  type PlanStatus,
  type SpecialtyRecord,
  type Surface,
} from '../lib/templates';
import { useOrg } from '../org/context';
import { EmptyState, Field, Loading } from './ui';
import { DateText } from './data';

// Specialty parts of a visit record (docs/architecture/SPECIALTY_WORKSPACES.md). Everything here
// is entered by the clinician; nothing is suggested, scored or generated. Templates are provisional
// until practising clinicians review them.

type EditorProps<T> = { value: T; onChange: (next: T) => void; patientId: string; encounterId: string; errors: Record<string, string> };

/** The editable specialty part of a draft, by template. Unknown versions are shown read-only. */
export function SpecialtyEditor({
  specialty,
  value,
  onChange,
  patientId,
  encounterId,
  errors,
}: {
  specialty: SpecialtyRecord;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  patientId: string;
  encounterId: string;
  errors: Record<string, string>;
}) {
  const { t } = useTranslation();
  if (!isEditable(specialty)) {
    return (
      <section className="card specialty-card">
        <h3>{t(`specialty.templates.${specialty.template}`, { defaultValue: specialty.template })}</h3>
        <p className="muted">{t('specialty.otherVersion', { version: specialty.version })}</p>
        <SpecialtyView specialty={specialty} />
      </section>
    );
  }
  const props = { patientId, encounterId, errors };
  const data = withDefaults(specialty.template, value);
  return (
    <section className="specialty-card" aria-labelledby="specialty-title">
      <h3 id="specialty-title">{t(`specialty.templates.${specialty.template}`)}</h3>
      <p className="muted small">{t('specialty.provisional')}</p>
      {specialty.template === 'dentistry.visit' && <DentistryEditor value={data as DentistryData} onChange={onChange} {...props} />}
      {specialty.template === 'physiotherapy.assessment' && <PhysioAssessmentEditor value={data as PhysioAssessmentData} onChange={onChange} {...props} />}
      {(specialty.template === 'physiotherapy.session' || specialty.template === 'physiotherapy.discharge') && (
        <PhysioCourseEditor kind={specialty.template} value={data as PhysioSessionData & PhysioDischargeData} onChange={onChange} {...props} />
      )}
      {specialty.template === 'ent.visit' && <EntEditor value={data as EntData} onChange={onChange} {...props} />}
      {Object.keys(errors).some((k) => k.startsWith('specialty.')) && (
        <p className="field-error" role="alert">
          {t('specialty.fixErrors')}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Dentistry

function ToothGrid({ selected, onSelect, marked, primary }: { selected: string | null; onSelect: (tooth: string) => void; marked: Set<string>; primary: boolean }) {
  const { t } = useTranslation();
  const rows = primary ? PRIMARY_ROWS : PERMANENT_ROWS;
  return (
    // The chart is anatomical (patient's right on the viewer's left) in both languages.
    <div className="tooth-chart" dir="ltr" role="group" aria-label={t('specialty.dental.chart')}>
      {(['upper', 'lower'] as const).map((jaw) => (
        <div key={jaw} className="tooth-row" role="group" aria-label={t(`specialty.dental.${jaw}`)}>
          {rows[jaw].map((n) => {
            const tooth = String(n);
            return (
              <button
                key={tooth}
                type="button"
                className={`tooth${marked.has(tooth) ? ' tooth--marked' : ''}`}
                aria-pressed={selected === tooth}
                aria-label={t('specialty.dental.tooth', { n: tooth })}
                onClick={() => onSelect(tooth)}
              >
                {tooth}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function DentistryEditor({ value, onChange, patientId, encounterId, errors }: EditorProps<DentistryData>) {
  const { t } = useTranslation();
  const chart = useDentalChart(patientId);
  const [tooth, setTooth] = useState<string | null>(null);
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [note, setNote] = useState('');
  const [procedure, setProcedure] = useState('');
  const [planned, setPlanned] = useState('');
  const set = (patch: Partial<DentistryData>) => onChange({ ...value, ...patch });
  const marked = new Set([...(chart.data?.teeth.map((x) => x.tooth) ?? []), ...value.findings.map((f) => f.tooth)]);
  const history = chart.data?.teeth.find((x) => x.tooth === tooth)?.entries ?? [];
  // Plan items from earlier, finalized visits that are still open.
  const openItems = (chart.data?.planItems ?? []).filter((i) => i.sourceEncounterId !== encounterId && (i.status === 'planned' || i.status === 'in_progress'));
  const updateFor = (itemId: string, source: string) => value.planUpdates.find((u) => u.itemId === itemId && u.sourceEncounterId === source);

  return (
    <div className="specialty-grid">
      <Field id="dentition" label={t('specialty.dental.dentition')}>
        <select id="dentition" value={value.dentition} onChange={(e) => set({ dentition: e.target.value as DentistryData['dentition'] })}>
          {(['permanent', 'primary', 'mixed'] as const).map((d) => (
            <option key={d} value={d}>
              {t(`specialty.dental.dentitions.${d}`)}
            </option>
          ))}
        </select>
      </Field>
      <ToothGrid selected={tooth} onSelect={setTooth} marked={marked} primary={false} />
      {value.dentition !== 'permanent' && <ToothGrid selected={tooth} onSelect={setTooth} marked={marked} primary />}
      <p className="muted small">{tooth ? t('specialty.dental.selected', { n: tooth }) : t('specialty.dental.selectTooth')}</p>

      {tooth && (
        <div className="specialty-subform" data-testid="tooth-panel">
          {history.length > 0 && (
            <>
              <h4>{t('specialty.dental.history', { n: tooth })}</h4>
              <ul className="plain-list">
                {history.map((h, i) => (
                  <li key={i} className="small">
                    <DateText value={h.date} /> · {t(`specialty.dental.kind.${h.kind}`)}
                    {h.surfaces.length > 0 && <> ({h.surfaces.join(', ')})</>}: <span className="record-text">{h.text}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <fieldset className="fieldset">
            <legend>{t('specialty.dental.surfaces')}</legend>
            {SURFACES.map((s) => (
              <label key={s} className="choice">
                <input
                  type="checkbox"
                  checked={surfaces.includes(s)}
                  onChange={(e) => setSurfaces(e.target.checked ? [...surfaces, s] : surfaces.filter((x) => x !== s))}
                />
                {t(`specialty.dental.surface.${s}`)}
              </label>
            ))}
          </fieldset>
          <Field id="finding-note" label={t('specialty.dental.findingNote')}>
            <input id="finding-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <button
            type="button"
            className="button button--secondary"
            disabled={!note.trim()}
            onClick={() => {
              set({ findings: [...value.findings, { id: newItemId(), tooth, surfaces, note }] });
              setNote('');
              setSurfaces([]);
            }}
          >
            {t('specialty.dental.addFinding')}
          </button>
          <Field id="procedure-text" label={t('specialty.dental.procedure')}>
            <input id="procedure-text" maxLength={200} value={procedure} onChange={(e) => setProcedure(e.target.value)} />
          </Field>
          <button
            type="button"
            className="button button--secondary"
            disabled={!procedure.trim()}
            onClick={() => {
              set({ procedures: [...value.procedures, { id: newItemId(), tooth, description: procedure }] });
              setProcedure('');
            }}
          >
            {t('specialty.dental.addProcedure')}
          </button>
          <Field id="plan-text" label={t('specialty.dental.planItem')}>
            <input id="plan-text" maxLength={200} value={planned} onChange={(e) => setPlanned(e.target.value)} />
          </Field>
          <button
            type="button"
            className="button button--secondary"
            disabled={!planned.trim()}
            onClick={() => {
              set({ planItems: [...value.planItems, { id: newItemId(), tooth, description: planned }] });
              setPlanned('');
            }}
          >
            {t('specialty.dental.addPlanItem')}
          </button>
        </div>
      )}

      <DentalLists data={value} onRemove={(kind, id) => set({ [kind]: (value[kind] as { id: string }[]).filter((x) => x.id !== id) })} />

      {openItems.length > 0 && (
        <fieldset className="fieldset" data-testid="open-plan-items">
          <legend>{t('specialty.dental.openPlan')}</legend>
          {openItems.map((item) => {
            const current = updateFor(item.id, item.sourceEncounterId);
            const key = `${item.sourceEncounterId}-${item.id}`;
            return (
              <div key={key} className="plan-update">
                <span>
                  {item.tooth ? `${t('specialty.dental.tooth', { n: item.tooth })}: ` : ''}
                  <span className="record-text">{item.description}</span> <span className="muted small">({t(`specialty.dental.status.${item.status}`)})</span>
                </span>
                <select
                  aria-label={t('specialty.dental.updateStatus', { item: item.description })}
                  value={current?.status ?? ''}
                  onChange={(e) => {
                    const rest = value.planUpdates.filter((u) => !(u.itemId === item.id && u.sourceEncounterId === item.sourceEncounterId));
                    const status = e.target.value as PlanStatus | '';
                    set({ planUpdates: status ? [...rest, { itemId: item.id, sourceEncounterId: item.sourceEncounterId, status, note: '' }] : rest });
                  }}
                >
                  <option value="">{t('specialty.dental.noChange')}</option>
                  {PLAN_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`specialty.dental.status.${s}`)}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </fieldset>
      )}
      {errors['specialty.planUpdates.0.itemId'] && <p className="field-error">{t('validation.invalid_reference')}</p>}
    </div>
  );
}

function DentalLists({ data, onRemove }: { data: DentistryData; onRemove?: (kind: 'findings' | 'procedures' | 'planItems', id: string) => void }) {
  const { t } = useTranslation();
  const row = (kind: 'findings' | 'procedures' | 'planItems', id: string, label: string) => (
    <li key={id} className="specialty-item" data-testid={`dental-${kind}`}>
      <span className="record-text">{label}</span>
      {onRemove && (
        <button type="button" className="button button--link" onClick={() => onRemove(kind, id)} aria-label={t('specialty.remove', { item: label })}>
          {t('specialty.removeShort')}
        </button>
      )}
    </li>
  );
  const toothLabel = (tooth: string | null) => (tooth ? `${t('specialty.dental.tooth', { n: tooth })} — ` : '');
  return (
    <div className="specialty-lists">
      <h4>{t('specialty.dental.findings')}</h4>
      {data.findings.length === 0 ? (
        <p className="muted small">{t('specialty.none')}</p>
      ) : (
        <ul className="plain-list">
          {data.findings.map((f) =>
            row('findings', f.id, `${toothLabel(f.tooth)}${f.surfaces.length ? `(${f.surfaces.join(', ')}) ` : ''}${f.note}`),
          )}
        </ul>
      )}
      <h4>{t('specialty.dental.procedures')}</h4>
      {data.procedures.length === 0 ? (
        <p className="muted small">{t('specialty.none')}</p>
      ) : (
        <ul className="plain-list">{data.procedures.map((p) => row('procedures', p.id, `${toothLabel(p.tooth)}${p.description}`))}</ul>
      )}
      <h4>{t('specialty.dental.planItems')}</h4>
      {data.planItems.length === 0 ? (
        <p className="muted small">{t('specialty.none')}</p>
      ) : (
        <ul className="plain-list">{data.planItems.map((p) => row('planItems', p.id, `${toothLabel(p.tooth)}${p.description}`))}</ul>
      )}
      {data.planUpdates.length > 0 && (
        <>
          <h4>{t('specialty.dental.planUpdates')}</h4>
          <ul className="plain-list">
            {data.planUpdates.map((u) => (
              <li key={`${u.sourceEncounterId}-${u.itemId}`} className="small">
                {t(`specialty.dental.status.${u.status}`)}
                {u.note && <> — {u.note}</>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Physiotherapy

function PhysioAssessmentEditor({ value, onChange }: EditorProps<PhysioAssessmentData>) {
  const { t } = useTranslation();
  const [goal, setGoal] = useState('');
  const set = (patch: Partial<PhysioAssessmentData>) => onChange({ ...value, ...patch });
  return (
    <div className="specialty-grid">
      <Field id="physio-limitations" label={t('specialty.physio.limitations')} hint={t('specialty.physio.limitationsHint')}>
        <textarea id="physio-limitations" rows={3} maxLength={2000} value={value.limitations} onChange={(e) => set({ limitations: e.target.value })} />
      </Field>
      <fieldset className="fieldset">
        <legend>{t('specialty.physio.goals')}</legend>
        <ul className="plain-list">
          {value.goals.map((g) => (
            <li key={g.id} className="specialty-item" data-testid="physio-goal">
              <span className="record-text">{g.text}</span>
              <button type="button" className="button button--link" onClick={() => set({ goals: value.goals.filter((x) => x.id !== g.id) })}>
                {t('specialty.removeShort')}
              </button>
            </li>
          ))}
        </ul>
        <Field id="physio-goal" label={t('specialty.physio.newGoal')}>
          <input id="physio-goal" maxLength={300} value={goal} onChange={(e) => setGoal(e.target.value)} />
        </Field>
        <button
          type="button"
          className="button button--secondary"
          disabled={!goal.trim() || value.goals.length >= 10}
          onClick={() => {
            set({ goals: [...value.goals, { id: newItemId(), text: goal }] });
            setGoal('');
          }}
        >
          {t('specialty.physio.addGoal')}
        </button>
      </fieldset>
      <Field id="physio-sessions" label={t('specialty.physio.plannedSessions')} hint={t('specialty.physio.plannedSessionsHint')}>
        <input
          id="physio-sessions"
          type="number"
          inputMode="numeric"
          min={1}
          max={60}
          value={value.plannedSessions ?? ''}
          onChange={(e) => set({ plannedSessions: e.target.value === '' ? null : Math.max(1, Math.min(60, Math.round(Number(e.target.value)))) })}
        />
      </Field>
      <Field id="physio-frequency" label={t('specialty.physio.frequency')}>
        <input id="physio-frequency" maxLength={200} value={value.frequency} onChange={(e) => set({ frequency: e.target.value })} />
      </Field>
      <Field id="physio-course-notes" label={t('specialty.physio.courseNotes')}>
        <textarea id="physio-course-notes" rows={2} maxLength={1000} value={value.courseNotes} onChange={(e) => set({ courseNotes: e.target.value })} />
      </Field>
    </div>
  );
}

function PhysioCourseEditor({
  kind,
  value,
  onChange,
  patientId,
}: EditorProps<PhysioSessionData & PhysioDischargeData> & { kind: 'physiotherapy.session' | 'physiotherapy.discharge' }) {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const courses = usePhysioCourses(patientId);
  const open = (courses.data?.courses ?? []).filter((c) => !c.discharge || c.assessmentId === value.courseEncounterId);
  const course = open.find((c) => c.assessmentId === value.courseEncounterId);
  const set = (patch: Partial<PhysioSessionData & PhysioDischargeData>) => onChange({ ...value, ...patch });
  const noteFor = (goalId: string) => value.goalNotes.find((n) => n.goalId === goalId)?.note ?? '';
  return (
    <div className="specialty-grid">
      <Field id="physio-course" label={t('specialty.physio.course')} hint={t('specialty.physio.courseHint')}>
        <select id="physio-course" value={value.courseEncounterId ?? ''} onChange={(e) => set({ courseEncounterId: e.target.value || null, goalNotes: [] })}>
          <option value="">{t('common.choose')}</option>
          {open.map((c) => (
            <option key={c.assessmentId} value={c.assessmentId}>
              {t('specialty.physio.courseOption', {
                date: fmt.date(c.startedAt),
                done: fmt.number(c.completedSessions),
                planned: c.plannedSessions ? fmt.number(c.plannedSessions) : '—',
              })}
            </option>
          ))}
        </select>
      </Field>
      {courses.isSuccess && open.length === 0 && <p className="muted small">{t('specialty.physio.noCourse')}</p>}
      {kind === 'physiotherapy.session' ? (
        <>
          <Field id="physio-performed" label={t('specialty.physio.performed')}>
            <textarea id="physio-performed" rows={3} maxLength={2000} value={value.performed} onChange={(e) => set({ performed: e.target.value })} />
          </Field>
          <Field id="physio-progress" label={t('specialty.physio.progress')}>
            <textarea id="physio-progress" rows={3} maxLength={2000} value={value.progress} onChange={(e) => set({ progress: e.target.value })} />
          </Field>
        </>
      ) : (
        <Field id="physio-summary" label={t('specialty.physio.summary')} hint={t('specialty.physio.summaryHint')}>
          <textarea id="physio-summary" rows={4} maxLength={2000} value={value.summary} onChange={(e) => set({ summary: e.target.value })} />
        </Field>
      )}
      {course && course.goals.length > 0 && (
        <fieldset className="fieldset">
          <legend>{t('specialty.physio.goalNotes')}</legend>
          {course.goals.map((g) => (
            <Field key={g.id} id={`goal-note-${g.id}`} label={g.text}>
              <input
                id={`goal-note-${g.id}`}
                maxLength={300}
                value={noteFor(g.id)}
                onChange={(e) => {
                  const rest = value.goalNotes.filter((n) => n.goalId !== g.id);
                  set({ goalNotes: e.target.value ? [...rest, { goalId: g.id, note: e.target.value }] : rest });
                }}
              />
            </Field>
          ))}
        </fieldset>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// ENT

function EntEditor({ value, onChange }: EditorProps<EntData>) {
  const { t } = useTranslation();
  return (
    <div className="specialty-grid">
      <fieldset className="fieldset">
        <legend>{t('specialty.ent.historyTitle')}</legend>
        {ENT_HISTORY.map((k) => (
          <Field key={k} id={`ent-history-${k}`} label={t(`specialty.ent.history.${k}`)}>
            <textarea
              id={`ent-history-${k}`}
              rows={2}
              maxLength={1000}
              value={value.history[k]}
              onChange={(e) => onChange({ ...value, history: { ...value.history, [k]: e.target.value } })}
            />
          </Field>
        ))}
      </fieldset>
      <fieldset className="fieldset">
        <legend>{t('specialty.ent.examinationTitle')}</legend>
        {ENT_EXAMINATION.map((k) => (
          <Field key={k} id={`ent-exam-${k}`} label={t(`specialty.ent.examination.${k}`)}>
            <textarea
              id={`ent-exam-${k}`}
              rows={2}
              maxLength={1000}
              value={value.examination[k]}
              onChange={(e) => onChange({ ...value, examination: { ...value.examination, [k]: e.target.value } })}
            />
          </Field>
        ))}
      </fieldset>
      <Field id="ent-follow-up" label={t('specialty.ent.followUp')}>
        <textarea id="ent-follow-up" rows={2} maxLength={500} value={value.followUp} onChange={(e) => onChange({ ...value, followUp: e.target.value })} />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Read-only

export function SpecialtyView({ specialty }: { specialty: SpecialtyRecord }) {
  const { t } = useTranslation();
  const data = withDefaults(specialty.template, specialty.data);
  const text = (label: string, value: unknown) =>
    typeof value === 'string' && value ? (
      <div key={label}>
        <dt>{label}</dt>
        <dd className="record-text">{value}</dd>
      </div>
    ) : null;
  return (
    <div className="specialty-view" data-testid="specialty-view">
      <h3>
        {t(`specialty.templates.${specialty.template}`, { defaultValue: specialty.template })}{' '}
        <span className="muted small">{t('specialty.versionLabel', { version: specialty.version })}</span>
      </h3>
      {specialty.template === 'dentistry.visit' && <DentalLists data={data as DentistryData} />}
      {specialty.template === 'physiotherapy.assessment' && (
        <dl className="record-sections">
          {text(t('specialty.physio.limitations'), data.limitations)}
          {(data.goals as { id: string; text: string }[]).length > 0 && (
            <div>
              <dt>{t('specialty.physio.goals')}</dt>
              <dd>
                <ul className="plain-list">
                  {(data.goals as { id: string; text: string }[]).map((g) => (
                    <li key={g.id} className="record-text">
                      {g.text}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
          {data.plannedSessions != null && (
            <div>
              <dt>{t('specialty.physio.plannedSessions')}</dt>
              <dd>{String(data.plannedSessions)}</dd>
            </div>
          )}
          {text(t('specialty.physio.frequency'), data.frequency)}
          {text(t('specialty.physio.courseNotes'), data.courseNotes)}
        </dl>
      )}
      {(specialty.template === 'physiotherapy.session' || specialty.template === 'physiotherapy.discharge') && (
        <dl className="record-sections">
          {text(t('specialty.physio.performed'), data.performed)}
          {text(t('specialty.physio.progress'), data.progress)}
          {text(t('specialty.physio.summary'), data.summary)}
          {(data.goalNotes as { goalId: string; note: string }[]).map((n) => text(t('specialty.physio.goalNote'), n.note))}
        </dl>
      )}
      {specialty.template === 'ent.visit' && (
        <dl className="record-sections">
          {ENT_HISTORY.map((k) => text(t(`specialty.ent.history.${k}`), (data as EntData).history[k]))}
          {ENT_EXAMINATION.map((k) => text(t(`specialty.ent.examination.${k}`), (data as EntData).examination[k]))}
          {text(t('specialty.ent.followUp'), data.followUp)}
        </dl>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Patient page and home cards

export function DentalChartCard({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const chart = useDentalChart(patientId);
  const [tooth, setTooth] = useState<string | null>(null);
  if (!chart.isSuccess || chart.data.records.length === 0) return null;
  const marked = new Set(chart.data.teeth.map((x) => x.tooth));
  const entries = chart.data.teeth.find((x) => x.tooth === tooth)?.entries ?? [];
  return (
    <section className="card" aria-labelledby="dental-chart-title" data-testid="dental-chart">
      <h2 id="dental-chart-title">{t('specialty.dental.chartTitle')}</h2>
      <p className="muted small">{t('specialty.dental.chartHint')}</p>
      <ToothGrid selected={tooth} onSelect={setTooth} marked={marked} primary={false} />
      {tooth && (
        <div data-testid="tooth-history">
          <h3>{t('specialty.dental.history', { n: tooth })}</h3>
          {entries.length === 0 ? (
            <EmptyState icon="tooth">{t('specialty.dental.noHistory')}</EmptyState>
          ) : (
            <ul className="plain-list">
              {entries.map((h, i) => (
                <li key={i} className="small">
                  <DateText value={h.date} /> · {t(`specialty.dental.kind.${h.kind}`)}
                  {h.surfaces.length > 0 && <> ({h.surfaces.join(', ')})</>}: <span className="record-text">{h.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <h3>{t('specialty.dental.planTitle')}</h3>
      {chart.data.planItems.length === 0 ? (
        <EmptyState icon="layers">{t('specialty.dental.noPlan')}</EmptyState>
      ) : (
        <ul className="data-list" data-testid="dental-plan">
          {chart.data.planItems.map((item) => (
            <li key={`${item.sourceEncounterId}-${item.id}`} className="data-row">
              <div className="data-main">
                <span className="record-text">
                  {item.tooth ? `${t('specialty.dental.tooth', { n: item.tooth })} — ` : ''}
                  {item.description}
                </span>
              </div>
              <div className="data-meta">
                <span className={`badge badge--plan-${item.status}`}>{t(`specialty.dental.status.${item.status}`)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PhysioCoursesCard({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const fmt = useFormatters();
  const courses = usePhysioCourses(patientId);
  if (!courses.isSuccess || courses.data.courses.length === 0) return null;
  return (
    <section className="card" aria-labelledby="physio-courses-title" data-testid="physio-courses">
      <h2 id="physio-courses-title">{t('specialty.physio.coursesTitle')}</h2>
      <ul className="data-list">
        {courses.data.courses.map((c) => (
          <li key={c.assessmentId} className="data-row" data-testid="physio-course">
            <div className="data-main">
              <Link to={`/app/${orgId}/records/${c.assessmentId}`}>{t('specialty.physio.courseFrom', { date: fmt.date(c.startedAt) })}</Link>
              <span className="muted small">
                {t('specialty.physio.sessionsDone', { done: fmt.number(c.completedSessions), planned: c.plannedSessions ? fmt.number(c.plannedSessions) : '—' })}
                {c.upcomingAppointments !== null && <> · {t('specialty.physio.upcoming', { n: fmt.number(c.upcomingAppointments) })}</>}
                {!c.own && <> · {c.practitioner}</>}
              </span>
            </div>
            <div className="data-meta">
              <span className={`badge ${c.discharge ? 'badge--record-finalized' : 'badge--record-draft'}`}>
                {c.discharge ? t('specialty.physio.discharged') : t('specialty.physio.active')}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Documentation counts for the last 30 days — never clinical content. */
export function SpecialtySummaryCard() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const summary = useSpecialtySummary();
  if (summary.isPending) return <Loading />;
  if (!summary.isSuccess) return null;
  const rows = summary.data.byTemplate.filter((r) => r.finalized + r.draft > 0);
  return (
    <section className="card" aria-labelledby="specialty-summary-title" data-testid="specialty-summary">
      <h2 id="specialty-summary-title">{t(summary.data.scope === 'own' ? 'specialty.summary.ownTitle' : 'specialty.summary.orgTitle')}</h2>
      <p className="muted small">{t('specialty.summary.hint')}</p>
      {rows.length === 0 ? (
        <EmptyState icon="chart">{t('specialty.summary.empty')}</EmptyState>
      ) : (
        <dl className="details">
          {rows.map((r) => (
            <div key={r.template ?? 'general'}>
              <dt>{r.template ? t(`specialty.templates.${r.template}`) : t('specialty.templates.general')}</dt>
              <dd>{t('specialty.summary.counts', { finalized: fmt.number(r.finalized), draft: fmt.number(r.draft) })}</dd>
            </div>
          ))}
        </dl>
      )}
      {summary.data.own && (
        <p className="small">
          {t('specialty.summary.own', { plan: fmt.number(summary.data.own.openPlanItems), courses: fmt.number(summary.data.own.activeCourses) })}
        </p>
      )}
    </section>
  );
}
