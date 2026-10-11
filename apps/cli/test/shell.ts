import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const provisionScript = resolve(import.meta.dirname, "../src/provision.sh");

export type ShellSandbox = { root: string; home: string; bin: string };

export const createShellSandbox = (): ShellSandbox => {
  const root = mkdtempSync(join(tmpdir(), "provision-test-"));
  const home = join(root, "home");
  const bin = join(root, "bin");
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  return { root, home, bin };
};

export const disposeShellSandbox = (sandbox: ShellSandbox) => rmSync(sandbox.root, { recursive: true, force: true });

export const addFakeCommand = (sandbox: ShellSandbox, name: string, body: string) => {
  const path = join(sandbox.bin, name);
  writeFileSync(path, `#!/bin/bash\n${body}\n`);
  chmodSync(path, 0o755);
};

export const runWithProvision = (sandbox: ShellSandbox, snippet: string, input?: string) =>
  spawnSync("/bin/bash", ["-c", `set -euo pipefail; source "${provisionScript}"; ${snippet}`], {
    encoding: "utf8",
    input,
    env: { PATH: `${sandbox.bin}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: sandbox.home, USER: "rack" },
  });
