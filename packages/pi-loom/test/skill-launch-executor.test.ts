import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  HerdrAgentView,
  HerdrSnapshot,
  PersistentLaunchInput,
  PersistentLaunchOutcome,
} from "../src/herdr-adapter.ts";
import { HerdrRpcError } from "../src/herdr-adapter.ts";
import { compilePersistentHelperLaunch } from "../src/skill-launch.ts";
import {
  HelperDirectory,
  SkillLaunchExecutor,
  helperBindingStorePath,
  type SkillLaunchHerdrPort,
} from "../src/skill-launch-executor.ts";

class FakeHerdr implements SkillLaunchHerdrPort {
  readonly calls: string[] = [];
  launchInput?: PersistentLaunchInput;
  prompt?: { target: string; text: string; until?: string[]; timeoutMs?: number };
  promptContractPresent?: boolean;
  paneInput?: { paneId: string; input: { text?: string; keys?: string[] } };
  tabInput?: { workspaceId: string; cwd: string; label: string; env: Record<string, string> };
  worktreeInput?: {
    cwd: string;
    branch: string;
    base?: string;
    path?: string;
    label: string;
  };

  constructor(
    private readonly snapshots: HerdrSnapshot[],
    private readonly outcome: PersistentLaunchOutcome,
    private readonly promptError?: Error,
    private readonly createdWorktree?: {
      workspaceId: string;
      tabId: string;
      paneId: string;
      path: string;
      branch: string;
    },
    private readonly worktreeGate?: { entered: () => void; wait: Promise<void> },
  ) {}

  async snapshot(): Promise<HerdrSnapshot> {
    this.calls.push("snapshot");
    const snapshot = this.snapshots.shift();
    if (!snapshot) throw new Error("missing fake snapshot");
    return structuredClone(snapshot);
  }

  async launchPersistent(input: PersistentLaunchInput): Promise<PersistentLaunchOutcome> {
    this.calls.push("launch");
    this.launchInput = structuredClone(input);
    return structuredClone(this.outcome);
  }

  async promptAgent(
    target: string,
    text: string,
    until?: Array<"idle" | "working" | "blocked" | "done">,
    timeoutMs?: number,
  ): Promise<HerdrAgentView> {
    this.calls.push("prompt");
    this.prompt = {
      target,
      text,
      ...(until ? { until } : {}),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    };
    const promptContract = this.launchInput?.argv.at(-1);
    this.promptContractPresent = Boolean(promptContract && existsSync(promptContract));
    if (this.promptError) throw this.promptError;
    return {
      paneId: "w1:p2",
      terminalId: "term_helper",
      agentStatus: "working",
      interactiveReady: true,
      launchPending: false,
    };
  }

  async sendPaneInput(paneId: string, input: { text?: string; keys?: string[] }): Promise<void> {
    this.calls.push("send-enter");
    this.paneInput = { paneId, input: structuredClone(input) };
  }

  async waitAgentStatus(): Promise<void> {
    this.calls.push("wait-working");
  }

  async createTab(input: {
    workspaceId: string;
    cwd: string;
    label: string;
    env: Record<string, string>;
  }): Promise<{ workspaceId: string; tabId: string; paneId: string }> {
    this.calls.push("tab");
    this.tabInput = structuredClone(input);
    return { workspaceId: "w2", tabId: "w2:t2", paneId: "w2:p2" };
  }

  async createWorktree(input: {
    cwd: string;
    branch: string;
    base?: string;
    path?: string;
    label: string;
  }) {
    this.calls.push("worktree");
    this.worktreeInput = structuredClone(input);
    this.worktreeGate?.entered();
    if (this.worktreeGate) await this.worktreeGate.wait;
    if (!this.createdWorktree) throw new Error("unexpected worktree creation");
    return structuredClone(this.createdWorktree);
  }
}

function snapshot(options: { helper?: boolean; workstreamLabel?: string } = {}): HerdrSnapshot {
  const panes = [{ pane_id: "w1:p1", workspace_id: "w1", tab_id: "w1:t1", label: "parent" }];
  const layoutPanes = [
    { pane_id: "w1:p1", rect: { x: 0, y: 0, width: options.helper ? 100 : 201, height: 50 } },
  ];
  if (options.helper) {
    panes.push({ pane_id: "w1:p2", workspace_id: "w1", tab_id: "w1:t1", label: "reviewer" });
    layoutPanes.push({ pane_id: "w1:p2", rect: { x: 101, y: 0, width: 100, height: 50 } });
  }
  return {
    version: "0.8.0",
    protocol: 19,
    focusedWorkspaceId: "w1",
    focusedTabId: "w1:t1",
    focusedPaneId: "w1:p1",
    workspaces: [{ workspace_id: "w1", label: "repo" }],
    tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: options.workstreamLabel ?? "auth" }],
    panes,
    layouts: [
      {
        tab_id: "w1:t1",
        area: { width: 201, height: 50 },
        panes: layoutPanes,
      },
    ],
    agents: [],
  };
}

function managedCheckouts(
  t: { after: (cleanup: () => void) => void },
  prefix: string,
): { source: string; target: string } {
  const temporary = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const source = join(temporary, "source");
  const target = join(temporary, "target");
  for (const path of [source, target]) {
    mkdirSync(path);
    execFileSync("git", ["init", "-q", path]);
  }
  return { source, target: realpathSync(target) };
}

