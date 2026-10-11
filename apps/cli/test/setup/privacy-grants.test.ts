import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureTccProbeKey, expandGrants, grantState, privacyGrants, tccClientOf } from "../../src/setup/steps/privacy-grants";
import { addFakeCommand, createSandbox, disposeSandbox, printedText, setupOf, type Sandbox } from "../sandbox";

const sshWrapper = "/usr/libexec/sshd-keygen-wrapper";

describe("privacy grants", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = createSandbox();
  });
  afterEach(() => disposeSandbox(sandbox));

  it("asks for Full Disk Access first, so it can read the other grants back, and asks once per grant", () => {
    const grants = expandGrants(["accessibility:/Applications/Tool.app", `all:${sshWrapper}`, "accessibility:/Applications/Tool.app"]);
    expect(grants.map((grant) => `${grant.kind}:${grant.path}`)).toEqual([
      `full-disk-access:${sshWrapper}`,
      "accessibility:/Applications/Tool.app",
      `screen-recording:${sshWrapper}`,
      `accessibility:${sshWrapper}`,
    ]);
  });

  it("names an app by its bundle id and a tool by its path, as the privacy database does", () => {
    addFakeCommand(sandbox, "defaults", 'echo "com.example.tool"');
    expect(tccClientOf(sandbox.machine, "/Applications/Tool.app")).toBe("com.example.tool");
    expect(tccClientOf(sandbox.machine, sshWrapper)).toBe(sshWrapper);
  });

  it("reads a grant as on only when its auth value is 2", () => {
    addFakeCommand(sandbox, "sqlite3", 'case "$2" in *ScreenCapture*) echo 2 ;; *) echo 0 ;; esac');
    expect(grantState(sandbox.machine, { kind: "screen-recording", path: sshWrapper })).toBe("granted");
    expect(grantState(sandbox.machine, { kind: "accessibility", path: sshWrapper })).toBe("absent");
  });

  it("reads the database over SSH to this Mac when Terminal can't, once remote users have Full Disk Access", () => {
    addFakeCommand(sandbox, "sqlite3", "exit 1");
    addFakeCommand(sandbox, "ssh", 'printf "%s\\n" "$*" > "$HOME/ssh-call"; echo 2');
    mkdirSync(join(sandbox.home, ".provision/tcc-probe"), { recursive: true });
    writeFileSync(join(sandbox.home, ".provision/tcc-probe/id_ed25519"), "key");
    expect(grantState(sandbox.machine, { kind: "full-disk-access", path: sshWrapper })).toBe("granted");
    const call = readFileSync(join(sandbox.home, "ssh-call"), "utf8");
    expect(call).toContain("rack@127.0.0.1");
    expect(call).toContain("kTCCServiceSystemPolicyAllFiles");
  });

  it("walks every grant in all and checks each took before moving to the next, even when reading it back goes over SSH", async () => {
    addFakeCommand(sandbox, "sqlite3", "exit 1");
    addFakeCommand(sandbox, "ssh", 'cat >/dev/null; for service in SystemPolicyAllFiles ScreenCapture Accessibility; do case "$*" in *"kTCCService$service"*) [ -e "$HOME/opened-$service" ] && echo 2 || echo 0; exit 0 ;; esac; done');
    sandbox.machine.paths.open = addFakeCommand(
      sandbox,
      "open",
      'printf "%s\\n" "$*" >> "$HOME/opened"; case "$1" in *Privacy_AllFiles) touch "$HOME/opened-SystemPolicyAllFiles" ;; *Privacy_ScreenCapture) touch "$HOME/opened-ScreenCapture" ;; *Privacy_Accessibility) touch "$HOME/opened-Accessibility" ;; esac',
    );
    mkdirSync(join(sandbox.home, ".ssh"), { recursive: true });
    await privacyGrants.apply(setupOf(sandbox, ["--grant", `all:${sshWrapper}`]));
    const printed = printedText(sandbox);
    const confirmations = ["Full Disk Access", "Screen & System Audio Recording", "Accessibility"].map((title) => printed.indexOf(`set: ${title} for ${sshWrapper}`));
    expect(confirmations.every((index) => index >= 0)).toBe(true);
    expect(confirmations).toEqual(confirmations.toSorted((a, b) => a - b));
    expect(readFileSync(join(sandbox.home, "opened"), "utf8").match(/Privacy_/g)).toHaveLength(3);
  }, 30_000);

  it("says unreadable when neither Terminal nor SSH can read the database", () => {
    addFakeCommand(sandbox, "sqlite3", "exit 1");
    expect(grantState(sandbox.machine, { kind: "full-disk-access", path: sshWrapper })).toBe("unreadable");
  });

  it("authorizes its probe key for this Mac only, once", () => {
    mkdirSync(join(sandbox.home, ".ssh"), { recursive: true });
    ensureTccProbeKey(sandbox.machine);
    ensureTccProbeKey(sandbox.machine);
    const authorizedKeys = readFileSync(join(sandbox.home, ".ssh/authorized_keys"), "utf8");
    expect(authorizedKeys.match(/provision tcc probe/g)).toHaveLength(1);
    expect(authorizedKeys.match(/^from="127\.0\.0\.1,::1"/gm)).toHaveLength(1);
  });
});
