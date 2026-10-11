import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addFakeCommand, createShellSandbox, disposeShellSandbox, runWithProvision, type ShellSandbox } from "./shell.ts";

const workerKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIWorkerKeyMaterialOnly ci@example";
const ownerKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOwnerKeyMaterialOnly";

const fakeHost = (sandbox: ShellSandbox, memoryBytes: number, cpuCount: number) => {
  addFakeCommand(sandbox, "sysctl", `case "$2" in hw.memsize) echo ${memoryBytes} ;; hw.ncpu) echo ${cpuCount} ;; esac`);
  addFakeCommand(sandbox, "scutil", "echo Rack-Mini");
};

describe("provision", () => {
  let sandbox: ShellSandbox;

  beforeEach(() => {
    sandbox = createShellSandbox();
  });

  afterEach(() => disposeShellSandbox(sandbox));

  describe("arguments", () => {
    it("collects repeatable flags and roles", () => {
      const result = runWithProvision(
        sandbox,
        `parse_arguments --github one --github two --ssh-key '${workerKey}' --role runner --role worker --runner-repo o/r --runner-label app --hostname rack-1
         printf '%s|' "\${github_users[@]}" "\${extra_public_keys[@]}" "\${roles[@]}" "$runner_repository" "\${runner_labels[@]}" "$wanted_hostname"`,
      );
      expect(result.stdout).toBe(`one|two|${workerKey}|runner|worker|o/r|app|rack-1|`);
    });

    it("refuses an unknown role", () => {
      const result = runWithProvision(sandbox, "parse_arguments --role printer");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("unknown role 'printer'");
    });

    it("refuses a hostname that is not a DNS label", () => {
      const result = runWithProvision(sandbox, "parse_arguments --hostname 'rack one'");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("--hostname takes letters, digits and dashes");
    });

    it("replays the saved arguments, spaces and all, when run again with none", () => {
      runWithProvision(sandbox, `save_arguments --ssh-key '${workerKey}' --role worker`);
      const result = runWithProvision(sandbox, `load_saved_arguments; printf '%s|' "\${extra_public_keys[@]}" "\${roles[@]}"`);
      expect(result.stdout).toBe(`${workerKey}|worker|`);
    });
  });

  describe("authorized keys", () => {
    it("appends only keys it does not already hold, so a rerun adds nothing", () => {
      const authorizedKeys = join(sandbox.home, "authorized_keys");
      const wanted = join(sandbox.home, "wanted");
      writeFileSync(authorizedKeys, `${ownerKey} laptop\n`);
      writeFileSync(wanted, `${ownerKey} github:owner\n${workerKey}\nnot a key\n`);
      const first = runWithProvision(sandbox, `merge_authorized_keys "${authorizedKeys}" "${wanted}"`);
      const second = runWithProvision(sandbox, `merge_authorized_keys "${authorizedKeys}" "${wanted}"`);
      expect(first.stdout.trim()).toBe("1");
      expect(second.stdout.trim()).toBe("0");
      expect(readFileSync(authorizedKeys, "utf8")).toBe(`${ownerKey} laptop\n${workerKey}\n`);
    });

    it("fetches each GitHub user's published keys and labels them", () => {
      addFakeCommand(sandbox, "curl", `printf '%s\\n' "${ownerKey}"`);
      const result = runWithProvision(sandbox, "parse_arguments --github owner; wanted_public_keys");
      expect(result.stdout).toBe(`${ownerKey} github:owner\n`);
    });
  });

  describe("checklist", () => {
    it("says ready to rack only when every item passed", () => {
      const result = runWithProvision(sandbox, `pass "Never sleeps"; note "a note"; render_checklist; checklist_verdict`);
      expect(result.stdout).toBe("  ✓ Never sleeps\n  · a note\nReady to rack.\n");
    });

    it("lists what the owner still has to do", () => {
      const result = runWithProvision(sandbox, `pass "SSH on"; waiting_on_owner "Key expiry off" "Disable key expiry"; render_checklist; checklist_verdict`);
      expect(result.stdout).toContain("  ! Key expiry off\n      you: Disable key expiry\n");
      expect(result.stdout).toContain("Ready to rack once you do the 1 item(s) marked !.");
    });

    it("is not ready while anything failed", () => {
      const result = runWithProvision(sandbox, `miss "FileVault off" "rerun provision"; render_checklist; checklist_verdict`);
      expect(result.stdout).toContain("  ✗ FileVault off\n      fix: rerun provision\n");
      expect(result.stdout).toContain("Not ready to rack: 1 item(s) failed.");
    });
  });

  describe("Tailscale sign-in", () => {
    it("finds the login URL in tailscale up's output", () => {
      const log = join(sandbox.home, "up.log");
      writeFileSync(log, "\nTo authenticate, visit:\n\n\thttps://login.tailscale.com/a/1a2b3c4d5e\n\n");
      const result = runWithProvision(sandbox, `login_url_in "${log}"`);
      expect(result.stdout.trim()).toBe("https://login.tailscale.com/a/1a2b3c4d5e");
    });
  });

  describe("runner role config", () => {

    it("labels the runner, names it after the host and bakes the prepulled images", () => {
      fakeHost(sandbox, 16 * 1024 ** 3, 10);
      const result = runWithProvision(
        sandbox,
        "parse_arguments --runner-repo example/app --runner-label app --runner-prepull postgres:18 --runner-prepull redis:8; runner_config",
      );
      expect(result.stdout).toContain("GITHUB_REPOSITORY=example/app\n");
      expect(result.stdout).toContain("RUNNER_LABELS=self-hosted,Linux,ARM64,app\n");
      expect(result.stdout).toContain("RUNNER_NAME_PREFIX=rack-mini\n");
      expect(result.stdout).toContain("PREPULL_IMAGES=postgres:18,redis:8\n");
      expect(result.stdout).toContain("LINUX_SLOTS=2\n");
    });

    it("keeps the base labels and an empty prepull list when none are given", () => {
      fakeHost(sandbox, 16 * 1024 ** 3, 10);
      const result = runWithProvision(sandbox, "parse_arguments --runner-repo o/r; runner_config");
      expect(result.stdout).toContain("RUNNER_LABELS=self-hosted,Linux,ARM64\n");
      expect(result.stdout).toContain("PREPULL_IMAGES=\n");
    });

    it.each([
      [32, 10, "4"],
      [24, 8, "3"],
      [64, 4, "2"],
    ])("sizes %i GB and %i cores to %s slots", (gigabytes, cores, slots) => {
      fakeHost(sandbox, gigabytes * 1024 ** 3, cores);
      expect(runWithProvision(sandbox, "runner_slot_count").stdout.trim()).toBe(slots);
    });

    it("refuses a host too small for one runner VM", () => {
      fakeHost(sandbox, 8 * 1024 ** 3, 8);
      const result = runWithProvision(sandbox, "runner_slot_count");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("too little for one 6144 MB runner VM");
    });
  });
});
