import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { HERDR_PROTOCOL, HerdrAdapter, HerdrRpcError } from "../src/herdr-adapter.ts";
import { NodeHerdrSocketTransport } from "../src/herdr-socket-transport.ts";

type Config = {
  sessionName: string;
  socketPath: string;
  repo: string;
  resultRoot: string;
  installedPackage?: boolean;
};

const configPath = process.env.LOOM_CANARY_CONFIG;
if (!configPath) throw new Error("LOOM_CANARY_CONFIG is required");
const config = JSON.parse(await readFile(configPath, "utf8")) as Config;
if (!config.sessionName.startsWith("loom-e2e-")) {
  throw new Error("canary requires an approved loom-e2e-* named session");
}
const startedAt = Date.now();
const transport = new NodeHerdrSocketTransport({
  socketPath: config.socketPath,
  timeoutMs: 310_000,
});
const adapter = new HerdrAdapter({ transport, supportedProtocol: HERDR_PROTOCOL });

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function writeResult(value: unknown): Promise<void> {
  const path = join(config.resultRoot, "result.json");
  const temporary = join(config.resultRoot, `.result.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

async function waitForPiReady(target: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const current = await adapter.getAgent(target);
      if (!current.launchPending && current.agentStatus === "idle") return;
    } catch (error) {
      if (
        !(error instanceof HerdrRpcError) ||
        !["agent_not_found", "agent_not_ready"].includes(error.code)
      ) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("timed out waiting for parent Pi readiness");
}

try {
  const initial = await adapter.snapshot();
  if (
    initial.workspaces.length !== 1 ||
    initial.tabs.length !== 1 ||
    initial.panes.length !== 1 ||
    initial.agents.length !== 0
  ) {
    throw new Error("named canary session is not pristine");
  }
  const parentPane = record(initial.panes[0]);
  const parentPaneId = parentPane?.pane_id;
  if (typeof parentPaneId !== "string") throw new Error("bootstrap parent pane is missing");
  const layout = record(initial.layouts[0]);
  const paneLayout = Array.isArray(layout?.panes)
    ? layout.panes.map(record).find((pane) => pane?.pane_id === parentPaneId)
    : undefined;
  const rect = record(paneLayout?.rect);
  if (
    typeof rect?.width !== "number" ||
    rect.width < 161 ||
    typeof rect.height !== "number" ||
    rect.height < 24
  ) {
    throw new Error(
      `parent pane cannot host two usable panes: ${String(rect?.width)}x${String(rect?.height)}`,
    );
  }

  const parentLaunch = config.installedPackage
    ? "exec pi --tools loom_start,loom_close"
    : `PI_LOOM_EXTENSION_PATH=${shellQuote(config.repo)} exec pi --no-extensions -e ${shellQuote(config.repo)} --tools loom_start,loom_close`;
  const parentCommand = [`cd ${shellQuote(config.repo)}`, parentLaunch].join(" && ");
  await adapter.sendPaneInput(parentPaneId, { text: parentCommand, keys: ["Enter"] });
  await waitForPiReady(parentPaneId, 90_000);

  const parentPrompt = `Run one Pi Loom canary.

First turn:
- Call loom_start exactly once.
- name: helper-canary
- role: reviewer
- workstream: canary
- task: Read README.md Tools using only read/grep/find/ls. Do not modify files. Call loom_report with COMPLETED. summary must contain exact token LOOM_ASSERTION: SKILL_MECHANICS_WORKS. pointers must contain README.md. changed must be empty. checks must quote the loom_start description.
- access: read
- files: README.md
- deliverable: README.md
- keep: false
- Omit model/thinking so Pi defaults apply.
After loom_start returns started, do not poll, wait, inspect, or read the child. Reply exactly WAITING_FOR_CHILD and end the turn.

Later report turn:
A canonical terminal report for task helper-canary will arrive automatically as new input. Verify its status is COMPLETED and it contains the required assertion token and README.md. Then call loom_close exactly once with name helper-canary, integrated true, evidence true, settled true, pending false, service false, keep false, and execute true. If action is closed, reply with the concatenation of CANARY_PARENT_ and COMPLETE, without a separator. Otherwise reply with the concatenation of CANARY_PARENT_ and BLOCKED plus reasons. Do not use any status polling.`;
  await adapter.promptAgent(parentPaneId, parentPrompt, ["working"], 60_000);

  const waited = record(
    await transport.request("pane.wait_for_output", {
      pane_id: parentPaneId,
      source: "recent_unwrapped",
      match: { type: "substring", value: "CANARY_PARENT_COMPLETE" },
      lines: 240,
      strip_ansi: true,
      timeout_ms: 300_000,
    }),
  );
  if (waited?.type !== "output_matched") throw new Error("parent final marker was not observed");

  const transcript = await adapter.readRecent(parentPaneId, 240);
  if (!transcript.includes("[Herdr child report][helper-canary][COMPLETED]")) {
    throw new Error("parent transcript lacks the canonical child report");
  }
  if (!transcript.includes("Outcome: LOOM_ASSERTION: SKILL_MECHANICS_WORKS")) {
    throw new Error("parent transcript lacks the child semantic assertion outcome");
  }
  if (
    !transcript.includes("Helper helper-canary: closed") ||
    !transcript.includes("CANARY_PARENT_COMPLETE")
  ) {
    throw new Error("parent transcript lacks completion marker");
  }
  const finalSnapshot = await adapter.snapshot();
  if (finalSnapshot.panes.length !== 1) {
    throw new Error(`helper was not retired; ${finalSnapshot.panes.length} panes remain`);
  }
  if (finalSnapshot.focusedPaneId !== initial.focusedPaneId) {
    throw new Error("foreground pane changed during canary");
  }

  const result = {
    status: "completed",
    sessionName: config.sessionName,
    wallTimeMs: Date.now() - startedAt,
    initialGeometry: `${rect.width}x${rect.height}`,
    finalPaneCount: finalSnapshot.panes.length,
    parentPollingCalls: 0,
    assertion: "LOOM_ASSERTION: SKILL_MECHANICS_WORKS",
    transcript,
  };
  await writeResult(result);
  console.log(JSON.stringify({ ...result, transcript: "<recorded>" }));
} catch (error) {
  const result = {
    status: "preserved",
    sessionName: config.sessionName,
    wallTimeMs: Date.now() - startedAt,
    error: (error as Error).message,
  };
  await writeResult(result);
  console.error(JSON.stringify(result));
  process.exitCode = 1;
}
