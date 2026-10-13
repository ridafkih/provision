import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const runnerRoleDirectory = resolve(import.meta.dirname, "../../assets/runner");
export const jitConfig = "jit-config-for-one-job";

export type RecordedRequest = { method: string; path: string; body: string };

type FakeRunner = { id: number; name: string; status: "online" | "offline"; busy: boolean; labels: { name: string }[] };

export type FakeRepository = { runners: FakeRunner[]; queuedJobLabels: string[][] };

export type FakeGitHub = { repositories: Record<string, FakeRepository>; nextRunnerId: number };

export type Sandbox = {
  root: string;
  home: string;
  tartState: string;
  requests: RecordedRequest[];
  server: Server;
  apiUrl: string;
  latestRunnerVersion: { value: string };
  github: FakeGitHub;
};

const readBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
};

const labelsOf = (names: string[]) => names.map((name) => ({ name }));

const appLabels = labelsOf(["self-hosted", "Linux", "ARM64", "app"]);

export const fakeRepository = (runners: FakeRunner[] = []): FakeRepository => ({ runners, queuedJobLabels: [] });

const startingRepositories = (): Record<string, FakeRepository> => ({
  "example/app": fakeRepository([
    { id: 11, name: "rack-runner-1-1700000000", status: "offline", busy: false, labels: appLabels },
    { id: 12, name: "rack-runner-1-1700000001", status: "online", busy: true, labels: appLabels },
    { id: 21, name: "rack-runner-2-1700000000", status: "offline", busy: false, labels: appLabels },
  ]),
});

const runnerRelease = (version: string) => ({
  tag_name: `v${version}`,
  assets: [
    {
      name: `actions-runner-linux-x64-${version}.tar.gz`,
      browser_download_url: `https://example.invalid/actions-runner-linux-x64-${version}.tar.gz`,
      digest: "sha256:x64",
    },
    {
      name: `actions-runner-linux-arm64-${version}.tar.gz`,
      browser_download_url: `https://example.invalid/actions-runner-linux-arm64-${version}.tar.gz`,
      digest: "sha256:arm64digest",
    },
    {
      name: `actions-runner-osx-arm64-${version}.tar.gz`,
      browser_download_url: `https://example.invalid/actions-runner-osx-arm64-${version}.tar.gz`,
      digest: "sha256:osxdigest",
    },
  ],
});

const sendJson = (response: import("node:http").ServerResponse, status: number, payload: unknown) => {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(payload));
};

const repositoryRoute = /^\/repos\/([^/]+\/[^/]+)\/actions\/(.*)$/;

const answerRepository = (github: FakeGitHub, repository: FakeRepository, method: string, route: string, body: string) => {
  const path = route.split("?")[0] ?? "";
  if (method === "GET" && path === "runners") return { status: 200, payload: { runners: repository.runners } };
  if (method === "POST" && path === "runners/generate-jitconfig") {
    const request = JSON.parse(body) as { name: string; labels: string[] };
    const id = github.nextRunnerId++;
    repository.runners.push({ id, name: request.name, status: "offline", busy: false, labels: labelsOf(request.labels) });
    return { status: 201, payload: { runner: { id }, encoded_jit_config: jitConfig } };
  }
  const runnerMatch = path.match(/^runners\/(\d+)$/);
  if (runnerMatch) {
    const runner = repository.runners.find((each) => each.id === Number(runnerMatch[1]));
    if (!runner) return { status: 404, payload: {} };
    if (method === "GET") return { status: 200, payload: runner };
    if (method === "DELETE") {
      if (runner.busy) return { status: 422, payload: { message: "Runner is still running a job" } };
      repository.runners = repository.runners.filter((each) => each !== runner);
      return { status: 204 };
    }
  }
  if (method === "GET" && path === "runs") {
    const isQueued = route.includes("status=queued") && repository.queuedJobLabels.length > 0;
    return { status: 200, payload: { workflow_runs: isQueued ? [{ id: 7 }] : [] } };
  }
  if (method === "GET" && path === "runs/7/jobs") {
    return { status: 200, payload: { jobs: repository.queuedJobLabels.map((labels, index) => ({ id: index, status: "queued", labels })) } };
  }
  return { status: 404, payload: {} };
};

