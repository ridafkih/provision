import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderInstaller, shellQuote } from "../build/installer.ts";
import { createShellSandbox, disposeShellSandbox, type ShellSandbox } from "./shell.ts";

const archiveOf = (directory: string) => {
  const archive = spawnSync("tar", ["-czf", "-", "-C", directory, "."], { env: { COPYFILE_DISABLE: "1", PATH: "/usr/bin:/bin" } });
  return archive.stdout.toString("base64");
};

describe("installer", () => {
  let sandbox: ShellSandbox;

  beforeEach(() => {
    sandbox = createShellSandbox();
  });

  afterEach(() => disposeShellSandbox(sandbox));

  it("quotes words with apostrophes and spaces so bash reads them back unchanged", () => {
    const word = "it's a key with  spaces";
    const result = spawnSync("/bin/bash", ["-c", `printf '%s' ${shellQuote(word)}`], { encoding: "utf8" });
    expect(result.stdout).toBe(word);
  });

  it("unpacks the kit into ~/.provision/kit when piped to bash and passes profile arguments before the caller's", () => {
    const kit = join(sandbox.root, "kit");
    mkdirSync(kit);
    writeFileSync(join(kit, "provision.sh"), 'printf "%s|" "$@"\n');
    const installer = renderInstaller({ payloadBase64: archiveOf(kit), profileArguments: ["--github", "owner", "--ssh-key", "ssh-ed25519 KEY it's"] });
    const result = spawnSync("/bin/bash", ["-s", "--", "--role", "runner"], {
      input: installer,
      encoding: "utf8",
      env: { HOME: sandbox.home, PATH: "/usr/bin:/bin" },
    });
    expect(result.stdout).toBe("--github|owner|--ssh-key|ssh-ed25519 KEY it's|--role|runner|");
    expect(spawnSync("test", ["-f", join(sandbox.home, ".provision/kit/provision.sh")]).status).toBe(0);
  });

  it("replaces an older kit on every run", () => {
    const kit = join(sandbox.root, "kit");
    mkdirSync(kit);
    mkdirSync(join(sandbox.home, ".provision/kit"), { recursive: true });
    writeFileSync(join(sandbox.home, ".provision/kit/stale.sh"), "");
    writeFileSync(join(kit, "provision.sh"), "true\n");
    spawnSync("/bin/bash", ["-s"], { input: renderInstaller({ payloadBase64: archiveOf(kit), profileArguments: [] }), env: { HOME: sandbox.home, PATH: "/usr/bin:/bin" } });
    expect(spawnSync("test", ["-e", join(sandbox.home, ".provision/kit/stale.sh")]).status).toBe(1);
  });
});
