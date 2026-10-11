import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TASKS } from "../catalog";
import { applyTasks, blocker, describe, inspectAll, openEnv, restoreTasks, type Log } from "../core/engine";
import { loadJournal, pending } from "../core/journal";
import { measure, type Metrics } from "../core/measure";
import { GROUPS, TIERS, inProfile, type Env, type Inspection, type State, type Task, type Tier } from "../core/task";

type Mode = "browse" | "plan" | "confirm-apply" | "confirm-restore" | "running" | "done";
type Row = { kind: "group"; title: string } | { kind: "task"; task: Task };

const STATE_GLYPH: Record<State, [string, string]> = {
  done: ["✓", "green"],
  todo: ["○", "yellow"],
  partial: ["◐", "yellow"],
  absent: ["–", "gray"],
};

const ROWS: Row[] = TASKS.flatMap((task, i) =>
  i === 0 || TASKS[i - 1]!.group !== task.group
    ? [{ kind: "group", title: GROUPS[task.group] } as Row, { kind: "task", task }]
    : [{ kind: "task", task } as Row],
);
const TASK_ROWS = ROWS.flatMap((r, i) => (r.kind === "task" ? [i] : []));

const forProfile = (profile: Tier) => new Set(TASKS.filter((t) => inProfile(t, profile)).map((t) => t.id));