const startFakeGitHub = async (requests: RecordedRequest[], latestRunnerVersion: { value: string }, github: FakeGitHub) => {
  const server = createServer(async (request, response) => {
    const body = await readBody(request);
    const path = request.url ?? "";
    const method = request.method ?? "";
    requests.push({ method, path, body });
    if (method === "GET" && path === "/repos/actions/runner/releases/latest") {
      sendJson(response, 200, runnerRelease(latestRunnerVersion.value));
      return;
    }
    const match = path.match(repositoryRoute);
    const repository = match ? github.repositories[match[1] ?? ""] : undefined;
    if (!match || !repository) {
      sendJson(response, 404, {});
      return;
    }
    const answer = answerRepository(github, repository, method, match[2] ?? "", body);
    if (answer.status === 204) response.writeHead(204).end();
    else sendJson(response, answer.status, answer.payload);
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  return { server, apiUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
};

const configLines = (sandbox: Sandbox, overrides: Record<string, string>) => {
  const values: Record<string, string> = {
    GITHUB_API_URL: sandbox.apiUrl,
    GITHUB_REPOSITORIES: "example/app",
    RUNNER_NAME_PREFIX: "rack-runner",
    RUNNER_LABELS: "self-hosted,Linux,ARM64,app",
    RUNNER_LIFETIME_SECONDS: "3600",
    DEMAND_CHECK_INTERVAL_SECONDS: "1",
    LINUX_BASE_IMAGE: "ghcr.io/cirruslabs/ubuntu-runner-arm64:24.04",
    LINUX_GOLDEN_VM: "runner-linux",
    LINUX_SLOTS: "2",
    LINUX_PULL_FREE_GB: "1",
    VM_CPU_COUNT: "4",
    VM_MEMORY_MB: "6144",
    VM_DISK_GB: "80",
    BAKE_MEMORY_MB: "4096",
    BAKE_MAX_AGE_DAYS: "7",
    PREPULL_IMAGES: "postgres:18,amazon/dynamodb-local:3.3.1",
    BOOT_TIMEOUT_SECONDS: "10",
    RETRY_DELAY_SECONDS: "0",
    GUEST_PROBE_INTERVAL_SECONDS: "1",
    GUEST_PROBE_TIMEOUT_SECONDS: "1",
    GUEST_PROBE_FAILURES: "2",
    CREDENTIALS_FILE: join(sandbox.home, ".provision/runner/credentials.env"),
    LOG_DIRECTORY: join(sandbox.root, "logs"),
    MACOS_SLOTS: "0",
    ...overrides,
  };
  return Object.entries(values)
    .filter(([, value]) => value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
};

export const runnerConfigDirectory = (sandbox: Sandbox) => join(sandbox.home, ".provision/runner");

export const writeConfig = (sandbox: Sandbox, overrides: Record<string, string> = {}) => {
  writeFileSync(join(runnerConfigDirectory(sandbox), "runner.env"), `${configLines(sandbox, overrides)}\n`);
};

export const createSandbox = async (): Promise<Sandbox> => {
  const root = mkdtempSync(join(tmpdir(), "runner-mini-test-"));
  const home = join(root, "home");
  const tartState = join(root, "tart");
  mkdirSync(join(home, ".provision/runner"), { recursive: true });
  mkdirSync(join(tartState, "vms"), { recursive: true });
  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(join(root, "logs"), { recursive: true });
  copyFileSync(join(import.meta.dirname, "fake-tart.sh"), join(root, "bin/tart"));
  chmodSync(join(root, "bin/tart"), 0o755);
  writeFileSync(join(home, ".provision/runner/credentials.env"), "GITHUB_RUNNER_TOKEN=github_pat_test\n");
  const requests: RecordedRequest[] = [];
  const latestRunnerVersion = { value: "2.338.0" };
  const github: FakeGitHub = { repositories: startingRepositories(), nextRunnerId: 900 };
  const { server, apiUrl } = await startFakeGitHub(requests, latestRunnerVersion, github);
  const sandbox = { root, home, tartState, requests, server, apiUrl, latestRunnerVersion, github };
  writeConfig(sandbox);
  return sandbox;
};

export const disposeSandbox = (sandbox: Sandbox) => {
  sandbox.server.close();
  rmSync(sandbox.root, { recursive: true, force: true });
};

export const runKitScript = (sandbox: Sandbox, script: string, args: string[], jobSeconds: string) =>
  new Promise<{ status: number | null; output: string }>((resolveRun) => {
    const child = spawn("/bin/bash", [join(runnerRoleDirectory, script), ...args], {
      env: {
        PATH: `${join(sandbox.root, "bin")}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
        HOME: sandbox.home,
        FAKE_TART_STATE: sandbox.tartState,
        FAKE_JOB_SECONDS: jobSeconds,
      },
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (status) => resolveRun({ status, output }));
  });

export const tartCalls = (sandbox: Sandbox) =>
  existsSync(join(sandbox.tartState, "calls.log"))
    ? readFileSync(join(sandbox.tartState, "calls.log"), "utf8").trim().split("\n")
    : [];

export const addVm = (sandbox: Sandbox, vmName: string) => writeFileSync(join(sandbox.tartState, "vms", vmName), "");

export const addCachedImage = (sandbox: Sandbox, reference: string) => {
  const path = join(sandbox.tartState, "vms", reference);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "");
};

export const hasVm = (sandbox: Sandbox, vmName: string) => existsSync(join(sandbox.tartState, "vms", vmName));

export const execStdin = (sandbox: Sandbox) => readFileSync(join(sandbox.tartState, "exec-stdin"), "utf8");

export const crashVm = (sandbox: Sandbox, vmName: string) => writeFileSync(join(sandbox.tartState, `crashed-${vmName}`), "");

export const wedgeGuest = (sandbox: Sandbox, vmName: string) => writeFileSync(join(sandbox.tartState, `wedged-${vmName}`), "");
