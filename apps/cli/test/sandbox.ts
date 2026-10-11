import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { systemPaths, type Machine } from "../src/core/shell";
import type { Setup } from "../src/setup/context";
import { emptyOptions, parseArguments } from "../src/setup/options";

export type Sandbox = { root: string; home: string; bin: string; machine: Machine; printed: string[] };

export const createSandbox = (): Sandbox => {
  const root = mkdtempSync(join(tmpdir(), "provision-test-"));
  const home = join(root, "home");
  const bin = join(root, "bin");
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const printed: string[] = [];
  const machine: Machine = {
    home,
    user: "rack",
    environment: { PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: home, USER: "rack" },
    paths: { ...systemPaths, homebrewTailscale: join(bin, "absent-tailscale"), appTailscale: join(bin, "absent-app"), commandLink: join(root, "provision-link") },
    print: (text) => printed.push(text),
  };
  return { root, home, bin, machine, printed };
};

export const disposeSandbox = (sandbox: Sandbox) => rmSync(sandbox.root, { recursive: true, force: true });

export const addFakeCommand = (sandbox: Sandbox, name: string, body: string) => {
  const path = join(sandbox.bin, name);
  writeFileSync(path, `#!/bin/bash\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
};

export const addFakeSudo = (sandbox: Sandbox) =>
  addFakeCommand(sandbox, "sudo", 'printf "%s\\n" "$*" >> "$HOME/sudo.log"; [ "$1" = -n ] && shift; [ "$1" = -u ] && shift 2; exec "$@"');

export const setupOf = (sandbox: Sandbox, argumentList: string[] = []): Setup => ({ machine: sandbox.machine, options: parseArguments(argumentList, emptyOptions()) });

export const printedText = (sandbox: Sandbox) => sandbox.printed.join("\n");

export const publishFakeBinary = (sandbox: Sandbox, script: string, checksum?: string) => {
  const release = join(sandbox.root, "release");
  mkdirSync(release, { recursive: true });
  const binary = join(release, "provision-darwin-arm64");
  writeFileSync(binary, `#!/bin/bash\n${script}`);
  const digest = spawnSync("shasum", ["-a", "256", binary], { encoding: "utf8" }).stdout.split(" ")[0];
  writeFileSync(`${binary}.sha256`, `${checksum ?? digest}  provision-darwin-arm64\n`);
  return `file://${binary}`;
};
