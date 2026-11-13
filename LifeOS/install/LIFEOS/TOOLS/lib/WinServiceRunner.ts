#!/usr/bin/env bun
/**
 * WinServiceRunner.ts — the process every LifeOS Windows scheduled task starts.
 *
 * Task Scheduler actions carry no environment, working directory semantics differ from launchd,
 * and there is no StandardOutPath. This runner supplies what the UnitSpec asks for:
 *   - HOME and USER (Windows sets USERPROFILE and USERNAME; LifeOS code reads HOME and USER),
 *   - PATH with bun's own folder and ~/.local/bin (claude) first, because jobs spawn plain `bun`
 *     and `claude` as children and a task's PATH is minimal,
 *   - the spec's extra environment and working directory,
 *   - stdout/stderr appended to the spec's log paths,
 *   - KeepAlive for daemon specs: restart `restartSec` after exit, giving up after 10 restarts in
 *     10 minutes so a crash loop can't spin forever (the logon trigger starts it again next logon).
 *
 * Usage (written by TaskSchedulerUser.renderTask, not by hand):
 *   bun WinServiceRunner.ts --log <file> [--err-log <file>] [--cwd <dir>] [--keepalive <sec>]
 *                           [--env KEY=VALUE ...] -- <argv...>
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface RunnerArgs {
  log: string;
  errLog?: string;
  cwd?: string;
  keepaliveSec?: number;
  env: Record<string, string>;
  argv: string[];
}

/** Parse the runner's own command line. Pure, for tests. */
export function parseRunnerArgs(args: string[]): RunnerArgs {
  const sepAt = args.indexOf("--");
  if (sepAt < 0 || sepAt === args.length - 1) throw new Error("WinServiceRunner: missing `-- <argv...>`");
  const opts = args.slice(0, sepAt);
  const out: RunnerArgs = { log: "", env: {}, argv: args.slice(sepAt + 1) };
  for (let i = 0; i < opts.length; i++) {
    const k = opts[i], v = opts[i + 1];
    if (k === "--log") { out.log = v; i++; }
    else if (k === "--err-log") { out.errLog = v; i++; }
    else if (k === "--cwd") { out.cwd = v; i++; }
    else if (k === "--keepalive") { out.keepaliveSec = Number(v); i++; }
    else if (k === "--env") {
      const eq = v?.indexOf("=") ?? -1;
      if (eq <= 0) throw new Error(`WinServiceRunner: bad --env ${v}`);
      out.env[v.slice(0, eq)] = v.slice(eq + 1);
      i++;
    } else throw new Error(`WinServiceRunner: unknown option ${k}`);
  }
  if (!out.log) throw new Error("WinServiceRunner: --log is required");
  return out;
}

/** The environment a job runs with. Pure, for tests. */
export function jobEnvironment(base: Record<string, string | undefined>, extra: Record<string, string>, bunPath: string, home: string): Record<string, string | undefined> {
  const pathSep = ";";
  return {
    ...base,
    HOME: base.HOME ?? home,
    USER: base.USER ?? base.USERNAME,
    ...extra,
    PATH: [dirname(bunPath), join(home, ".local", "bin"), extra.PATH ?? base.PATH ?? base.Path ?? ""].filter(Boolean).join(pathSep),
  };
}

async function runOnce(a: RunnerArgs, env: Record<string, string | undefined>): Promise<number> {
  const note = (m: string) => appendFileSync(a.log, `[${new Date().toISOString()}] [WinServiceRunner] ${m}\n`);
  note(`start: ${a.argv.join(" ")}${a.cwd ? ` (cwd ${a.cwd})` : ""}`);
  const proc = Bun.spawn(a.argv, { cwd: a.cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const pump = async (s: ReadableStream<Uint8Array>, file: string) => {
    const dec = new TextDecoder();
    for await (const chunk of s) appendFileSync(file, dec.decode(chunk, { stream: true }));
  };
  await Promise.all([pump(proc.stdout, a.log), pump(proc.stderr, a.errLog ?? a.log), proc.exited]);
  note(`exit ${proc.exitCode}`);
  return proc.exitCode ?? 1;
}

if (import.meta.main) {
  const a = parseRunnerArgs(process.argv.slice(2));
  for (const f of [a.log, a.errLog].filter(Boolean) as string[]) mkdirSync(dirname(f), { recursive: true });
  const env = jobEnvironment(process.env, a.env, process.execPath, homedir());
  if (a.keepaliveSec === undefined) process.exit(await runOnce(a, env));
  const recent: number[] = [];
  for (;;) {
    await runOnce(a, env);
    const now = Date.now();
    recent.push(now);
    while (recent.length && now - recent[0] > 10 * 60_000) recent.shift();
    if (recent.length > 10) {
      appendFileSync(a.log, `[${new Date().toISOString()}] [WinServiceRunner] 10 restarts in 10 minutes; giving up until next logon\n`);
      process.exit(1);
    }
    await Bun.sleep(Math.max(1, a.keepaliveSec) * 1000);
  }
}
