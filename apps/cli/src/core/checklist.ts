export type ChecklistItem =
  | { kind: "ok"; label: string }
  | { kind: "fail"; label: string; hint: string }
  | { kind: "owner"; label: string; hint: string }
  | { kind: "note"; label: string };

export type Checklist = {
  items: ChecklistItem[];
  pass: (label: string) => void;
  miss: (label: string, hint: string) => void;
  waitingOnOwner: (label: string, hint: string) => void;
  note: (label: string) => void;
};

export const createChecklist = (): Checklist => {
  const items: ChecklistItem[] = [];
  return {
    items,
    pass: (label) => items.push({ kind: "ok", label }),
    miss: (label, hint) => items.push({ kind: "fail", label, hint }),
    waitingOnOwner: (label, hint) => items.push({ kind: "owner", label, hint }),
    note: (label) => items.push({ kind: "note", label }),
  };
};

export const countOf = (checklist: Checklist, kind: ChecklistItem["kind"]) => checklist.items.filter((item) => item.kind === kind).length;

const renderItem = (item: ChecklistItem) => {
  switch (item.kind) {
    case "ok":
      return `  ✓ ${item.label}\n`;
    case "fail":
      return `  ✗ ${item.label}\n      fix: ${item.hint}\n`;
    case "owner":
      return `  ! ${item.label}\n      you: ${item.hint}\n`;
    case "note":
      return `  · ${item.label}\n`;
  }
};

export const renderChecklist = (checklist: Checklist) => checklist.items.map(renderItem).join("");

export const verdictOf = (checklist: Checklist) => {
  const failures = countOf(checklist, "fail");
  const waiting = countOf(checklist, "owner");
  if (failures > 0) return `Not ready to rack: ${failures} item(s) failed. Fix them and run provision again.`;
  if (waiting > 0) return `Ready to rack once you do the ${waiting} item(s) marked !.`;
  return "Ready to rack.";
};
