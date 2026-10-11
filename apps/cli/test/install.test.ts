import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createShellSandbox, disposeShellSandbox, type ShellSandbox } from "./shell.ts";

const installScript = resolve(import.meta.dirname, "../../../install.sh");

const makeArchive = (sandbox: ShellSandbox) => {
  const repository = join(sandbox.root, "provision-main");
  mkdirSync(join(repository, "apps/cli/src"), { recursive: true });
  mkdirSync(join(repository, "apps/cli/profiles"), { recursive: true });
  writeFileSync(join(repository, "apps/cli/src/provision.sh"), 'printf "%s|" "$@"\n');
  writeFileSync(join(repository, "apps/cli/profiles/owner.args"), "--github\nowner\n--ssh-key\nssh-ed25519 KEY it's mine\n");
  const archive = join(sandbox.root, "main.tar.gz");
  spawnSync("tar", ["-czf", archive, "-C", sandbox.root, "provision-main"], { env: { COPYFILE_DISABLE: "1", PATH: "/usr/bin:/bin" } });
  return `file://${archive}`;
};

const install = (sandbox: ShellSandbox, args: string[]) =>
  spawnSync("/bin/bash", ["-s", "--", ...args], {
    input: readFileSync(installScript, "utf8"),
    encoding: "utf8",
    env: { HOME: sandbox.home, PATH: "/usr/bin:/bin" },
  });

describe("install.sh", () => {
  let sandbox: ShellSandbox;

  beforeEach(() => {
    sandbox = createShellSandbox();
  });

  afterEach(() => disposeShellSandbox(sandbox));

  it("unpacks the kit from the repository archive and puts the profile's arguments before the caller's", () => {
    const result = install(sandbox, ["--archive", makeArchive(sandbox), "--profile", "owner", "--role", "runner"]);
    expect(result.stdout).toBe("--github|owner|--ssh-key|ssh-ed25519 KEY it's mine|--role|runner|");
    expect(spawnSync("test", ["-f", join(sandbox.home, ".provision/kit/provision.sh")]).status).toBe(0);
  });

  it("passes the caller's arguments through when no profile is named", () => {
    const result = install(sandbox, ["--archive", makeArchive(sandbox), "--github", "someone"]);
    expect(result.stdout).toBe("--github|someone|");
  });

  it("refuses a profile that does not exist", () => {
    const result = install(sandbox, ["--archive", makeArchive(sandbox), "--profile", "nobody"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no profile named nobody");
  });
});
