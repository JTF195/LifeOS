import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const HOOKS = join(import.meta.dir, "..");

/** Run a snippet in a fresh bun so QUIET (read at import) sees the env we pass. */
function evalIn(code: string, quiet: boolean): string {
  const p = Bun.spawnSync([process.execPath, "-e", code], {
    cwd: HOOKS,
    env: { ...process.env, LIFEOS_QUIET: quiet ? "1" : "", NODE_ENV: "test" },
  });
  return p.stdout.toString().trim();
}

const blockingGate = `
  import { runGates } from "./StopGates.hook.ts";
  const r = await runGates({ session_id: "q", hook_event_name: "Stop" } as never,
    [["TestGate", async () => ({ decision: "block", reason: "would hold the turn" })]] as never);
  console.log(JSON.stringify(r));
`;

describe("LIFEOS_QUIET", () => {
  test("Stop gates block normally and turn advisory in quiet mode", () => {
    expect(evalIn(blockingGate, false)).toContain('"decision":"block"');
    expect(evalIn(blockingGate, true)).not.toContain('"decision":"block"');
  });
  test("AlgorithmNudge.run returns nothing in quiet mode", () => {
    const code = `import { run } from "./AlgorithmNudge.hook.ts"; console.log(String(run({ session_id: "q", hook_event_name: "UserPromptSubmit", prompt: "research the best options and red team this plan" } as never)));`;
    expect(evalIn(code, true)).toBe("null");
  });
  test("DriftReminder.run emits the format contract only when not quiet", () => {
    const code = `import { run } from "./DriftReminder.hook.ts"; console.log(String(run({ session_id: "q", prompt: "hi" })));`;
    expect(evalIn(code, false)).toContain("FORMAT CONTRACT");
    expect(evalIn(code, true)).toBe("null");
  });
});
