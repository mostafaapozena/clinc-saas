import { Types, type ClientSession } from 'mongoose';
import { recordAccess, type ClinicalActor } from './clinical-access.js';
import { EncounterModel, type Encounter } from './clinical.model.js';

// References from one record to earlier ones (docs/architecture/SPECIALTY_WORKSPACES.md):
// - a dental visit may change the status of plan items recorded at earlier, finalized dental visits;
// - physiotherapy sessions and the discharge summary belong to a finalized initial assessment.
// The referenced record must be of the same patient, finalized, of the right template, and
// readable by the author (own or covered). Problems come back as field codes only.

type EncounterLean = Encounter & { _id: Types.ObjectId };
type Problems = Record<string, string>;

async function readableFinalized(
  actor: ClinicalActor,
  current: EncounterLean,
  id: string,
  template: string,
  session: ClientSession | undefined,
): Promise<EncounterLean | null> {
  if (!Types.ObjectId.isValid(id) || current._id.equals(id)) return null;
  const target = await EncounterModel.findOne({
    organizationId: actor.organizationId,
    _id: new Types.ObjectId(id),
    patientId: current.patientId,
  })
    .session(session ?? null)
    .lean<EncounterLean>();
  if (!target || target.status !== 'finalized' || target.specialty?.template !== template) return null;
  return (await recordAccess(actor, target, { session })) ? target : null;
}

export async function referenceProblems(
  actor: ClinicalActor,
  current: EncounterLean,
  templateId: string,
  data: Record<string, unknown>,
  session?: ClientSession,
): Promise<Problems> {
  const problems: Problems = {};
  if (templateId === 'dentistry.visit') {
    const updates = (data.planUpdates ?? []) as { itemId: string; sourceEncounterId: string }[];
    for (const [i, u] of updates.entries()) {
      const source = await readableFinalized(actor, current, u.sourceEncounterId, 'dentistry.visit', session);
      const items = (source?.specialty?.data.planItems ?? []) as { id: string }[];
      if (!source || !items.some((item) => item.id === u.itemId)) problems[`specialty.planUpdates.${i}.itemId`] = 'invalid_reference';
    }
  }
  if (templateId === 'physiotherapy.session' || templateId === 'physiotherapy.discharge') {
    const course = data.courseEncounterId;
    if (typeof course === 'string') {
      const assessment = await readableFinalized(actor, current, course, 'physiotherapy.assessment', session);
      if (!assessment) problems['specialty.courseEncounterId'] = 'invalid_reference';
      else {
        // Goal notes must refer to the course's own goals.
        const goals = new Set(((assessment.specialty?.data.goals ?? []) as { id: string }[]).map((g) => g.id));
        for (const [i, note] of ((data.goalNotes ?? []) as { goalId: string }[]).entries()) {
          if (!goals.has(note.goalId)) problems[`specialty.goalNotes.${i}.goalId`] = 'invalid_reference';
        }
      }
    }
  }
  return problems;
}
