import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addFakeCommand, createShellSandbox, disposeShellSandbox, provisionScript, runWithProvision, type ShellSandbox } from "./shell.ts";

const lockLikeRoot = (sandbox: ShellSandbox) => {
  mkdirSync(join(sandbox.home, ".provision/kit"), { recursive: true });
  writeFileSync(join(sandbox.home, ".provision/arguments"), "");
  chmodSync(join(sandbox.home, ".provision/arguments"), 0o400);
  chmodSync(join(sandbox.home, ".provision"), 0o500);
};

const addFakeRootSudo = (sandbox: ShellSandbox) =>
  addFakeCommand(
    sandbox,
    "sudo",
    'printf "%s\\n" "$*" >> "$HOME/../sudo.log"; [ "$1" = -n ] && shift; if [ "$1" = chown ]; then chmod -R u+rwX "${@: -1}"; exit 0; fi; exec "$@"',
  );

describe("a ~/.provision left behind by root", () => {
  let sandbox: ShellSandbox;

  beforeEach(() => {
    sandbox = createShellSandbox();
    addFakeRootSudo(sandbox);
  });

  afterEach(() => {
    chmodSync(join(sandbox.home, ".provision"), 0o700);
    disposeShellSandbox(sandbox);
  });

  it("is noticed", () => {
    lockLikeRoot(sandbox);
    expect(runWithProvision(sandbox, "has_foreign_files_in_provision_home && echo foreign").stdout).toBe("foreign\n");
  });

  it("is given back to the user with sudo before anything writes to it", () => {
    lockLikeRoot(sandbox);
    const result = runWithProvision(sandbox, "repair_provision_home; save_arguments --github owner; cat \"$HOME/.provision/arguments\" | tr '\\0' ' '");
    expect(result.stderr).toBe("");
    expect(readFileSync(join(sandbox.root, "sudo.log"), "utf8")).toContain(`-n chown -R rack:staff ${join(sandbox.home, ".provision")}`);
    expect(result.stdout).toContain("gave");
    expect(result.stdout).toContain("--github owner");
  });

  it("is left alone when it already belongs to the user", () => {
    mkdirSync(join(sandbox.home, ".provision"), { recursive: true });
    runWithProvision(sandbox, "repair_provision_home");
    expect(existsSync(join(sandbox.root, "sudo.log"))).toBe(false);
  });

  it("gets a fresh copy of the kit the run came from, written as the user", () => {
    mkdirSync(join(sandbox.home, ".provision/kit"), { recursive: true });
    writeFileSync(join(sandbox.home, ".provision/kit/stale.sh"), "");
    runWithProvision(sandbox, "install_kit");
    expect(existsSync(join(sandbox.home, ".provision/kit/stale.sh"))).toBe(false);
    expect(readFileSync(join(sandbox.home, ".provision/kit/provision.sh"), "utf8")).toBe(readFileSync(provisionScript, "utf8"));
  });
});

describe("the provision command link", () => {
  it("finds its kit when started through a symlink, as /usr/local/bin/provision is", () => {
    const sandbox = createShellSandbox();
    const link = join(sandbox.bin, "provision");
    spawnSync("ln", ["-s", provisionScript, link]);
    const result = spawnSync("/bin/bash", [link, "--help"], { encoding: "utf8", env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: sandbox.home, USER: "rack" } });
    disposeShellSandbox(sandbox);
    expect(result.stderr).not.toContain("No such file");
  });
});
