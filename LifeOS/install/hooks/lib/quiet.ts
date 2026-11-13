/**
 * quiet.ts — LifeOS quiet mode, the one switch for installs where LifeOS is global but should not
 * steer every conversation.
 *
 * `LIFEOS_QUIET=1` in the settings `env` block turns off the hooks that tell the assistant how to
 * behave: the per-prompt FORMAT CONTRACT (DriftReminder), the Algorithm nudges (AlgorithmNudge, also
 * run from PostToolObserver), and Stop-gate blocking (StopGates: every gate becomes advisory, so its
 * finding is logged but the turn is never held). Memory, time context, capture, observability and
 * the statusline are untouched. Added 2026-11-13 for a Windows install where LifeOS runs in every
 * chat on the machine, most of which are unrelated work.
 */
export const QUIET = process.env.LIFEOS_QUIET === "1";
