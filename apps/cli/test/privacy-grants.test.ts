import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addFakeCommand, createShellSandbox, disposeShellSandbox, runWithProvision, type ShellSandbox } from "./shell.ts";

const sshWrapper = "/usr/libexec/sshd-keygen-wrapper";

describe("privacy grants", () => {
  let sandbox: ShellSandbox;

  beforeEach(() => {
    sandbox = createShellSandbox();
  });

  afterEach(() => disposeShellSandbox(sandbox));

  it("asks for Full Disk Access first, so it can read the other grants back, and asks once per grant", () => {
    const result = runWithProvision(
      sandbox,
      `parse_arguments --grant accessibility:/Applications/Tool.app --grant all:${sshWrapper} --grant accessibility:/Applications/Tool.app; expand_grants`,
    );
    expect(result.stdout.trim().split("\n")).toEqual([
      `full-disk-access:${sshWrapper}`,
      "accessibility:/Applications/Tool.app",
      `screen-recording:${sshWrapper}`,
      `accessibility:${sshWrapper}`,
    ]);
  });

  it("refuses a grant with an unknown kind or a relative path", () => {
    expect(runWithProvision(sandbox, "parse_arguments --grant camera:/x").stderr).toContain("--grant takes");
    expect(runWithProvision(sandbox, "parse_arguments --grant accessibility:tool").stderr).toContain("--grant takes");
  });

  it("names an app by its bundle id and a tool by its path, as the privacy database does", () => {
    addFakeCommand(sandbox, "defaults", 'echo "com.example.tool"');
    expect(runWithProvision(sandbox, "tcc_client_of /Applications/Tool.app").stdout.trim()).toBe("com.example.tool");
    expect(runWithProvision(sandbox, `tcc_client_of ${sshWrapper}`).stdout.trim()).toBe(sshWrapper);
  });

  it("reads a grant as on only when its auth value is 2", () => {
    addFakeCommand(sandbox, "sqlite3", 'case "$2" in *ScreenCapture*) echo 2 ;; *) echo 0 ;; esac');
    expect(runWithProvision(sandbox, `grant_state screen-recording ${sshWrapper}`).stdout.trim()).toBe("granted");
    expect(runWithProvision(sandbox, `grant_state accessibility ${sshWrapper}`).stdout.trim()).toBe("absent");
  });

  it("reads the database over SSH to this Mac when Terminal can't, once remote users have Full Disk Access", () => {
    addFakeCommand(sandbox, "sqlite3", "exit 1");
    addFakeCommand(sandbox, "ssh", 'printf "%s\\n" "$*" > "$HOME/ssh-call"; echo 2');
    mkdirSync(join(sandbox.home, ".provision/tcc-probe"), { recursive: true });
    writeFileSync(join(sandbox.home, ".provision/tcc-probe/id_ed25519"), "key");
    const result = runWithProvision(sandbox, `grant_state full-disk-access ${sshWrapper}; cat "$HOME/ssh-call"`);
    expect(result.stdout).toContain("granted\n");
    expect(result.stdout).toContain("rack@127.0.0.1");
    expect(result.stdout).toContain("kTCCServiceSystemPolicyAllFiles");
  });

  it("walks every grant in all, checking each before the next, even though reading it back goes over SSH", () => {
    addFakeCommand(sandbox, "sqlite3", "exit 1");
    addFakeCommand(sandbox, "ssh", '[ "$1" = -n ] || cat >/dev/null; for service in SystemPolicyAllFiles ScreenCapture Accessibility; do case "$*" in *"kTCCService$service"*) [ -e "$HOME/opened-$service" ] && echo 2 || echo 0; exit 0 ;; esac; done');
    addFakeCommand(sandbox, "open", 'case "$1" in *Privacy_AllFiles) touch "$HOME/opened-SystemPolicyAllFiles" ;; *Privacy_ScreenCapture) touch "$HOME/opened-ScreenCapture" ;; *Privacy_Accessibility) touch "$HOME/opened-Accessibility" ;; esac');
    mkdirSync(join(sandbox.home, ".ssh"), { recursive: true });
    const result = runWithProvision(sandbox, `parse_arguments --grant all:${sshWrapper}; step_privacy_grants`);
    expect(result.stdout).toContain(`set: Full Disk Access for ${sshWrapper}`);
    expect(result.stdout).toContain(`set: Screen & System Audio Recording for ${sshWrapper}`);
    expect(result.stdout).toContain(`set: Accessibility for ${sshWrapper}`);
  });

  it("says unreadable when neither Terminal nor SSH can read the database", () => {
    addFakeCommand(sandbox, "sqlite3", "exit 1");
    expect(runWithProvision(sandbox, `grant_state full-disk-access ${sshWrapper}`).stdout.trim()).toBe("unreadable");
  });

  it("authorizes its probe key for this Mac only, once", () => {
    mkdirSync(join(sandbox.home, ".ssh"), { recursive: true });
    runWithProvision(sandbox, "ensure_tcc_probe_key; ensure_tcc_probe_key");
    const result = runWithProvision(sandbox, 'grep -c "provision tcc probe" "$HOME/.ssh/authorized_keys"; grep -c "^from=\\"127.0.0.1,::1\\"" "$HOME/.ssh/authorized_keys"');
    expect(result.stdout).toBe("1\n1\n");
  });
});
