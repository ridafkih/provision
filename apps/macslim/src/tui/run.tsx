import { render } from "ink";
import type { Tier } from "../core/task";
import { App } from "./App";

export async function runTui(profile: Tier): Promise<void> {
  const app = render(<App initialProfile={profile} />);
  await app.waitUntilExit();
}
