/**
 * ServiceSpec.ts — the platform-neutral description of one LifeOS background service.
 *
 * Owner of the shape every service back end consumes: launchd (macOS plists), systemd --user
 * (lib/SystemdUser.ts) and Windows Task Scheduler (lib/TaskSchedulerUser.ts). An installer builds
 * one UnitSpec and hands it to whichever back end runs on this OS (lib/ServiceHost.ts picks it).
 *
 * Moved here from SystemdUser.ts unchanged (2026-11-13) so the Windows back end shares it rather
 * than keeping a second copy. SystemdUser re-exports both types, so existing imports still work.
 */

/** One schedule, matching one launchd shape. */
export type Schedule =
  /** launchd StartInterval — every N seconds, plus a run shortly after boot. */
  | { kind: "interval"; seconds: number }
  /** launchd StartCalendarInterval — daily at a wall-clock time. */
  | { kind: "calendar"; hour: number; minute: number }
  /** launchd KeepAlive — a long-running process the service manager should keep alive. */
  | { kind: "daemon"; restartSec: number }
  /** launchd WatchPaths — re-run when any of these directories changes. */
  | { kind: "watch"; paths: string[] };

export interface UnitSpec {
  /** launchd Label, reused verbatim as the systemd unit basename and the Windows task name. */
  label: string;
  /** One-line unit Description. */
  description: string;
  /** argv. Must be absolute — service managers start jobs with a minimal PATH. */
  exec: string[];
  /** Absolute path for stdout, matching the plist's StandardOutPath. */
  logPath: string;
  /** Absolute path for stderr when the plist splits them (Conduit does).
   *  Defaults to logPath, matching the installers that point both keys at
   *  the same file. */
  errLogPath?: string;
  /** WorkingDirectory, when the job needs one. */
  workingDirectory?: string;
  /** Extra Environment= entries. */
  environment?: Record<string, string>;
  schedule: Schedule;
}
