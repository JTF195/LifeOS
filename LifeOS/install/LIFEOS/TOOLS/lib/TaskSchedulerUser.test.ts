import { describe, expect, test } from "bun:test";
import type { UnitSpec } from "./ServiceSpec";
import { renderTask, runnerArgs, taskName, winQuote, WATCH_FALLBACK_MINUTES } from "./TaskSchedulerUser";
import { jobEnvironment, parseRunnerArgs } from "./WinServiceRunner";
import { backend } from "./ServiceHost";

const ctx = {
  bun: "C:\\Users\\me\\.bun\\bin\\bun.exe",
  runner: "C:\\Users\\me\\.claude\\LIFEOS\\TOOLS\\lib\\WinServiceRunner.ts",
  userId: "ALPHA\\me",
  conhost: "C:\\Windows\\System32\\conhost.exe",
};
const base = (schedule: UnitSpec["schedule"]): UnitSpec => ({
  label: "com.lifeos.test",
  description: "Test & check",
  exec: ["C:\\Users\\me\\.bun\\bin\\bun.exe", "C:\\Users\\me\\.claude\\LIFEOS\\TOOLS\\Job.ts", "--flag"],
  logPath: "C:\\Users\\me\\.claude\\LIFEOS\\MEMORY\\OBSERVABILITY\\test.log",
  workingDirectory: "C:\\Users\\me\\.claude\\LIFEOS\\TOOLS",
  schedule,
});

describe("renderTask", () => {
  test("interval -> repeating trigger rounded up to minutes, plus logon", () => {
    const x = renderTask(base({ kind: "interval", seconds: 120 }), ctx);
    expect(x).toContain("<Interval>PT2M</Interval>");
    expect(x).toContain("<LogonTrigger>");
    expect(x).toContain("<ExecutionTimeLimit>PT1H</ExecutionTimeLimit>");
    expect(renderTask(base({ kind: "interval", seconds: 30 }), ctx)).toContain("<Interval>PT1M</Interval>");
  });
  test("calendar -> daily at hh:mm, no logon trigger", () => {
    const x = renderTask(base({ kind: "calendar", hour: 5, minute: 10 }), ctx);
    expect(x).toContain("T05:10:00");
    expect(x).toContain("<DaysInterval>1</DaysInterval>");
    expect(x).not.toContain("<LogonTrigger>");
  });
  test("daemon -> logon only, keepalive in runner args, no time limit", () => {
    const x = renderTask(base({ kind: "daemon", restartSec: 30 }), ctx);
    expect(x).toContain("<LogonTrigger>");
    expect(x).not.toContain("<TimeTrigger>");
    expect(x).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
    expect(x).toContain("--keepalive 30");
  });
  test("watch -> periodic fallback plus logon", () => {
    const x = renderTask(base({ kind: "watch", paths: ["C:\\x"] }), ctx);
    expect(x).toContain(`<Interval>PT${WATCH_FALLBACK_MINUTES}M</Interval>`);
    expect(x).toContain("<LogonTrigger>");
  });
  test("headless conhost, unelevated interactive principal, escaped XML", () => {
    const x = renderTask(base({ kind: "interval", seconds: 60 }), ctx);
    expect(x).toContain("<Command>C:\\Windows\\System32\\conhost.exe</Command>");
    expect(x).toContain("<Arguments>--headless C:\\Users\\me\\.bun\\bin\\bun.exe ");
    expect(x).toContain("<LogonType>InteractiveToken</LogonType>");
    expect(x).toContain("<RunLevel>LeastPrivilege</RunLevel>");
    expect(x).toContain("Test &amp; check");
    expect(x).not.toMatch(/S4U/);
  });
  test("refuses control characters and bad labels", () => {
    expect(() => renderTask({ ...base({ kind: "interval", seconds: 60 }), description: "a\nb" }, ctx)).toThrow();
    expect(() => taskName("../evil")).toThrow();
    expect(taskName("com.lifeos.pulse")).toBe("\\LifeOS\\com.lifeos.pulse");
  });
});

describe("winQuote", () => {
  test("leaves plain args, quotes spaces, escapes quotes and trailing backslashes", () => {
    expect(winQuote("C:\\plain\\path")).toBe("C:\\plain\\path");
    expect(winQuote("C:\\Program Files\\x")).toBe('"C:\\Program Files\\x"');
    expect(winQuote('say "hi"')).toBe('"say \\"hi\\""');
    expect(winQuote("C:\\dir with space\\")).toBe('"C:\\dir with space\\\\"');
  });
});

describe("runner round trip", () => {
  test("runnerArgs parses back into the spec", () => {
    const spec = { ...base({ kind: "daemon", restartSec: 30 }), environment: { FOO: "a=b" } };
    const a = parseRunnerArgs(runnerArgs(spec, ctx).slice(1));
    expect(a.log).toBe(spec.logPath);
    expect(a.cwd).toBe(spec.workingDirectory);
    expect(a.keepaliveSec).toBe(30);
    expect(a.env).toEqual({ FOO: "a=b" });
    expect(a.argv).toEqual(spec.exec);
  });
  test("job PATH puts bun's folder and ~/.local/bin first, sets HOME and USER", () => {
    const env = jobEnvironment({ USERNAME: "me", PATH: "C:\\Windows" }, {}, "C:\\Users\\me\\.bun\\bin\\bun.exe", "C:\\Users\\me");
    expect(env.PATH?.split(";").slice(0, 3)).toEqual(["C:\\Users\\me\\.bun\\bin", "C:\\Users\\me\\.local\\bin", "C:\\Windows"]);
    expect(env.HOME).toBe("C:\\Users\\me");
    expect(env.USER).toBe("me");
  });
});

describe("ServiceHost", () => {
  test("picks systemd on linux, task scheduler on win32, nothing on macOS", () => {
    expect(backend("linux")?.name).toBe("systemd");
    expect(backend("win32")?.name).toBe("taskscheduler");
    expect(backend("darwin")).toBeNull();
  });
});
