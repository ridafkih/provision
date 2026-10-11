import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { slim, slimProfileFor, unconfirmedRemoteAccess } from "../../src/setup/steps/slim";
import { addFakeCommand, addFakeSudo, createSandbox, disposeSandbox, printedText, setupOf, type Sandbox } from "../sandbox";

describe("the slim step", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = createSandbox();
    addFakeSudo(sandbox);
    addFakeCommand(sandbox, "lsof", "exit 1");
    addFakeCommand(sandbox, "nc", "exit 1");
    addFakeCommand(sandbox, "fdesetup", 'echo "FileVault is On."');
    addFakeCommand(sandbox, "defaults", "exit 1");
  });
  afterEach(() => disposeSandbox(sandbox));

  it("slims VM hosts to the host profile and every other Mac to the lean one", () => {
    expect(slimProfileFor(setupOf(sandbox, ["--role", "runner", "--runner-repo", "o/r"]))).toBe("host");
    expect(slimProfileFor(setupOf(sandbox, ["--role", "worker"]))).toBe("host");
    expect(slimProfileFor(setupOf(sandbox))).toBe("lean");
  });

  it("does nothing with --no-slim", async () => {
    await slim.apply(setupOf(sandbox, ["--no-slim"]));
    expect(printedText(sandbox)).toBe("skipped: --no-slim");
  });

  it("waits until SSH, unattended boot and Tailscale are confirmed", async () => {
    expect(unconfirmedRemoteAccess(sandbox.machine)).toEqual([
      "SSH is not listening",
      "FileVault is not off",
      "automatic login is not set to rack",
      "this Mac is not on the tailnet",
    ]);
    await slim.apply(setupOf(sandbox));
    expect(printedText(sandbox)).toStartWith("skipped: slimming waits until remote access is confirmed");
  });
});