function managedLaunch(cwd: string, workstreamLabel = "auth-fix") {
  return compilePersistentHelperLaunch({
    workstreamLabel,
    roleLabel: "writer",
    cwd,
    objective: "Fix auth expiry.",
    scope: {
      access: "write",
      allowedFiles: ["src/auth/**"],
      userApproval: { confirmed: true },
    },
    returnChannel: {
      taskId: "auth-fix",
      parentPaneId: "w1:p1",
      durableResult: "commit",
    },
    reuse: { kind: "retire-after-integration" },
    descendantResponsibilities: "Do not launch descendants.",
  });
}

function targetLaunchAfter(before: HerdrSnapshot, workspaceId = "w2"): HerdrSnapshot {
  const after = snapshot();
  after.workspaces = before.workspaces;
  after.tabs = [
    ...(after.tabs as object[]),
    { tab_id: `${workspaceId}:t2`, workspace_id: workspaceId, label: "auth-fix" },
  ];
  after.panes = [
    ...(after.panes as object[]),
    {
      pane_id: `${workspaceId}:p2`,
      workspace_id: workspaceId,
      tab_id: `${workspaceId}:t2`,
      label: "writer",
    },
  ];
  after.layouts = [
    ...(after.layouts as object[]),
    {
      workspace_id: workspaceId,
      tab_id: `${workspaceId}:t2`,
      panes: [{ pane_id: `${workspaceId}:p2`, rect: { width: 120, height: 40 } }],
    },
  ];
  return after;
}

test("helper directory survives reload and persists removal", (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "pi-herdr-helper-bindings-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const path = join(temporary, "bindings.json");

  const first = new HelperDirectory({ path });
  first.bind("helper-reviewer", "w1:p2", "term_helper", {
    workspaceId: "w2",
    path: "/repo-worktrees/review",
    branch: "review/auth",
  });

  const reloaded = new HelperDirectory({ path });
  assert.deepEqual(reloaded.resolve("helper-reviewer"), {
    alias: "helper-reviewer",
    paneId: "w1:p2",
    terminalId: "term_helper",
    workflowOwned: true,
    managedWorktree: {
      workspaceId: "w2",
      path: "/repo-worktrees/review",
      branch: "review/auth",
    },
  });
  assert.equal(statSync(path).mode & 0o777, 0o600);

  reloaded.remove("helper-reviewer");
  assert.equal(new HelperDirectory({ path }).resolve("helper-reviewer"), undefined);
});

test("helper directory switches session stores without leaking ownership", (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "pi-herdr-helper-sessions-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const firstSession = join(temporary, "first.jsonl");
  const secondSession = join(temporary, "second.jsonl");
  const directory = new HelperDirectory();

  assert.equal(helperBindingStorePath(firstSession), `${firstSession}.pi-loom-bindings.json`);

  directory.attach(helperBindingStorePath(firstSession));
  directory.bind("helper-reviewer", "w1:p2", "term_helper");
  directory.attach(helperBindingStorePath(secondSession));
  assert.equal(directory.resolve("helper-reviewer"), undefined);

  directory.attach(helperBindingStorePath(firstSession));
  assert.equal(directory.resolve("helper-reviewer")?.terminalId, "term_helper");
});

test("helper directory keeps memory unchanged when persistence fails", (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "pi-herdr-helper-write-failure-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const directory = new HelperDirectory({ path: join(temporary, "missing", "bindings.json") });

  assert.throws(() => directory.bind("helper-reviewer", "w1:p2", "term_helper"), /ENOENT/);
  assert.equal(directory.resolve("helper-reviewer"), undefined);
});

test("helper directory retains ownership when removal persistence fails", (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "pi-herdr-helper-remove-failure-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const path = join(temporary, "bindings.json");
  const directory = new HelperDirectory({ path });
  directory.bind("helper-reviewer", "w1:p2", "term_helper");
  rmSync(path);
  mkdirSync(path);

  assert.throws(() => directory.remove("helper-reviewer"));
  assert.equal(directory.resolve("helper-reviewer")?.terminalId, "term_helper");
});

