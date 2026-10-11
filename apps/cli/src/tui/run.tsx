import { Box, useInput } from "ink";
import { render } from "ink";
import { useState } from "react";
import type { Setup } from "../setup/context";
import type { Tier } from "../slim/task";
import { SetupPanel, type SetupRequest } from "./SetupPanel";
import { SlimPanel, type SlimRequest } from "./SlimPanel";

export type TuiRequest = SetupRequest | SlimRequest;

type Tab = "setup" | "slim";

function Root({ setup, profile, canApply, onRequest }: { setup: Setup; profile: Tier; canApply: string | undefined; onRequest: (request: TuiRequest) => void }) {
  const [tab, setTab] = useState<Tab>("setup");
  useInput((_, key) => {
    if (key.tab) setTab((current) => (current === "setup" ? "slim" : "setup"));
  });
  return (
    <Box flexDirection="column">
      <SetupPanel setup={setup} isActive={tab === "setup"} canApply={canApply} onRequest={onRequest} />
      <SlimPanel initialProfile={profile} isActive={tab === "slim"} onRequest={onRequest} />
    </Box>
  );
}

export async function runTui(setup: Setup, profile: Tier, canApply: string | undefined): Promise<TuiRequest | undefined> {
  let request: TuiRequest | undefined;
  const app = render(<Root setup={setup} profile={profile} canApply={canApply} onRequest={(chosen) => (request = chosen)} />);
  await app.waitUntilExit();
  return request;
}
