import { describe, expect, it } from "bun:test";
import { createChecklist, renderChecklist, verdictOf } from "../../src/core/checklist";

describe("checklist", () => {
  it("says ready to rack only when every item passed", () => {
    const checklist = createChecklist();
    checklist.pass("Never sleeps");
    checklist.note("a note");
    expect(renderChecklist(checklist) + verdictOf(checklist)).toBe("  ✓ Never sleeps\n  · a note\nReady to rack.");
  });

  it("lists what the owner still has to do", () => {
    const checklist = createChecklist();
    checklist.pass("SSH on");
    checklist.waitingOnOwner("Key expiry off", "Disable key expiry");
    expect(renderChecklist(checklist)).toContain("  ! Key expiry off\n      you: Disable key expiry\n");
    expect(verdictOf(checklist)).toBe("Ready to rack once you do the 1 item(s) marked !.");
  });

  it("is not ready while anything failed", () => {
    const checklist = createChecklist();
    checklist.miss("FileVault off", "rerun provision");
    expect(renderChecklist(checklist)).toContain("  ✗ FileVault off\n      fix: rerun provision\n");
    expect(verdictOf(checklist)).toBe("Not ready to rack: 1 item(s) failed. Fix them and run provision again.");
  });
});
