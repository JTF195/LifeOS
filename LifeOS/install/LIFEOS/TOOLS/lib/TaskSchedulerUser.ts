/**
 * TaskSchedulerUser.ts — the Windows back end for LifeOS background services.
 *
 * Same interface as lib/SystemdUser.ts (install / uninstall / status over one UnitSpec), so an
 * installer picks a back end through lib/ServiceHost.ts and builds its spec once. Each service is a
 * per-user scheduled task in the `\LifeOS\` folder:
 *   - unelevated, Interactive logon (an S4U task needs elevation to register);
 *   - action = conhost.exe --headless <bun> WinServiceRunner.ts ..., so no console window appears
 *     and the runner supplies HOME, USER, PATH, the working directory and the log files;
 *   - schedules map from launchd shapes:
 *       interval  -> repeating time trigger every N (rounded up to whole minutes, min 1) + at logon
 *       calendar  -> daily at hh:mm
 *       daemon    -> at logon; the runner restarts it restartSec after exit; no time limit
 *       watch     -> Task Scheduler has no file-change trigger: every 15 minutes + at logon. The
 *                    watch jobs (DerivedSync) diff their own state, so a periodic run is safe.
 * Registration goes through `schtasks /Create /XML` with a UTF-16 task definition rendered by
 * renderTask(), which is pure and unit-tested.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UnitSpec } from "./ServiceSpec";

export const TASK_FOLDER = "\\LifeOS\\";
const LABEL_RE = /^[A-Za-z0-9._-]+$/;
/** Fallback period for `watch` specs, which Task Scheduler can't trigger on file changes. */
export const WATCH_FALLBACK_MINUTES = 15;

export function isWindows(): boolean {
  return process.platform === "win32";
}

export function taskName(label: string): string {
  if (!LABEL_RE.test(label)) throw new Error(`TaskSchedulerUser: invalid label ${JSON.stringify(label)}`);
  return `${TASK_FOLDER}${label}`;
}

