import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLIST, SCRIPT } from "../../src/slim/catalog/keep-terminal";
import { sh } from "../../src/core/shell";

const dir = mkdtempSync(join(tmpdir(), "macslim-"));

test("agent script is valid sh", async () => {
  const path = join(dir, "keep-terminal.sh");
  writeFileSync(path, SCRIPT);
  const r = await sh(["/bin/sh", "-n", path]);
  expect(r.stderr).toBe("");
  expect(r.code).toBe(0);
});

test("agent plist is a valid property list", async () => {
  const path = join(dir, "agent.plist");
  writeFileSync(path, PLIST);
  expect((await sh(["plutil", "-lint", path])).code).toBe(0);
});

test("window check runs and yields a count", async () => {
  // The loop body minus the action: must parse ps output without errors.
  const body = SCRIPT.split("\n").filter((l) => /^\s+(term|windows)=/.test(l)).join("\n");
  const r = await sh(["/bin/sh", "-c", `${body}\necho "$windows"`]);
  expect(r.code).toBe(0);
  expect(r.stdout.trim()).toMatch(/^\d+$/);
});