test("launch executor plans, launches, prompts, and verifies one same-workstream helper", async () => {
  const herdr = new FakeHerdr(
    [snapshot(), snapshot({ helper: true, workstreamLabel: "auth-expiry" })],
    {
      kind: "started",
      paneId: "w1:p2",
      terminalId: "term_helper",
      agentStatus: "idle",
    },
  );
  const directory = new HelperDirectory();
  const executor = new SkillLaunchExecutor({
    herdr,
    directory,
    executionEnv: { PATH: "/node24/bin:/usr/bin" },
  });
  const launch = compilePersistentHelperLaunch({
    workstreamLabel: "auth-expiry",
    expectedWorkstreamLabel: "auth",
    roleLabel: "reviewer",
    cwd: "/repo",
    model: "openai/gpt-5.6",
    thinking: "high",
    objective: "Review auth expiry boundaries.",
    scope: { access: "read-only", allowedFiles: ["src/auth/**"] },
    returnChannel: {
      taskId: "auth-review",
      parentPaneId: "w1:p1",
      durableResult: "docs/auth-review.md",
    },
    reuse: { kind: "retire-after-integration" },
    descendantResponsibilities: "Do not launch descendants.",
  });

  const result = await executor.execute({
    helperAlias: "helper-reviewer",
    callerPaneId: "w1:p1",
    launch,
  });

  assert.deepEqual(result, {
    kind: "started",
    helperAlias: "helper-reviewer",
    agentStatus: "working",
    placement: { kind: "sibling", split: "right", size: "100x50", focusPreserved: true },
    configuration: { model: "openai/gpt-5.6", thinking: "high" },
    presentation: { workstreamLabel: "auth-expiry", roleLabel: "reviewer" },
  });
  assert.deepEqual(herdr.calls, ["snapshot", "launch", "prompt", "snapshot"]);
  const promptFile = herdr.launchInput?.argv.at(-1);
  if (!promptFile) assert.fail("missing prompt contract path");
  assert.ok(promptFile.endsWith("/contract.md"));
  assert.equal(existsSync(promptFile), false);
  assert.ok(
    herdr.launchInput?.argv.every(
      (argument) => argument.length <= 1_000 && !argument.includes("\n"),
    ),
  );
  assert.deepEqual(herdr.launchInput, {
    name: "helper-reviewer",
    argv: [
      "pi",
      "--tools",
      "read,grep,find,ls,loom_report,loom_close,loom_status",
      "--model",
      "openai/gpt-5.6",
      "--thinking",
      "high",
      "--append-system-prompt",
      promptFile,
    ],
    cwd: "/repo",
    targetPaneId: "w1:p1",
    target: { kind: "split", paneId: "w1:p1", direction: "right" },
    split: "right",
    roleLabel: "reviewer",
    workstreamLabel: "auth-expiry",
    env: {
      PATH: "/node24/bin:/usr/bin",
      PI_HERDR_TASK_ID: "auth-review",
      PI_HERDR_PARENT_PANE_ID: "w1:p1",
      PI_HERDR_CHILD_LABEL: "reviewer",
      PI_HERDR_WORKSTREAM_LABEL: "auth-expiry",
    },
  });
  assert.equal(herdr.prompt?.target, "helper-reviewer");
  assert.equal(herdr.prompt?.until?.join(","), "working");
  assert.equal(herdr.prompt?.timeoutMs, 60_000);
  assert.equal(herdr.promptContractPresent, true);
  assert.notEqual(herdr.prompt?.text, launch.initialPrompt);
  assert.ok((herdr.prompt?.text.length ?? Infinity) <= 1_000);
  assert.ok((herdr.prompt?.text.split("\n").length ?? Infinity) <= 10);
  assert.equal(directory.resolve("helper-reviewer")?.paneId, "w1:p2");
  assert.equal(directory.resolve("helper-reviewer")?.terminalId, "term_helper");
  assert.doesNotMatch(JSON.stringify(result), /w1:p2|w1:p1/);
});

test("launch executor opens a tab only in the exact target checkout workspace", async (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "pi-herdr-checkout-placement-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const callerCheckout = join(temporary, "caller");
  const targetCheckout = join(temporary, "target");
  for (const path of [callerCheckout, targetCheckout]) {
    mkdirSync(path);
    execFileSync("git", ["init", "-q", path]);
  }
  const target = realpathSync(targetCheckout);
  const before = snapshot();
  before.workspaces = [
    { workspace_id: "w1", worktree: { checkout_path: realpathSync(callerCheckout) } },
    { workspace_id: "w2", worktree: { checkout_path: target } },
  ];
  const after = snapshot();
  after.workspaces = before.workspaces;
  after.tabs = [
    ...(after.tabs as object[]),
    { tab_id: "w2:t2", workspace_id: "w2", label: "target-review" },
  ];
  after.panes = [
    ...(after.panes as object[]),
    {
      pane_id: "w2:p2",
      workspace_id: "w2",
      tab_id: "w2:t2",
      label: "reviewer",
      terminal_id: "term_helper",
      agent_status: "working",
    },
  ];
  after.layouts = [
    ...(after.layouts as object[]),
    {
      workspace_id: "w2",
      tab_id: "w2:t2",
      panes: [{ pane_id: "w2:p2", rect: { width: 120, height: 40 } }],
    },
  ];
  const herdr = new FakeHerdr([before, after], {
    kind: "started",
    paneId: "w2:p2",
    terminalId: "term_helper",
    agentStatus: "idle",
  });
  const directory = new HelperDirectory();
  const executor = new SkillLaunchExecutor({ herdr, directory });
  const launch = compilePersistentHelperLaunch({
    workstreamLabel: "target-review",
    roleLabel: "reviewer",
    cwd: target,
    objective: "Review target checkout.",
    scope: { access: "read-only", allowedFiles: ["src/**"] },
    returnChannel: {
      taskId: "target-review",
      parentPaneId: "w1:p1",
      durableResult: "child transcript",
    },
    reuse: { kind: "retire-after-integration" },
    descendantResponsibilities: "Do not launch descendants.",
  });

  const result = await executor.execute({
    helperAlias: "target-reviewer",
    callerPaneId: "w1:p1",
    callerCwd: callerCheckout,
    launch,
  });

  assert.equal(result.kind, "started");
  assert.deepEqual(herdr.calls, ["snapshot", "tab", "launch", "prompt", "snapshot"]);
  assert.equal(herdr.tabInput?.workspaceId, "w2");
  assert.equal(herdr.tabInput?.cwd, target);
  assert.deepEqual((herdr.launchInput as any).target, {
    kind: "existing",
    paneId: "w2:p2",
    tabId: "w2:t2",
  });
});

