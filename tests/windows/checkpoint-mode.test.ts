// A checkpoint must keep a file's recorded exec bit. On Windows stat never reports one, so the
// snapshot reads the mode from HEAD instead; on macOS/Linux the stat-based path is unchanged.
import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { commitSnapshot } from "../../LifeOS/install/hooks/CheckpointPerISC.hook";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });

test("an executable file stays 100755 across a checkpoint", () => {
  const repo = mkdtempSync(join(tmpdir(), "lifeos-ckpt-"));
  try {
    git(repo, "init", "-q");
    writeFileSync(join(repo, "run.sh"), "#!/bin/sh\necho 1\n");
    chmodSync(join(repo, "run.sh"), 0o755);
    git(repo, "add", "run.sh");
    git(repo, "update-index", "--chmod=+x", "run.sh");
    git(repo, "commit", "-q", "-m", "init");
    writeFileSync(join(repo, "run.sh"), "#!/bin/sh\necho 2\n");
    const commit = commitSnapshot(repo, "checkpoint", ["run.sh"]);
    expect(commit).not.toBeNull();
    expect(git(repo, "ls-tree", commit!, "run.sh").split(" ")[0]).toBe("100755");
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
