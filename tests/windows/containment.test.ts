// Containment and suffix tests must hold for native paths. On Windows those use "\", so a test
// written as startsWith(root + "/") or includes("/MEMORY/WORK/") misses them. These cases build
// paths with path.join, so they exercise the host's own separator.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { classifyTarget } from "../../LifeOS/install/hooks/lib/system-file-guard-core";
import { isTaskIsa } from "../../LifeOS/install/LIFEOS/TOOLS/lib/IsaTemplate";
import { redactTarget } from "../../LifeOS/install/LIFEOS/TOOLS/lib/OutputLedger";

const root = mkdtempSync(join(tmpdir(), "lifeos-contain-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("the write guard sees a file under its root as a system file", () => {
  mkdirSync(join(root, "hooks"), { recursive: true });
  writeFileSync(join(root, "hooks", "a.ts"), "x");
  const r = classifyTarget(join(root, "hooks", "a.ts"), root);
  expect(r.classification).toBe("system");
  expect(r.relPath).toBe("hooks/a.ts");
});

test("the write guard sees the USER tree as a containment zone", () => {
  expect(classifyTarget(join(root, "LIFEOS", "USER", "notes.md"), root).classification).toBe("user");
});

test("a task ISA under MEMORY/WORK is recognised", () => {
  expect(isTaskIsa(join(root, "LIFEOS", "MEMORY", "WORK", "some-task", "ISA.md"))).toBe(true);
});

test("a Downloads path redacts to its folder class", () => {
  expect(redactTarget(join(homedir(), "Downloads", "x.pdf"))).toBe("path:downloads");
});