export function App({ initialProfile }: { initialProfile: Tier }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const height = stdout.rows || 40;

  const [env, setEnv] = useState<Env | null>(null);
  const [inspections, setInspections] = useState<Map<string, Inspection>>(new Map());
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [baseline, setBaseline] = useState<Metrics | undefined>();
  const [restorable, setRestorable] = useState(0);
  const [loading, setLoading] = useState("Inspecting services…");

  const [profile, setProfile] = useState<Tier>(initialProfile);
  const [selected, setSelected] = useState(() => forProfile(initialProfile));
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>("browse");
  const [scroll, setScroll] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading("Inspecting services…");
    const fresh = await openEnv(env?.ctx);
    const [ins, m, journal] = await Promise.all([inspectAll(fresh, TASKS), measure(fresh.launchd), loadJournal()]);
    setEnv(fresh);
    setInspections(ins);
    setMetrics(m);
    setBaseline(journal.baseline);
    setRestorable(pending(journal).length);
    setLoading("");
  }, [env]);

  useEffect(() => {
    refresh().catch((e: Error) => setLoading(`Failed: ${e.message}`));
  }, []);

  const chosen = useMemo(
    () => TASKS.filter((t) => selected.has(t.id) && (inspections.get(t.id)?.apply.length ?? 0) > 0),
    [selected, inspections],
  );

  const planLines = useMemo(() => {
    const lines: { text: string; color?: string; dim?: boolean }[] = [];
    for (const task of chosen) {
      const ins = inspections.get(task.id)!;
      lines.push({ text: `▸ ${task.title}${task.irreversible ? "  (irreversible)" : ""}`, color: "cyan" });
      const blocked = env && blocker(task, env.ctx);
      if (blocked) lines.push({ text: `  ! skipped: ${blocked}`, color: "yellow" });
      if (task.caveat) lines.push({ text: `  ⚠ ${task.caveat}`, color: "yellow" });
      for (const step of ins.apply) lines.push({ text: `    $ ${describe(step)}`, dim: true });
    }
    return lines;
  }, [chosen, inspections, env]);

  const appendLog: Log = (kind, text) => {
    if (kind === "step") return;
    const prefix = { task: "▸ ", ok: "  ✓ ", fail: "  ✗ ", skip: "  ! ", info: "  ", step: "" }[kind];
    setLog((l) => [...l, prefix + text]);
  };

  async function run(action: "apply" | "restore") {
    if (!env) return;
    setMode("running");
    setLog([]);
    try {
      const s =
        action === "apply"
          ? await applyTasks(env, chosen, inspections, { dryRun: false, log: appendLog })
          : await restoreTasks(env, undefined, { dryRun: false, log: appendLog });
      setLog((l) => [...l, "", `${s.changed} ${action === "apply" ? "applied" : "restored"}, ${s.failed} failed. Reboot to settle everything.`]);
    } catch (e) {
      setLog((l) => [...l, `✗ ${(e as Error).message}`]);
    }
    setMode("done");
  }

  const task = taskAt(cursor) ?? TASKS[0]!;

  useInput((input, key) => {
    setNotice("");
    if (mode === "running") return;
    if (mode === "done") {
      setMode("browse");
      void refresh();
      return;
    }
    if (mode === "confirm-apply" || mode === "confirm-restore") {
      if (input === "y") void run(mode === "confirm-apply" ? "apply" : "restore");
      else setMode("browse");
      return;
    }
    if (mode === "plan") {
      if (key.upArrow || input === "k") setScroll((s) => Math.max(0, s - 1));
      else if (key.downArrow || input === "j") setScroll((s) => Math.min(Math.max(0, planLines.length - 1), s + 1));
      else if (input === "x") requestApply();
      else if (key.escape || input === "q" || key.return) setMode("browse");
      return;
    }

    if (input === "q" || key.escape) exit();
    else if (key.upArrow || input === "k") setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow || input === "j") setCursor((c) => Math.min(TASK_ROWS.length - 1, c + 1));
    else if (input === " ") {
      setSelected((s) => {
        const next = new Set(s);
        if (next.has(task.id)) next.delete(task.id);
        else next.add(task.id);
        return next;
      });
    } else if (input === "p") {
      const next = TIERS[(TIERS.indexOf(profile) + 1) % TIERS.length]!;
      setProfile(next);
      setSelected(forProfile(next));
    } else if (key.return || input === "v") {
      setScroll(0);
      setMode("plan");
    } else if (input === "x") requestApply();
    else if (input === "r") {
      if (!env?.ctx.isRoot) setNotice("Read-only session — restart with sudo to restore.");
      else if (!restorable) setNotice("Nothing to restore.");
      else setMode("confirm-restore");
    } else if (input === "R") void refresh();
  });

  function requestApply() {
    if (!env?.ctx.isRoot) return setNotice("Read-only session — restart with `sudo macslim` to apply.");
    if (!chosen.length) return setNotice("Nothing selected needs changing.");
    setMode("confirm-apply");
  }

  // ── Layout ──────────────────────────────────────────────────────────────
  const header = (
    <Box flexDirection="column" marginBottom={1}>
      <Box gap={2}>
        <Text bold color="cyan">macslim</Text>
        {env && (
          <Text>
            {env.ctx.model} · macOS {env.ctx.os} · SIP <Text color={env.ctx.sip ? "yellow" : "green"}>{env.ctx.sip ? "on" : "off"}</Text> ·{" "}
            {env.ctx.isRoot ? <Text color="red">root</Text> : <Text dimColor>read-only</Text>}
          </Text>
        )}
      </Box>
      {metrics && (
        <Text dimColor>
          {metrics.processes} processes · {metrics.rssMB} MB resident · {metrics.runningJobs} running jobs · {metrics.diskFreeGB} GB free
          {baseline ? `  (first apply: ${baseline.processes} proc · ${baseline.rssMB} MB · ${baseline.diskFreeGB} GB free)` : ""}
        </Text>
      )}
    </Box>
  );

  if (loading) {
    return (
      <Box flexDirection="column" padding={1}>
        {header}
        <Text color="yellow">{loading}</Text>
      </Box>
    );
  }

  if (mode === "running" || mode === "done") {
    const tail = log.slice(-(height - 8));
    return (
      <Box flexDirection="column" padding={1}>
        {header}
        {tail.map((line, i) => (
          <Text key={i} color={line.includes("✗") ? "red" : line.startsWith("▸") ? "cyan" : undefined}>{line}</Text>
        ))}
        <Text dimColor>{mode === "running" ? "Working…" : "Press any key to continue."}</Text>
      </Box>
    );
  }

  if (mode === "plan") {
    const view = planLines.slice(scroll, scroll + height - 9);
    return (
      <Box flexDirection="column" padding={1}>
        {header}
        <Text bold>Dry run — {planLines.filter((l) => l.text.startsWith("    $")).length} commands</Text>
        {view.length ? (
          view.map((l, i) => <Text key={i} color={l.color} dimColor={l.dim}>{l.text}</Text>)
        ) : (
          <Text color="green">Nothing to do — everything selected is already applied.</Text>
        )}
        <Text dimColor>↑↓ scroll · x apply · esc back</Text>
      </Box>
    );
  }

  const listHeight = Math.max(5, height - 19);
  const cursorRow = TASK_ROWS[cursor]!;
  const start = Math.max(0, Math.min(cursorRow - Math.floor(listHeight / 2), ROWS.length - listHeight));
  const ins = inspections.get(task.id);

  return (
    <Box flexDirection="column" padding={1}>
      {header}
      <Box flexDirection="column" height={listHeight}>
        {ROWS.slice(start, start + listHeight).map((row, i) => {
          if (row.kind === "group") return <Text key={i} bold color="cyan">{row.title}</Text>;
          const active = start + i === cursorRow;
          const state = inspections.get(row.task.id)?.state ?? "absent";
          const [glyph, color] = STATE_GLYPH[state];
          return (
            <Text key={i} inverse={active}>
              {"  "}
              {selected.has(row.task.id) ? "[x]" : "[ ]"} <Text color={color}>{glyph}</Text> {row.task.title}
              <Text dimColor> {row.task.tier}</Text>
            </Text>
          );
        })}
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginTop={1} height={10}>
        <Text bold>
          {task.title} <Text dimColor>[{task.id}]</Text>
          {task.irreversible && <Text color="red">  irreversible</Text>}
        </Text>
        <Text wrap="truncate-end">{task.summary}</Text>
        {task.caveat && <Text color="yellow" wrap="truncate-end">⚠ {task.caveat}</Text>}
        {ins && (
          <Text dimColor>
            {ins.items.filter((i) => i.state === "done").length} done · {ins.items.filter((i) => i.state === "todo").length} to do ·{" "}
            {ins.items.filter((i) => i.state === "absent").length} n/a
          </Text>
        )}
        {ins?.items.slice(0, task.caveat ? 3 : 4).map((item) => (
          <Text key={item.name} wrap="truncate-end">
            <Text color={STATE_GLYPH[item.state][1]}>{STATE_GLYPH[item.state][0]}</Text> {item.name}
            {item.note && <Text dimColor>  {item.note}</Text>}
          </Text>
        ))}
        {ins && ins.items.length > (task.caveat ? 3 : 4) && (
          <Text dimColor>  … {ins.items.length - (task.caveat ? 3 : 4)} more — macslim show {task.id}</Text>
        )}
      </Box>

      {mode === "confirm-apply" && (
        <Text color="red" bold>Apply {chosen.length} task(s)? Changes are journaled and restorable. [y/N]</Text>
      )}
      {mode === "confirm-restore" && <Text color="red" bold>Undo {restorable} journal entries? [y/N]</Text>}
      {notice && <Text color="yellow">{notice}</Text>}
      <Text dimColor>
        ↑↓ move · space toggle · p profile ({profile}) · enter plan · x apply · r restore ({restorable}) · R refresh · q quit
      </Text>
    </Box>
  );
}

function taskAt(cursor: number): Task | undefined {
  const row = ROWS[TASK_ROWS[cursor]!];
  return row?.kind === "task" ? row.task : undefined;
}
