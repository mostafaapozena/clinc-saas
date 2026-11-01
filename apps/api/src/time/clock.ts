/**
 * The server's notion of "now" for scheduling rules (today's date, past/future checks).
 * Production code reads it everywhere such a decision is made; tests pin it with
 * `vi.spyOn(clock, 'now')` so date-dependent behavior is deterministic.
 *
 * Browser test runs shift it by a fixed offset (`CLOCK_OFFSET_MS`, refused outside NODE_ENV=test in
 * config/env.ts) so that a run always happens at the same local time of day and seeded "today"
 * data never crosses a local midnight during the run. The offset is zero everywhere else.
 */
let offsetMs = 0;

export const clock = {
  now: (): Date => new Date(Date.now() + offsetMs),
};

export function setClockOffset(ms: number) {
  offsetMs = ms;
}
