import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Item, Step, Task } from "../task";

export const LABEL = "dev.macslim.keep-terminal";
const SCRIPT_PATH = "/Library/Application Support/macslim/keep-terminal.sh";
const PLIST_PATH = `/Library/LaunchAgents/${LABEL}.plist`;

/**
 * Polls every few seconds. Each Terminal window runs a `login` child, so no
 * `login` children means no windows. `open -a` launches Terminal, or, if it's
 * running with no windows, sends it a reopen event, which opens a new window.
 * Uses ps rather than pgrep, which can't see GUI apps from some contexts, and
 * never scripts Terminal, so it needs no Automation permission.
 */
export const SCRIPT = `#!/bin/sh
# Installed by macslim: keeps a Terminal window open in the GUI session.
while :; do
  term=$(ps -axo pid=,comm= | awk '$2 ~ /\\/Terminal\\.app\\/Contents\\/MacOS\\/Terminal$/ { print $1; exit }')
  windows=$(ps -axo ppid=,comm= | awk -v p="$term" '$1 == p && $2 == "login"' | wc -l)
  if [ -z "$term" ] || [ "$windows" -eq 0 ]; then
    open -a Terminal
    sleep 5
  fi
  sleep 3
done
`;

export const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${LABEL}</string>
	<key>ProgramArguments</key>
	<array>
		<string>/bin/sh</string>
		<string>${SCRIPT_PATH}</string>
	</array>
	<key>LimitLoadToSessionType</key>
	<string>Aqua</string>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>ProcessType</key>
	<string>Background</string>
	<key>Nice</key>
	<integer>10</integer>
</dict>
</plist>
`;

function write(path: string, content: string, mode: string): Step[] {
  return [
    {
      argv: ["/bin/sh", "-c", 'mkdir -p "$(dirname "$2")" && printf "%s" "$1" > "$2"', "sh", content, path],
      display: `write ${path}`,
    },
    { argv: ["chown", "root:wheel", path] },
    { argv: ["chmod", mode, path] },
  ];
}

const matches = (path: string, content: string) => existsSync(path) && readFileSync(path, "utf8") === content;

export const keepTerminal: Task = {
  id: "keep-terminal",
  group: "desktop",
  title: "Always keep a Terminal open",
  summary: "A tiny login agent that reopens Terminal within seconds when it's quit or its last window is closed.",
  tier: "host",
  caveat: "Quitting Terminal won't stick — it comes straight back. Restore removes the agent.",
  async inspect({ launchd, ctx }) {
    const script = matches(SCRIPT_PATH, SCRIPT);
    const plist = matches(PLIST_PATH, PLIST);
    const loaded = launchd.gui.loaded.has(LABEL);
    const items: Item[] = [
      { name: SCRIPT_PATH, state: script ? "done" : "todo" },
      { name: PLIST_PATH, state: plist ? "done" : "todo" },
      { name: `${LABEL} (agent)`, state: loaded ? "done" : "todo", note: loaded ? undefined : "not loaded" },
    ];
    if (script && plist && loaded) return { state: "done", items, apply: [], undo: [] };

    const gui = `gui/${ctx.uid}`;
    const apply: Step[] = [
      ...(script ? [] : write(SCRIPT_PATH, SCRIPT, "755")),
      ...(plist ? [] : write(PLIST_PATH, PLIST, "644")),
      // Reload so a changed script or plist takes effect.
      { argv: ["launchctl", "bootout", `${gui}/${LABEL}`], tolerate: true },
      { argv: ["launchctl", "bootstrap", gui, PLIST_PATH] },
    ];
    const undo: Step[] = [
      { argv: ["launchctl", "bootout", `${gui}/${LABEL}`], tolerate: true },
      { argv: ["rm", "-f", PLIST_PATH] },
      { argv: ["rm", "-rf", dirname(SCRIPT_PATH)] },
    ];
    return { state: items.some((i) => i.state === "done") ? "partial" : "todo", items, apply, undo };
  },
};
