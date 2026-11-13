// Paths from path.join/resolve/relative and from Claude Code tool input use "\" on Windows.
// Code that splits them by "/" must still find the last segment. The backslash cases run on
// every platform; the native-path cases exercise the host's own separator.
import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { slugFromPath } from "../../LifeOS/install/LIFEOS/TOOLS/KnowledgeSchema";
import { builtinPermissionCheck, ruleCoversBelow } from "../../LifeOS/install/LIFEOS/CODEX/Bridge";

test("slugFromPath takes the file name from a backslash path", () => {
  expect(slugFromPath("C:\\Users\\me\\.claude\\LIFEOS\\MEMORY\\KNOWLEDGE\\People\\jane-doe.md")).toBe("jane-doe");
  expect(slugFromPath("/Users/me/.claude/LIFEOS/MEMORY/KNOWLEDGE/People/jane-doe.md")).toBe("jane-doe");
});

test("a ~/.ssh deny rule covers the native path of a key", () => {
  const hit = builtinPermissionCheck(
    { tool_name: "Read", tool_input: { file_path: join(homedir(), ".ssh", "id_ed25519") } } as never,
    { deny: ["Read(~/.ssh/**)"], ask: [] },
  );
  expect(hit?.effect).toBe("deny");
});

test("ruleCoversBelow sees a native directory under the rule", () => {
  expect(ruleCoversBelow("~/.ssh/id_*", join(homedir(), ".ssh"))).toBe(true);
});