test("launch executor recognizes an ordinary workspace by pane cwd", async (t) => {
  const { source, target } = managedCheckouts(t, "pi-herdr-ordinary-workspace-");
  const before = snapshot();
  before.workspaces = [
    { workspace_id: "w1", worktree: { checkout_path: realpathSync(source) } },
    { workspace_id: "w2" },
  ];
  before.panes = [
    ...(before.panes as object[]),
    { pane_id: "w2:p1", workspace_id: "w2", tab_id: "w2:t1", cwd: target },
    { pane_id: "w2:p2", workspace_id: "w2", tab_id: "w2:t1" },
    {
      pane_id: "w2:p3",
      workspace_id: "w2",
      tab_id: "w2:t1",
      cwd: join(dirname(target), "missing"),
    },
  ];
  const herdr = new FakeHerdr([before, targetLaunchAfter(before)], {
    kind: "started",
    paneId: "w2:p2",
    terminalId: "term_helper",
    agentStatus: "idle",
  });
  const executor = new SkillLaunchExecutor({ herdr, directory: new HelperDirectory() });

  const result = await executor.execute({
    helperAlias: "target-writer",
    callerPaneId: "w1:p1",
    callerCwd: source,
    launch: managedLaunch(target),
  });

  assert.deepEqual(
    result.kind === "rejected" ? { kind: result.kind, code: result.code } : { kind: result.kind },
    { kind: "started" },
  );
  assert.equal(herdr.tabInput?.workspaceId, "w2");
});

test("launch executor canonicalizes an ordinary workspace pane subdirectory", async (t) => {
  const { source, target } = managedCheckouts(t, "pi-herdr-ordinary-subdirectory-");
  const nested = join(target, "nested");
  mkdirSync(nested);
  const before = snapshot();
  before.workspaces = [
    { workspace_id: "w1", worktree: { checkout_path: realpathSync(source) } },
    { workspace_id: "w2" },
  ];
  before.panes = [
    ...(before.panes as object[]),
    {
      pane_id: "w2:p1",
      workspace_id: "w2",
      tab_id: "w2:t1",
      foreground_cwd: nested,
      cwd: source,
    },
  ];
  const herdr = new FakeHerdr([before, targetLaunchAfter(before)], {
    kind: "started",
    paneId: "w2:p2",
    terminalId: "term_helper",
    agentStatus: "idle",
  });
  const executor = new SkillLaunchExecutor({ herdr, directory: new HelperDirectory() });

  const result = await executor.execute({
    helperAlias: "nested-writer",
    callerPaneId: "w1:p1",
    callerCwd: source,
    launch: managedLaunch(target),
  });

  assert.equal(result.kind, "started");
  assert.equal(herdr.tabInput?.workspaceId, "w2");
});

test("launch executor rejects an ordinary workspace spanning multiple checkouts", async (t) => {
  const { source, target } = managedCheckouts(t, "pi-herdr-mixed-workspace-");
  const foreign = join(dirname(target), "foreign");
  mkdirSync(foreign);
  execFileSync("git", ["init", "-q", foreign]);
  const before = snapshot();
  before.workspaces = [
    { workspace_id: "w1", worktree: { checkout_path: realpathSync(source) } },
    { workspace_id: "w2" },
  ];
  before.panes = [
    ...(before.panes as object[]),
    { pane_id: "w2:p1", workspace_id: "w2", tab_id: "w2:t1", cwd: target },
    { pane_id: "w2:p2", workspace_id: "w2", tab_id: "w2:t1", cwd: foreign },
  ];
  const herdr = new FakeHerdr([before], { kind: "failed", reason: "must not launch" });
  const executor = new SkillLaunchExecutor({ herdr, directory: new HelperDirectory() });

  const result = await executor.execute({
    helperAlias: "target-writer",
    callerPaneId: "w1:p1",
    callerCwd: source,
    launch: managedLaunch(target),
  });

  assert.equal(result.kind, "rejected");
  if (result.kind !== "rejected") assert.fail("expected rejection");
  assert.equal(result.code, "CHECKOUT_WORKSPACE_REQUIRED");
  assert.deepEqual(herdr.calls, ["snapshot"]);
});

test("launch executor rejects multiple ordinary workspaces for the target checkout", async (t) => {
  const { source, target } = managedCheckouts(t, "pi-herdr-duplicate-workspaces-");
  const before = snapshot();
  before.workspaces = [
    { workspace_id: "w1", worktree: { checkout_path: realpathSync(source) } },
    { workspace_id: "w2" },
    { workspace_id: "w3" },
  ];
  before.panes = [
    ...(before.panes as object[]),
    { pane_id: "w2:p1", workspace_id: "w2", tab_id: "w2:t1", cwd: target },
    { pane_id: "w3:p1", workspace_id: "w3", tab_id: "w3:t1", cwd: target },
  ];
  const herdr = new FakeHerdr([before], { kind: "failed", reason: "must not launch" });
  const executor = new SkillLaunchExecutor({ herdr, directory: new HelperDirectory() });

  const result = await executor.execute({
    helperAlias: "target-writer",
    callerPaneId: "w1:p1",
    callerCwd: source,
    launch: managedLaunch(target),
  });

  assert.equal(result.kind, "rejected");
  if (result.kind !== "rejected") assert.fail("expected rejection");
  assert.equal(result.code, "CHECKOUT_WORKSPACE_REQUIRED");
  assert.deepEqual(herdr.calls, ["snapshot"]);
});

test("launch executor prefers explicit workspace checkout identity over conflicting pane cwd", async (t) => {
  const { source, target } = managedCheckouts(t, "pi-herdr-explicit-workspace-");
  const foreign = join(dirname(target), "foreign");
  mkdirSync(foreign);
  execFileSync("git", ["init", "-q", foreign]);
  const before = snapshot();
  before.workspaces = [
    { workspace_id: "w1", worktree: { checkout_path: realpathSync(source) } },
    { workspace_id: "w2", worktree: { checkout_path: target } },
  ];
  before.panes = [
    ...(before.panes as object[]),
    { pane_id: "w2:p1", workspace_id: "w2", tab_id: "w2:t1", cwd: foreign },
  ];
  const herdr = new FakeHerdr([before, targetLaunchAfter(before)], {
    kind: "started",
    paneId: "w2:p2",
    terminalId: "term_helper",
    agentStatus: "idle",
  });
  const executor = new SkillLaunchExecutor({ herdr, directory: new HelperDirectory() });

  const result = await executor.execute({
    helperAlias: "target-writer",
    callerPaneId: "w1:p1",
    callerCwd: source,
    launch: managedLaunch(target),
  });

  assert.equal(result.kind, "started");
  assert.equal(herdr.tabInput?.workspaceId, "w2");
});