function xml(s: string): string {
  // Same rule as SystemdUser.esc(): no legitimate task field contains a C0 control or DEL.
  if (/[\x00-\x1f\x7f]/.test(s)) throw new Error("TaskSchedulerUser: control character in task field");
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Quote one argument for a Windows command line (CommandLineToArgvW rules). */
export function winQuote(a: string): string {
  if (a !== "" && !/[\s"]/.test(a)) return a;
  return '"' + a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1") + '"';
}

export interface RenderContext {
  /** Absolute path to bun.exe. */
  bun: string;
  /** Absolute path to WinServiceRunner.ts. */
  runner: string;
  /** DOMAIN\user the task runs as. */
  userId: string;
  /** conhost.exe path (default %SystemRoot%\System32\conhost.exe). */
  conhost?: string;
}

/** The runner's command line for one spec. Pure, for tests. */
export function runnerArgs(spec: UnitSpec, ctx: RenderContext): string[] {
  const args = [ctx.runner, "--log", spec.logPath];
  if (spec.errLogPath && spec.errLogPath !== spec.logPath) args.push("--err-log", spec.errLogPath);
  if (spec.workingDirectory) args.push("--cwd", spec.workingDirectory);
  if (spec.schedule.kind === "daemon") args.push("--keepalive", String(spec.schedule.restartSec));
  for (const [k, v] of Object.entries(spec.environment ?? {})) args.push("--env", `${k}=${v}`);
  args.push("--", ...spec.exec);
  return args;
}

function minutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}

function triggers(spec: UnitSpec, userId: string): string {
  const logon = `    <LogonTrigger><Enabled>true</Enabled><UserId>${xml(userId)}</UserId></LogonTrigger>`;
  const repeat = (m: number) =>
    `    <TimeTrigger><StartBoundary>2026-01-01T00:00:00</StartBoundary><Enabled>true</Enabled>` +
    `<Repetition><Interval>PT${m}M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition></TimeTrigger>`;
  const s = spec.schedule;
  switch (s.kind) {
    case "interval": return [repeat(minutes(s.seconds)), logon].join("\n");
    case "watch": return [repeat(WATCH_FALLBACK_MINUTES), logon].join("\n");
    case "daemon": return logon;
    case "calendar": {
      const hh = String(s.hour).padStart(2, "0"), mm = String(s.minute).padStart(2, "0");
      return `    <CalendarTrigger><StartBoundary>2026-01-01T${hh}:${mm}:00</StartBoundary><Enabled>true</Enabled>` +
        `<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>`;
    }
  }
}

/** The Task Scheduler XML for one spec. Pure, for tests. */
export function renderTask(spec: UnitSpec, ctx: RenderContext): string {
  taskName(spec.label);
  const conhost = ctx.conhost ?? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "conhost.exe");
  const args = ["--headless", ctx.bun, ...runnerArgs(spec, ctx)].map(winQuote).join(" ");
  const daemon = spec.schedule.kind === "daemon";
  return [
    `<?xml version="1.0" encoding="UTF-16"?>`,
    `<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">`,
    `  <RegistrationInfo><Description>${xml(spec.description)} (LifeOS ${xml(spec.label)})</Description></RegistrationInfo>`,
    `  <Triggers>`,
    triggers(spec, ctx.userId),
    `  </Triggers>`,
    `  <Principals><Principal id="Author"><UserId>${xml(ctx.userId)}</UserId>` +
      `<LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>`,
    `  <Settings>`,
    `    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>`,
    `    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>`,
    `    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>`,
    `    <StartWhenAvailable>true</StartWhenAvailable>`,
    `    <ExecutionTimeLimit>${daemon ? "PT0S" : "PT1H"}</ExecutionTimeLimit>`,
    daemon ? `    <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>` : "",
    `    <Enabled>true</Enabled>`,
    `  </Settings>`,
    `  <Actions Context="Author"><Exec><Command>${xml(conhost)}</Command><Arguments>${xml(args)}</Arguments>` +
      (spec.workingDirectory ? `<WorkingDirectory>${xml(spec.workingDirectory)}</WorkingDirectory>` : "") +
      `</Exec></Actions>`,
    `</Task>`,
  ].filter((l) => l !== "").join("\r\n") + "\r\n";
}

function defaultContext(): RenderContext {
  const user = process.env.USERNAME ?? "";
  const domain = process.env.USERDOMAIN ?? process.env.COMPUTERNAME ?? "";
  return {
    bun: process.execPath,
    runner: join(import.meta.dir, "WinServiceRunner.ts"),
    userId: domain ? `${domain}\\${user}` : user,
  };
}

async function schtasks(args: string[]): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(["schtasks.exe", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out: (out + err).trim() };
}

export async function install(spec: UnitSpec, log: (m: string) => void, ctx: RenderContext = defaultContext()): Promise<boolean> {
  const dir = mkdtempSync(join(tmpdir(), "lifeos-task-"));
  try {
    const file = join(dir, `${spec.label}.xml`);
    // schtasks /XML requires UTF-16; write little-endian with a BOM.
    writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(renderTask(spec, ctx), "utf16le")]));
    const r = await schtasks(["/Create", "/TN", taskName(spec.label), "/XML", file, "/F"]);
    log(r.code === 0 ? `registered ${taskName(spec.label)}` : `schtasks /Create failed (${r.code}): ${r.out}`);
    return r.code === 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function uninstall(spec: UnitSpec, log: (m: string) => void): Promise<boolean> {
  await schtasks(["/End", "/TN", taskName(spec.label)]);
  const r = await schtasks(["/Delete", "/TN", taskName(spec.label), "/F"]);
  log(r.code === 0 ? `removed ${taskName(spec.label)}` : `schtasks /Delete: ${r.out}`);
  return r.code === 0;
}

export async function status(spec: UnitSpec, log: (m: string) => void): Promise<boolean> {
  const r = await schtasks(["/Query", "/TN", taskName(spec.label), "/FO", "LIST", "/V"]);
  if (r.code !== 0) { log(`${taskName(spec.label)}: not registered`); return false; }
  const field = (k: string) => r.out.match(new RegExp(`^${k}:\\s*(.*)$`, "m"))?.[1]?.trim() ?? "?";
  log(`${taskName(spec.label)}: ${field("Status")}; last run ${field("Last Run Time")}, result ${field("Last Result")}; next ${field("Next Run Time")}`);
  return true;
}
