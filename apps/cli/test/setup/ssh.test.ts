import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchPublicKeys, mergeAuthorizedKeys, wantedPublicKeys } from "../../src/setup/steps/ssh";
import { addFakeCommand, createSandbox, disposeSandbox, printedText, setupOf, type Sandbox } from "../sandbox";

const workerKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIWorkerKeyMaterialOnly ci@example";
const ownerKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOwnerKeyMaterialOnly";

describe("SSH keys", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = createSandbox();
  });
  afterEach(() => disposeSandbox(sandbox));

  it("appends only keys it does not already hold, so a rerun adds nothing", () => {
    const authorizedKeys = join(sandbox.home, "authorized_keys");
    writeFileSync(authorizedKeys, `${ownerKey} laptop\n`);
    const wanted = `${ownerKey} github:owner\n${workerKey}\nnot a key\n`;
    expect(mergeAuthorizedKeys(authorizedKeys, wanted)).toBe(1);
    expect(mergeAuthorizedKeys(authorizedKeys, wanted)).toBe(0);
    expect(readFileSync(authorizedKeys, "utf8")).toBe(`${ownerKey} laptop\n${workerKey}\n`);
  });

  it("fetches each GitHub user's published keys and labels them", () => {
    addFakeCommand(sandbox, "curl", `printf '%s\\n' "${ownerKey}"`);
    expect(wantedPublicKeys(setupOf(sandbox, ["--github", "owner"]))).toBe(`${ownerKey} github:owner\n`);
  });

  it("falls back to the keys saved by the last run when GitHub can't be reached", () => {
    mkdirSync(join(sandbox.home, ".provision"), { recursive: true });
    writeFileSync(join(sandbox.home, ".provision/authorized-keys"), "ssh-ed25519 AAAAsaved github:owner\n");
    addFakeCommand(sandbox, "curl", "exit 6");
    fetchPublicKeys(setupOf(sandbox, ["--github", "owner"]));
    expect(printedText(sandbox)).toContain("using the ones saved by the last run");
  });

  it("stops when GitHub can't be reached and nothing was saved", () => {
    addFakeCommand(sandbox, "curl", "exit 6");
    expect(() => fetchPublicKeys(setupOf(sandbox, ["--github", "owner"]))).toThrow("could not fetch the SSH keys for: owner");
  });

  it("saves freshly fetched keys for the next run", () => {
    addFakeCommand(sandbox, "curl", 'echo "ssh-ed25519 AAAAfresh"');
    fetchPublicKeys(setupOf(sandbox, ["--github", "owner"]));
    expect(readFileSync(join(sandbox.home, ".provision/authorized-keys"), "utf8")).toBe("ssh-ed25519 AAAAfresh github:owner\n");
  });
});