test("launch executor creates a managed worktree and uses its root pane", async (t) => {
  const { source, target } = managedCheckouts(t, "pi-herdr-managed-worktree-");
  const before = snapshot();
  before.workspaces = [{ workspace_id: "w1", worktree: { checkout_path: realpathSync(source) } }];
  const after = snapshot();
  after.workspaces = [
    ...before.workspaces,
    { workspace_id: "w2", worktree: { checkout_path: target } },
  ];
  after.tabs = [
    ...(after.tabs as object[]),
    { tab_id: "w2:t1", workspace_id: "w2", label: "auth-fix" },
  ];
  after.panes = [
    ...(after.panes as object[]),
    { pane_id: "w2:p1", workspace_id: "w2", tab_id: "w2:t1", label: "writer" },
  ];
  after.layouts = [
    ...(after.layouts as object[]),
    {
      workspace_id: "w2",
      tab_id: "w2:t1",
      panes: [{ pane_id: "w2:p1", rect: { width: 120, height: 40 } }],
    },
  ];
  const herdr = new FakeHerdr(
    [before, after],
    {
      kind: "started",
      paneId: "w2:p1",
      terminalId: "term_helper",
      agentStatus: "idle",
    },
    undefined,
    {
      workspaceId: "w2",
      tabId: "w2:t1",
      paneId: "w2:p1",
      path: target,
      branch: "fix/auth-expiry",
    },
  );
  const directory = new HelperDirectory();
  const executor = new SkillLaunchExecutor({ herdr, directory });
  const launch = managedLaunch(source);

  const result = await executor.execute({
    helperAlias: "auth-writer",
    callerPaneId: "w1:p1",
    callerCwd: source,
    launch,
    worktree: { branch: "fix/auth-expiry", base: "origin/main" },
  });

  assert.equal(result.kind, "started");
  if (result.kind !== "started") assert.fail("expected launch to start");
  assert.deepEqual(result.placement, {
    kind: "worktree",
    path: target,
    branch: "fix/auth-expiry",
    size: "120x40",
    focusPreserved: true,
  });
  assert.deepEqual(herdr.calls, ["snapshot", "worktree", "launch", "prompt", "snapshot"]);
  assert.deepEqual(herdr.worktreeInput, {
    cwd: source,
    branch: "fix/auth-expiry",
    base: "origin/main",
    label: "auth-fix",
  });
  assert.equal(herdr.launchInput?.cwd, target);
  assert.deepEqual(herdr.launchInput?.target, {
    kind: "existing",
    paneId: "w2:p1",
    tabId: "w2:t1",
  });
  assert.equal(herdr.tabInput, undefined);
  assert.deepEqual(directory.resolve("auth-writer")?.managedWorktree, {
    workspaceId: "w2",
    path: target,
    branch: "fix/auth-expiry",
  });
});

test("unconfirmed managed worktree creation stops launch for reconciliation", async () => {
  const herdr = new FakeHerdr([snapshot()], {
    kind: "failed",
    reason: "must not launch",
  });
  const executor = new SkillLaunchExecutor({ herdr, directory: new HelperDirectory() });
  const launch = managedLaunch("/repo");

  const result = await executor.execute({
    helperAlias: "auth-writer",
    callerPaneId: "w1:p1",
    callerCwd: "/repo",
    launch,
    worktree: { branch: "fix/auth-expiry" },
  });

  assert.deepEqual(result, {
    kind: "reconcile",
    helperAlias: "auth-writer",
    reason: "managed worktree creation is unconfirmed: unexpected worktree creation",
  });
  assert.deepEqual(herdr.calls, ["snapshot", "worktree"]);
});

test("blank managed worktree label is rejected before creation", async () => {
  const herdr = new FakeHerdr([snapshot()], {
    kind: "failed",
    reason: "must not launch",
  });
  const executor = new SkillLaunchExecutor({ herdr, directory: new HelperDirectory() });
  const launch = managedLaunch("/repo", "   ");

  const result = await executor.execute({
    helperAlias: "auth-writer",
    callerPaneId: "w1:p1",
    callerCwd: "/repo",
    launch,
    worktree: { branch: "fix/auth-expiry" },
  });

  assert.deepEqual(result, {
    kind: "rejected",
    helperAlias: "auth-writer",
    code: "WORKSTREAM_LABEL_REQUIRED",
    reason: "managed worktree requires an explicit workstream label",
  });
  assert.deepEqual(herdr.calls, ["snapshot"]);
});

test("bound helper alias rejects a managed worktree before creation", async () => {
  const herdr = new FakeHerdr([snapshot()], {
    kind: "failed",
    reason: "must not launch",
  });
  const directory = new HelperDirectory();
  directory.bind("auth-writer", "w1:p9", "term_existing");
  const executor = new SkillLaunchExecutor({ herdr, directory });
  const launch = managedLaunch("/repo");

  const result = await executor.execute({
    helperAlias: "auth-writer",
    callerPaneId: "w1:p1",
    callerCwd: "/repo",
    launch,
    worktree: { branch: "fix/auth-expiry" },
  });

  assert.deepEqual(result, {
    kind: "rejected",
    helperAlias: "auth-writer",
    code: "HELPER_ALREADY_BOUND",
    reason: "helper alias auth-writer is already bound",
  });
  assert.deepEqual(herdr.calls, []);
});

