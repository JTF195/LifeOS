// Windows has no POSIX mode bits: stat reports 0o666 (or 0o444) for every file and folder, whatever
// the ACL. Owner-only checks that assert 0o600/0o700 must not throw there. On macOS/Linux these
// tests exercise the unchanged POSIX path (the assertions still hold).
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendPrivateRecord } from "../../LifeOS/install/hooks/lib/event-capture";
import { writePrivateTemp } from "../../LifeOS/install/LIFEOS/TOOLS/LifelogIdeaSweep";
import { ensureContextDir } from "../../LifeOS/install/LIFEOS/RELAY/context/Fold";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "lifeos-modebits-"));
}

describe("owner-only checks survive a filesystem without mode bits", () => {
  test("appendPrivateRecord writes a record", () => {
    const dir = scratch();
    try {
      const file = join(dir, "events", "x.jsonl");
      appendPrivateRecord(file, { ok: true });
      expect(readFileSync(file, "utf8")).toContain('"ok":true');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("writePrivateTemp writes the page", () => {
    const dir = scratch();
    try {
      const { file } = writePrivateTemp("2026-11-12", "<p>x</p>", dir);
      expect(readFileSync(file, "utf8")).toBe("<p>x</p>");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("ensureContextDir creates the context dir", () => {
    const dir = scratch();
    try {
      ensureContextDir(join(dir, "ctx"));
      expect(readFileSync(join(dir, "ctx", ".gitignore"), "utf8")).toBe("*\n");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
