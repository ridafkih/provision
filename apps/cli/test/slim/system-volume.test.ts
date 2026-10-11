import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { TASKS } from "../../src/slim/catalog";
import { inspectAll, openEnv } from "../../src/slim/engine";
import type { Step } from "../../src/slim/task";

const sourceDirectory = resolve(import.meta.dirname, "../../src");
const sealedVolumeCommands = new Set(["bless", "mount", "umount", "csrutil", "diskutil", "asr", "apfs.util"]);
const sealedVolumeWords = /\bbless\b|\bmount\b|authenticated-root|create-snapshot|last-sealed-snapshot|\bapfs\b|nvram|csrutil (disable|enable)/;

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(join(directory, entry.name)) : [join(directory, entry.name)],
  );

const touchesSealedVolume = (step: Step) =>
  sealedVolumeCommands.has(step.argv[0]!.split("/").pop()!) ||
  step.argv.some((argument) => sealedVolumeWords.test(argument) || /^\/(System|usr|bin|sbin)\//.test(argument) && step.argv[0] === "rm");

describe("the sealed system volume", () => {
  test("no source file mounts, blesses or unseals it", () => {
    const offenders = sourceFiles(sourceDirectory).filter((file) => sealedVolumeWords.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  test("no step any task would run on this Mac, applied or undone, touches it", async () => {
    const environment = await openEnv();
    const inspections = await inspectAll(environment, TASKS);
    const offending = [...inspections].flatMap(([id, inspection]) =>
      [...inspection.apply, ...inspection.undo].filter(touchesSealedVolume).map((step) => `${id}: ${step.argv.join(" ")}`),
    );
    expect(offending).toEqual([]);
  }, 120_000);

  test("the guard catches the steps that bricked the runner", () => {
    expect(touchesSealedVolume({ argv: ["bless", "--mount", "/private/var/x", "--bootefi", "--create-snapshot"] })).toBe(true);
    expect(touchesSealedVolume({ argv: ["mount", "-o", "nobrowse", "-t", "apfs", "/dev/disk3s1", "/private/var/x"] })).toBe(true);
    expect(touchesSealedVolume({ argv: ["rm", "-rf", "/System/Applications/Chess.app"] })).toBe(true);
    expect(touchesSealedVolume({ argv: ["launchctl", "disable", "system/com.apple.backupd"] })).toBe(false);
  });
});