test("managed launch reserves its alias against a concurrent current launch", async (t) => {
  const { source, target } = managedCheckouts(t, "pi-herdr-managed-concurrent-alias-");
  let entered!: () => void;
  const worktreeEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const herdr = new FakeHerdr(
    [snapshot(), snapshot()],
    { kind: "failed", reason: "agent start rejected" },
    undefined,
    {
      workspaceId: "w2",
      tabId: "w2:t1",
      paneId: "w2:p1",
      path: target,
      branch: "fix/auth-expiry",
    },
    { entered, wait },
  );
  const executor = new SkillLaunchExecutor({ herdr, directory: new HelperDirectory() });
  const input = {
    helperAlias: "auth-writer",
    callerPaneId: "w1:p1",
    callerCwd: source,
    launch: managedLaunch(source),
    worktree: { branch: "fix/auth-expiry" },
  };

  const first = executor.execute(input);
  await worktreeEntered;
  const second = executor.execute({
    helperAlias: input.helperAlias,
    callerPaneId: input.callerPaneId,
    callerCwd: input.callerCwd,
    launch: input.launch,
  });
  await Promise.resolve();
  release();
  const [, secondResult] = await Promise.all([first, second]);

  assert.deepEqual(secondResult, {
    kind: "rejected",
    helperAlias: "auth-writer",
    code: "HELPER_ALREADY_BOUND",
    reason: "helper alias auth-writer is already bound",
  });
  assert.equal(herdr.calls.filter((call) => call === "worktree").length, 1);
});

test("lease persistence failure keeps managed worktree identity in memory", async (t) => {
  const { source, target } = managedCheckouts(t, "pi-herdr-managed-persist-failure-");
  const bindingPath = join(dirname(source), "bindings.json");
  const directory = new HelperDirectory({ path: bindingPath });
  mkdirSync(bindingPath);
  const herdr = new FakeHerdr(
    [snapshot()],
    { kind: "failed", reason: "must not launch" },
    undefined,
    {
      workspaceId: "w2",
      tabId: "w2:t1",
      paneId: "w2:p1",
      path: target,
      branch: "fix/auth-expiry",
    },
  );
  const executor = new SkillLaunchExecutor({ herdr, directory });

  const result = await executor.execute({
    helperAlias: "auth-writer",
    callerPaneId: "w1:p1",
    callerCwd: source,
    launch: managedLaunch(source),
    worktree: { branch: "fix/auth-expiry" },
  });

  assert.equal(result.kind, "reconcile");
  if (result.kind !== "reconcile") assert.fail("expected reconciliation");
  assert.match(result.reason, /^managed worktree exists but lease persistence failed:/);
  assert.deepEqual(directory.resolve("auth-writer")?.managedWorktree, {
    workspaceId: "w2",
    path: target,
    branch: "fix/auth-expiry",
  });
  assert.deepEqual(herdr.calls, ["snapshot", "worktree"]);
});

test("failed launch retains a confirmed managed worktree for reconciliation", async (t) => {
  const { source, target } = managedCheckouts(t, "pi-herdr-managed-launch-failure-");
  const bindingPath = join(dirname(source), "bindings.json");
  const herdr = new FakeHerdr(
    [snapshot()],
    { kind: "failed", reason: "agent start rejected" },
    undefined,
    {
      workspaceId: "w2",
      tabId: "w2:t1",
      paneId: "w2:p1",
      path: target,
      branch: "fix/auth-expiry",
    },
  );
  const executor = new SkillLaunchExecutor({
    herdr,
    directory: new HelperDirectory({ path: bindingPath }),
  });
  const launch = managedLaunch(source);

  const result = await executor.execute({
    helperAlias: "auth-writer",
    callerPaneId: "w1:p1",
    callerCwd: source,
    launch,
    worktree: { branch: "fix/auth-expiry" },
  });

  assert.deepEqual(result, {
    kind: "reconcile",
    helperAlias: "auth-writer",
    reason: "managed worktree exists but helper launch failed: agent start rejected",
  });
  assert.deepEqual(herdr.calls, ["snapshot", "worktree", "launch"]);
  assert.deepEqual(new HelperDirectory({ path: bindingPath }).resolve("auth-writer"), {
    alias: "auth-writer",
    paneId: "w2:p1",
    workflowOwned: true,
    managedWorktree: {
      workspaceId: "w2",
      path: target,
      branch: "fix/auth-expiry",
    },
  });
});

test("launch executor rejects a foreign checkout before mutation when no workspace matches", async (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "pi-herdr-missing-checkout-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const callerCheckout = join(temporary, "caller");
  const targetCheckout = join(temporary, "target");
  for (const path of [callerCheckout, targetCheckout]) {
    mkdirSync(path);
    execFileSync("git", ["init", "-q", path]);
  }
  const before = snapshot();
  before.workspaces = [
    {
      workspace_id: "w1",
      worktree: { checkout_path: realpathSync(callerCheckout) },
    },
  ];
  const herdr = new FakeHerdr([before], { kind: "failed", reason: "must not launch" });
  const executor = new SkillLaunchExecutor({ herdr, directory: new HelperDirectory() });
  const launch = compilePersistentHelperLaunch({
    workstreamLabel: "target-review",
    roleLabel: "reviewer",
    cwd: targetCheckout,
    objective: "Review target checkout.",
    scope: { access: "read-only", allowedFiles: ["src/**"] },
    returnChannel: {
      taskId: "target-review",
      parentPaneId: "w1:p1",
      durableResult: "child transcript",
    },
    reuse: { kind: "retire-after-integration" },
    descendantResponsibilities: "Do not launch descendants.",
  });

  const result = await executor.execute({
    helperAlias: "target-reviewer",
    callerPaneId: "w1:p1",
    callerCwd: callerCheckout,
    launch,
  });

  assert.equal(result.kind, "rejected");
  if (result.kind !== "rejected") assert.fail("expected rejection");
  assert.equal(result.code, "CHECKOUT_WORKSPACE_REQUIRED");
  assert.deepEqual(herdr.calls, ["snapshot"]);
});

