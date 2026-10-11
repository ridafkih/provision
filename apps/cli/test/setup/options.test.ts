import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadSavedArguments, parseArguments, saveArguments } from "../../src/setup/options";
import { createSandbox, disposeSandbox, type Sandbox } from "../sandbox";

const workerKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIWorkerKeyMaterialOnly ci@example";

describe("arguments", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = createSandbox();
  });
  afterEach(() => disposeSandbox(sandbox));

  it("collects repeatable flags and roles", () => {
    const options = parseArguments(["--github", "one", "--github", "two", "--ssh-key", workerKey, "--role", "runner", "--role", "worker", "--runner-repo", "o/r", "--runner-label", "app", "--hostname", "rack-1"]);
    expect(options).toMatchObject({ githubUsers: ["one", "two"], extraPublicKeys: [workerKey], roles: ["runner", "worker"], runnerRepository: "o/r", runnerLabels: ["app"], wantedHostname: "rack-1" });
  });

  it("refuses an unknown role", () => {
    expect(() => parseArguments(["--role", "printer"])).toThrow("unknown role 'printer'");
  });

  it("refuses a hostname that is not a DNS label", () => {
    expect(() => parseArguments(["--hostname", "rack one"])).toThrow("--hostname takes letters, digits and dashes");
  });

  it("refuses an unknown option", () => {
    expect(() => parseArguments(["--colour"])).toThrow("unknown option '--colour'");
  });

  it("expands a profile in place, before the caller's own arguments", () => {
    const options = parseArguments(["--profile", "rida", "--role", "runner"]);
    expect(options.githubUsers).toEqual(["ridafkih"]);
    expect(options.requestedGrants).toEqual(["all:/usr/libexec/sshd-keygen-wrapper"]);
    expect(options.roles).toEqual(["runner"]);
  });

  it("refuses a profile that does not exist", () => {
    expect(() => parseArguments(["--profile", "nobody"])).toThrow("no profile named nobody");
  });

  it("opts out of slimming with --no-slim", () => {
    expect(parseArguments(["--no-slim"]).isSlimSkipped).toBe(true);
    expect(parseArguments([]).isSlimSkipped).toBe(false);
  });

  it("replays the saved arguments, spaces and all, when run again with none", () => {
    mkdirSync(join(sandbox.home, ".provision"));
    saveArguments(sandbox.home, ["--ssh-key", workerKey, "--role", "worker", "--no-slim"]);
    const options = parseArguments(loadSavedArguments(sandbox.home));
    expect(options).toMatchObject({ extraPublicKeys: [workerKey], roles: ["worker"], isSlimSkipped: true });
  });
});

describe("privacy grant arguments", () => {
  it("refuses a grant with an unknown kind or a relative path", () => {
    expect(() => parseArguments(["--grant", "camera:/x"])).toThrow("--grant takes");
    expect(() => parseArguments(["--grant", "accessibility:tool"])).toThrow("--grant takes");
  });
});
