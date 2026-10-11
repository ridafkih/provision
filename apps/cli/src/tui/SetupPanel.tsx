import { Box, Text, useApp, useInput } from "ink";
import { useEffect, useState } from "react";
import { createChecklist, type ChecklistItem } from "../core/checklist";
import type { Setup } from "../setup/context";
import { setupSteps } from "../setup/run";

export type SetupRequest = { kind: "setup"; stepIds: string[] };

type SetupPanelProps = { setup: Setup; isActive: boolean; canApply: string | undefined; onRequest: (request: SetupRequest) => void };

const glyphOf: Record<ChecklistItem["kind"], [string, string]> = {
  ok: ["✓", "green"],
  fail: ["✗", "red"],
  owner: ["!", "yellow"],
  note: ["·", "gray"],
};

const summaryOf = (items: ChecklistItem[] | undefined) => {
  if (!items) return ["…", "gray"] as const;
  if (items.some((item) => item.kind === "fail")) return ["○", "yellow"] as const;
  if (items.some((item) => item.kind === "owner")) return ["!", "yellow"] as const;
  return ["✓", "green"] as const;
};

export function SetupPanel({ setup, isActive, canApply, onRequest }: SetupPanelProps) {
  const { exit } = useApp();
  const [results, setResults] = useState<Map<string, ChecklistItem[]>>(new Map());
  const [selected, setSelected] = useState(() => new Set(setupSteps.map((step) => step.id)));
  const [cursor, setCursor] = useState(0);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const checkNext = async (index: number) => {
      const step = setupSteps[index];
      if (!step) return;
      const checklist = createChecklist();
      await step.check?.(setup, checklist);
      setResults((previous) => new Map(previous).set(step.id, checklist.items));
      setTimeout(() => void checkNext(index + 1), 0);
    };
    setTimeout(() => void checkNext(0), 0);
  }, [setup]);

  useInput(
    (input, key) => {
      setNotice("");
      if (input === "q" || key.escape) exit();
      else if (key.upArrow || input === "k") setCursor((value) => Math.max(0, value - 1));
      else if (key.downArrow || input === "j") setCursor((value) => Math.min(setupSteps.length - 1, value + 1));
      else if (input === " ") {
        const id = setupSteps[cursor]!.id;
        setSelected((previous) => {
          const next = new Set(previous);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      } else if (input === "x") {
        if (canApply) return setNotice(canApply);
        if (selected.size === 0) return setNotice("Nothing selected.");
        onRequest({ kind: "setup", stepIds: setupSteps.filter((step) => selected.has(step.id)).map((step) => step.id) });
        exit();
      }
    },
    { isActive },
  );

  if (!isActive) return null;
  const current = setupSteps[cursor]!;
  const items = results.get(current.id) ?? [];

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">provision · setup</Text>
      <Box flexDirection="column" marginTop={1}>
        {setupSteps.map((step, index) => {
          const [glyph, color] = summaryOf(step.check ? results.get(step.id) : []);
          return (
            <Text key={step.id} inverse={index === cursor}>
              {"  "}
              {selected.has(step.id) ? "[x]" : "[ ]"} <Text color={color}>{glyph}</Text> {step.title}
            </Text>
          );
        })}
      </Box>
      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginTop={1}>
        <Text bold>{current.title}</Text>
        {items.length === 0 && <Text dimColor>{current.check ? (results.has(current.id) ? "Nothing to report." : "Checking…") : "Applied as part of setup; nothing to check on its own."}</Text>}
        {items.map((item) => (
          <Text key={item.label} wrap="truncate-end">
            <Text color={glyphOf[item.kind][1]}>{glyphOf[item.kind][0]}</Text> {item.label}
            {"hint" in item && <Text dimColor>  {item.hint}</Text>}
          </Text>
        ))}
      </Box>
      {notice && <Text color="yellow">{notice}</Text>}
      <Text dimColor>tab slim · ↑↓ move · space toggle · x apply the selected steps · q quit</Text>
    </Box>
  );
}
