/**
 * ServiceHost.ts — picks the service back end for this OS.
 *
 * macOS keeps its existing launchd code paths in each installer (plists are richer than a
 * UnitSpec); Linux and Windows share one UnitSpec-driven path:
 *   linux -> lib/SystemdUser.ts (systemd --user)
 *   win32 -> lib/TaskSchedulerUser.ts (per-user scheduled tasks)
 * An installer that already has `if (systemd.isLinux()) return linuxMain(arg)` switches to
 * `if (ServiceHost.backend()) return unitMain(arg)` and calls backend().install/uninstall/status.
 */
import type { UnitSpec } from "./ServiceSpec";
import * as systemd from "./SystemdUser";
import * as tasks from "./TaskSchedulerUser";

export interface ServiceBackend {
  name: "systemd" | "taskscheduler";
  install(spec: UnitSpec, log: (m: string) => void): Promise<boolean>;
  uninstall(spec: UnitSpec, log: (m: string) => void): Promise<boolean>;
  status(spec: UnitSpec, log: (m: string) => void): Promise<boolean>;
}

/** The UnitSpec back end for this OS, or null on macOS (launchd stays with each installer). */
export function backend(platform: NodeJS.Platform = process.platform): ServiceBackend | null {
  if (platform === "linux") return { name: "systemd", install: systemd.install, uninstall: systemd.uninstall, status: systemd.status };
  if (platform === "win32") return { name: "taskscheduler", install: (s, l) => tasks.install(s, l), uninstall: tasks.uninstall, status: tasks.status };
  return null;
}
