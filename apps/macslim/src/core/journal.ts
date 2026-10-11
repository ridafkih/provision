import { chmodSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import type { Metrics } from "./measure";
import type { Step } from "./task";

export interface Entry {
  task: string;
  at: string;
  macos: string;
  /** Steps that reverse this entry, captured before it was applied. */
  undo: Step[];
  restoredAt?: string;
}

export interface Journal {
  version: 1;
  /** Metrics from the first apply, to compare against later. */
  baseline?: Metrics;
  entries: Entry[];
}

export const JOURNAL_PATH = process.env.MACSLIM_JOURNAL ?? "/var/db/macslim/journal.json";

export async function loadJournal(path = JOURNAL_PATH): Promise<Journal> {
  const file = Bun.file(path);
  if (!(await file.exists())) return { version: 1, entries: [] };
  return (await file.json()) as Journal;
}

export async function saveJournal(journal: Journal, path = JOURNAL_PATH): Promise<void> {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o755 });
  // Write-then-rename so a crash mid-write never leaves a truncated journal.
  const tmp = `${path}.tmp`;
  await Bun.write(tmp, JSON.stringify(journal, null, 2) + "\n");
  chmodSync(tmp, 0o644);
  renameSync(tmp, path);
}

/** Entries that have been applied and not yet restored, newest first. */
export function pending(journal: Journal, only?: Set<string>): Entry[] {
  return journal.entries.filter((e) => !e.restoredAt && (!only || only.has(e.task))).toReversed();
}
