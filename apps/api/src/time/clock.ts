/**
 * The server's notion of "now" for scheduling rules (today's date, past/future checks).
 * Production code reads it everywhere such a decision is made; tests pin it with
 * `vi.spyOn(clock, 'now')` so date-dependent behavior is deterministic.
 */
export const clock = {
  now: (): Date => new Date(),
};