test("launch executor accepts a narrow independent-workstream tab in the same checkout", async (t) => {
  const checkout = mkdtempSync(join(tmpdir(), "pi-herdr-same-checkout-tab-"));
  t.after(() => rmSync(checkout, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", checkout]);
  const root = realpathSync(checkout);
  const before = snapshot();
  before.workspaces = [{ workspace_id: "w1", worktree: { checkout_path: root } }];
  const after = snapshot();
  after.workspaces = before.workspaces;
  after.tabs = [
    ...(after.tabs as object[]),
    { tab_id: "w2:t2", workspace_id: "w2", label: "independent-review" },
  ];
  after.panes = [
    ...(after.panes as object[]),
    { pane_id: "w2:p2", workspace_id: "w2", tab_id: "w2:t2", label: "reviewer" },
  ];
  after.layouts = [
    ...(after.layouts as object[]),
    {
      workspace_id: "w2",
      tab_id: "w2:t2",
      panes: [{ pane_id: "w2:p2", rect: { width: 61, height: 25 } }],
    },
  ];
  const herdr = new FakeHerdr([before, after], {
    kind: "started",
    paneId: "w2:p2",
    terminalId: "term_helper",
    agentStatus: "idle",
  });
  const executor = new SkillLaunchExecutor({ herdr, directory: new HelperDirectory() });
  const launch = compilePersistentHelperLaunch({
    workstreamLabel: "independent-review",
    roleLabel: "reviewer",
    cwd: root,
    objective: "Review independently.",
    scope: { access: "read-only", allowedFiles: ["src/**"] },
    returnChannel: {
      taskId: "independent-review",
      parentPaneId: "w1:p1",
      durableResult: "child transcript",
    },
    reuse: { kind: "retire-after-integration" },
    descendantResponsibilities: "Do not launch descendants.",
  });

  const result = await executor.execute({
    helperAlias: "independent-reviewer",
    callerPaneId: "w1:p1",
    callerCwd: root,
    launch,
  });

  assert.equal(result.kind, "started");
  if (result.kind !== "started") assert.fail("expected launch to start");
  assert.equal(result.placement.size, "61x25");
  assert.equal(herdr.tabInput?.workspaceId, "w1");
  assert.equal((herdr.launchInput as any).target.kind, "existing");
});

test("launch executor completes a stalled startup submission without resending prompt text", async () => {
  const herdr = new FakeHerdr(
    [snapshot(), snapshot({ helper: true, workstreamLabel: "auth-expiry" })],
    {
      kind: "started",
      paneId: "w1:p2",
      terminalId: "term_helper",
      agentStatus: "idle",
    },
    new HerdrRpcError("agent_prompt_stalled", "prompt produced no observed state change"),
  );
  const executor = new SkillLaunchExecutor({ herdr, directory: new HelperDirectory() });
  const launch = compilePersistentHelperLaunch({
    workstreamLabel: "auth-expiry",
    expectedWorkstreamLabel: "auth",
    roleLabel: "reviewer",
    cwd: "/repo",
    objective: "Review auth expiry boundaries.",
    scope: { access: "read-only", allowedFiles: ["src/auth/**"] },
    returnChannel: {
      taskId: "auth-review",
      parentPaneId: "w1:p1",
      durableResult: "docs/auth-review.md",
    },
    reuse: { kind: "retire-after-integration" },
    descendantResponsibilities: "Do not launch descendants.",
  });

  const result = await executor.execute({
    helperAlias: "helper-reviewer",
    callerPaneId: "w1:p1",
    launch,
  });

  assert.equal(result.kind, "started");
  assert.deepEqual(herdr.calls, [
    "snapshot",
    "launch",
    "prompt",
    "send-enter",
    "wait-working",
    "snapshot",
  ]);
  assert.deepEqual(herdr.paneInput, { paneId: "w1:p2", input: { keys: ["enter"] } });
  const promptFile = herdr.launchInput?.argv.at(-1);
  if (!promptFile) assert.fail("missing prompt contract path");
  assert.equal(existsSync(promptFile), false);
});

test("launch executor rejects an unusable split before mutation", async () => {
  const before = snapshot();
  const layout = before.layouts[0] as { panes: Array<{ rect: { width: number; height: number } }> };
  layout.panes[0]!.rect = { width: 150, height: 30 };
  const herdr = new FakeHerdr([before], {
    kind: "started",
    paneId: "w1:p2",
    terminalId: "term_helper",
    agentStatus: "working",
  });
  const executor = new SkillLaunchExecutor({ herdr, directory: new HelperDirectory() });
  const launch = compilePersistentHelperLaunch({
    roleLabel: "reviewer",
    cwd: "/repo",
    objective: "Review auth.",
    scope: { access: "read-only", allowedFiles: ["src/auth/**"] },
    returnChannel: {
      taskId: "auth-review",
      parentPaneId: "w1:p1",
      durableResult: "docs/auth-review.md",
    },
    reuse: { kind: "retire-after-integration" },
    descendantResponsibilities: "Do not launch descendants.",
  });

  const result = await executor.execute({
    helperAlias: "helper-reviewer",
    callerPaneId: "w1:p1",
    launch,
  });

  assert.deepEqual(result, {
    kind: "rejected",
    helperAlias: "helper-reviewer",
    code: "UNUSABLE_LAYOUT",
    reason: "caller pane 150x30 cannot retain two 80x24 panes",
  });
  assert.deepEqual(herdr.calls, ["snapshot"]);
});

test("launch executor preserves a different clear user workstream label", async () => {
  const herdr = new FakeHerdr([snapshot()], {
    kind: "started",
    paneId: "w1:p2",
    terminalId: "term_helper",
    agentStatus: "working",
  });
  const executor = new SkillLaunchExecutor({ herdr, directory: new HelperDirectory() });
  const launch = compilePersistentHelperLaunch({
    workstreamLabel: "auth-expiry",
    roleLabel: "reviewer",
    cwd: "/repo",
    objective: "Review auth.",
    scope: { access: "read-only", allowedFiles: ["src/auth/**"] },
    returnChannel: {
      taskId: "auth-review",
      parentPaneId: "w1:p1",
      durableResult: "docs/auth-review.md",
    },
    reuse: { kind: "retire-after-integration" },
    descendantResponsibilities: "Do not launch descendants.",
  });

  const result = await executor.execute({
    helperAlias: "helper-reviewer",
    callerPaneId: "w1:p1",
    launch,
  });

  assert.deepEqual(result, {
    kind: "rejected",
    helperAlias: "helper-reviewer",
    code: "WORKSTREAM_LABEL_CONFLICT",
    reason: "requested workstream label conflicts with clear live label auth",
  });
  assert.deepEqual(herdr.calls, ["snapshot"]);
});

test("definite split failure rejects without a pre-split presentation mutation", async () => {
  const herdr = new FakeHerdr([snapshot()], { kind: "failed", reason: "split target disappeared" });
  const executor = new SkillLaunchExecutor({ herdr, directory: new HelperDirectory() });
  const launch = compilePersistentHelperLaunch({
    workstreamLabel: "auth-expiry",
    expectedWorkstreamLabel: "auth",
    roleLabel: "reviewer",
    cwd: "/repo",
    objective: "Review auth.",
    scope: { access: "read-only", allowedFiles: ["src/auth/**"] },
    returnChannel: {
      taskId: "auth-review",
      parentPaneId: "w1:p1",
      durableResult: "docs/auth-review.md",
    },
    reuse: { kind: "retire-after-integration" },
    descendantResponsibilities: "Do not launch descendants.",
  });

  const result = await executor.execute({
    helperAlias: "helper-reviewer",
    callerPaneId: "w1:p1",
    launch,
  });

  assert.deepEqual(result, {
    kind: "rejected",
    helperAlias: "helper-reviewer",
    code: "LAUNCH_FAILED",
    reason: "split target disappeared",
  });
  assert.deepEqual(herdr.calls, ["snapshot", "launch"]);
});

test("launch executor preserves an ambiguous launch for reconciliation without prompting", async () => {
  const herdr = new FakeHerdr([snapshot()], {
    kind: "ambiguous",
    reason: "socket closed after request write",
  });
  const directory = new HelperDirectory();
  const executor = new SkillLaunchExecutor({ herdr, directory });
  const launch = compilePersistentHelperLaunch({
    roleLabel: "reviewer",
    cwd: "/repo",
    objective: "Review auth.",
    scope: { access: "read-only", allowedFiles: ["src/auth/**"] },
    returnChannel: {
      taskId: "auth-review",
      parentPaneId: "w1:p1",
      durableResult: "docs/auth-review.md",
    },
    reuse: { kind: "retire-after-integration" },
    descendantResponsibilities: "Do not launch descendants.",
  });

  const result = await executor.execute({
    helperAlias: "helper-reviewer",
    callerPaneId: "w1:p1",
    launch,
  });

  assert.deepEqual(result, {
    kind: "reconcile",
    helperAlias: "helper-reviewer",
    reason: "socket closed after request write",
  });
  assert.deepEqual(herdr.calls, ["snapshot", "launch"]);
  assert.equal(directory.resolve("helper-reviewer"), undefined);
  const promptFile = herdr.launchInput?.argv.at(-1);
  if (!promptFile) assert.fail("missing prompt contract path");
  assert.ok(existsSync(promptFile));
  rmSync(dirname(promptFile), { recursive: true, force: true });
});

test("post-prompt verification failure returns reconcile", async () => {
  const herdr = new FakeHerdr([snapshot()], {
    kind: "started",
    paneId: "w1:p2",
    terminalId: "term_helper",
    agentStatus: "idle",
  });
  const executor = new SkillLaunchExecutor({ herdr, directory: new HelperDirectory() });
  const launch = compilePersistentHelperLaunch({
    roleLabel: "reviewer",
    cwd: "/repo",
    objective: "Review auth.",
    scope: { access: "read-only", allowedFiles: ["src/auth/**"] },
    returnChannel: {
      taskId: "auth-review",
      parentPaneId: "w1:p1",
      durableResult: "docs/auth-review.md",
    },
    reuse: { kind: "retire-after-integration" },
    descendantResponsibilities: "Do not launch descendants.",
  });

  const result = await executor.execute({
    helperAlias: "helper-reviewer",
    callerPaneId: "w1:p1",
    launch,
  });

  assert.deepEqual(result, {
    kind: "reconcile",
    helperAlias: "helper-reviewer",
    reason:
      "helper started and prompted but presentation verification failed: missing fake snapshot",
  });
});
