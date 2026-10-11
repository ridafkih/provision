import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createSandbox, disposeSandbox, publishFakeBinary, type Sandbox } from "../sandbox";

const installScript = resolve(import.meta.dirname, "../../../../install.sh");


const install = (sandbox: Sandbox, args: string[]) =>
  spawnSync("/bin/bash", ["-s", "--", ...args], {
    input: readFileSync(installScript, "utf8"),
    encoding: "utf8",
    env: { HOME: sandbox.home, PATH: "/usr/bin:/bin" },
  });

describe("install.sh", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = createSandbox();
  });
  afterEach(() => disposeSandbox(sandbox));

  it("downloads the released binary into a temporary directory and hands it every argument, profile included", () => {
    const result = install(sandbox, ["--binary", publishFakeBinary(sandbox, 'printf "%s|" "$@"'), "--profile", "owner", "--ssh-key", "ssh-ed25519 KEY it's mine"]);
    expect(result.stdout).toBe("--profile|owner|--ssh-key|ssh-ed25519 KEY it's mine|");
    expect(spawnSync("test", ["-e", join(sandbox.home, ".provision")]).status).toBe(1);
  });

  it("runs even when a root-owned ~/.provision is unreadable to its owner", () => {
    const binary = publishFakeBinary(sandbox, 'printf "%s|" "$@"');
    mkdirSync(join(sandbox.home, ".provision/kit"), { recursive: true });
    chmodSync(join(sandbox.home, ".provision"), 0o000);
    const result = install(sandbox, ["--binary", binary, "--github", "someone"]);
    chmodSync(join(sandbox.home, ".provision"), 0o700);
    expect(result.stdout).toBe("--github|someone|");
  });

  it("refuses a binary that does not match its published checksum", () => {
    const result = install(sandbox, ["--binary", publishFakeBinary(sandbox, "echo ran", "0".repeat(64))]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("does not match its checksum");
  });

  it("stops when the release can't be downloaded", () => {
    const result = install(sandbox, ["--binary", `file://${join(sandbox.root, "missing")}`]);
    expect(result.status).not.toBe(0);
  });
});
