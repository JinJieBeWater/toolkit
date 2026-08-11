import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HerdrRpcError, type HerdrAgentView, type HerdrSnapshot } from "../src/herdr-adapter.ts";
import { HelperDirectory } from "../src/skill-launch-executor.ts";
import { SkillRetirementExecutor, type SkillRetirementHerdrPort } from "../src/skill-retirement.ts";

class FakeRetirementHerdr implements SkillRetirementHerdrPort {
  readonly calls: string[] = [];

  constructor(
    private readonly snapshots: HerdrSnapshot[],
    private readonly agents: HerdrAgentView[],
    private readonly readError?: Error,
    private readonly agentError?: Error,
    private readonly removeError?: Error,
  ) {}

  async getAgent(target: string): Promise<HerdrAgentView> {
    this.calls.push(`agent:${target}`);
    const value = this.agents.shift();
    if (!value) throw this.agentError ?? new Error("missing fake agent");
    return structuredClone(value);
  }

  async snapshot(): Promise<HerdrSnapshot> {
    this.calls.push("snapshot");
    const value = this.snapshots.shift();
    if (!value) throw new Error("missing fake snapshot");
    return structuredClone(value);
  }

  async readRecent(paneId: string): Promise<string> {
    this.calls.push(`read:${paneId}`);
    if (this.readError) throw this.readError;
    return "Structured report sent. Waiting for parent integration.";
  }

  async waitAgentSettled(paneId: string, _timeoutMs: number): Promise<void> {
    this.calls.push(`wait-settled:${paneId}`);
  }

  async closePane(paneId: string): Promise<void> {
    this.calls.push(`close:${paneId}`);
  }

  async removeWorktree(workspaceId: string, path: string): Promise<void> {
    this.calls.push(`remove:${workspaceId}:${path}`);
    if (this.removeError) throw this.removeError;
  }
}

function snapshot(present: boolean): HerdrSnapshot {
  return {
    version: "0.8.0",
    protocol: 19,
    focusedWorkspaceId: "w1",
    focusedTabId: "w1:t1",
    focusedPaneId: "w1:p1",
    workspaces: [{ workspace_id: "w1" }],
    tabs: [{ tab_id: "w1:t1", workspace_id: "w1" }],
    panes: present
      ? [
          { pane_id: "w1:p1", workspace_id: "w1", tab_id: "w1:t1" },
          { pane_id: "w1:p2", workspace_id: "w1", tab_id: "w1:t1" },
        ]
      : [{ pane_id: "w1:p1", workspace_id: "w1", tab_id: "w1:t1" }],
    layouts: [],
    agents: present ? [{ pane_id: "w1:p2", agent_status: "done", focused: false }] : [],
  };
}

function agent(agentStatus: "idle" | "working" | "blocked" | "done" = "done"): HerdrAgentView {
  return {
    paneId: "w1:p2",
    terminalId: "term_helper",
    agentStatus,
    interactiveReady: true,
    launchPending: false,
  };
}

function managedDirectory(): HelperDirectory {
  const directory = new HelperDirectory();
  directory.bind("auth-writer", "w2:p1", "term_helper", {
    workspaceId: "w2",
    path: "/repo-worktrees/auth",
    branch: "fix/auth-expiry",
  });
  return directory;
}

function managedSnapshot(otherPane = false): HerdrSnapshot {
  const value = snapshot(false);
  value.workspaces.push({
    workspace_id: "w2",
    worktree: { checkout_path: "/repo-worktrees/auth" },
  });
  value.tabs.push({ tab_id: "w2:t1", workspace_id: "w2" });
  value.panes.push({ pane_id: "w2:p1", workspace_id: "w2", tab_id: "w2:t1" });
  if (otherPane) {
    value.panes.push({ pane_id: "w2:p2", workspace_id: "w2", tab_id: "w2:t1" });
  }
  return value;
}

function managedAgent(agentStatus: "working" | "done" = "done"): HerdrAgentView {
  return { ...agent(agentStatus), paneId: "w2:p1" };
}

const semanticEvidence = {
  reportIntegrated: true,
  durableEvidence: true,
  pendingApproval: false,
  pendingUserInput: false,
  queuedFollowup: false,
  runningService: false,
  unresolvedBlocker: false,
  descendantsSettled: true,
  namedReuseRole: false,
};

test("retirement closes only an eligible workflow-owned leaf and verifies absence", async () => {
  const directory = new HelperDirectory();
  directory.bind("helper-reviewer", "w1:p2", "term_helper");
  const herdr = new FakeRetirementHerdr([snapshot(true), snapshot(false)], [agent()]);
  const executor = new SkillRetirementExecutor({ herdr, directory });

  const result = await executor.retire({
    helperAlias: "helper-reviewer",
    callerPaneId: "w1:p1",
    semanticEvidence,
    execute: true,
  });

  assert.deepEqual(result, {
    helperAlias: "helper-reviewer",
    action: "closed",
    reasons: [],
  });
  assert.deepEqual(herdr.calls, [
    "agent:helper-reviewer",
    "snapshot",
    "read:w1:p2",
    "close:w1:p2",
    "snapshot",
  ]);
  assert.equal(directory.resolve("helper-reviewer"), undefined);
  assert.doesNotMatch(JSON.stringify(result), /w1:p2|w1:p1/);
});

test("retirement removes an eligible managed worktree without force", async () => {
  const directory = managedDirectory();
  const herdr = new FakeRetirementHerdr([managedSnapshot(), snapshot(false)], [managedAgent()]);
  const executor = new SkillRetirementExecutor({ herdr, directory });

  const result = await executor.retire({
    helperAlias: "auth-writer",
    callerPaneId: "w1:p1",
    semanticEvidence,
    execute: true,
  });

  assert.deepEqual(result, {
    helperAlias: "auth-writer",
    action: "closed",
    reasons: [],
  });
  assert.deepEqual(herdr.calls, [
    "agent:auth-writer",
    "snapshot",
    "read:w2:p1",
    "remove:w2:/repo-worktrees/auth",
    "snapshot",
  ]);
  assert.equal(directory.resolve("auth-writer"), undefined);
});

test("retirement removes a reloaded pending managed worktree after launch failure", async (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "pi-loom-pending-worktree-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const path = join(temporary, "bindings.json");
  const pending = new HelperDirectory({ path });
  pending.reserveManagedWorktree("auth-writer", "w2:p1", {
    workspaceId: "w2",
    path: "/repo-worktrees/auth",
    branch: "fix/auth-expiry",
  });
  const directory = new HelperDirectory({ path });
  const herdr = new FakeRetirementHerdr(
    [managedSnapshot(), snapshot(false)],
    [],
    undefined,
    new HerdrRpcError("agent_not_found", "agent auth-writer not found"),
  );
  const executor = new SkillRetirementExecutor({ herdr, directory });

  const result = await executor.retire({
    helperAlias: "auth-writer",
    callerPaneId: "w1:p1",
    semanticEvidence: {
      ...semanticEvidence,
      reportIntegrated: false,
      durableEvidence: false,
    },
    execute: true,
  });

  assert.deepEqual(result, {
    helperAlias: "auth-writer",
    action: "closed",
    reasons: [],
  });
  assert.deepEqual(herdr.calls, [
    "agent:auth-writer",
    "snapshot",
    "remove:w2:/repo-worktrees/auth",
    "snapshot",
  ]);
  assert.equal(new HelperDirectory({ path }).resolve("auth-writer"), undefined);
});

test("retirement upgrades a pending lease when an ambiguous launch actually started", async () => {
  const directory = new HelperDirectory();
  directory.reserveManagedWorktree("auth-writer", "w2:p1", {
    workspaceId: "w2",
    path: "/repo-worktrees/auth",
    branch: "fix/auth-expiry",
  });
  const herdr = new FakeRetirementHerdr([managedSnapshot(), snapshot(false)], [managedAgent()]);
  const executor = new SkillRetirementExecutor({ herdr, directory });

  const result = await executor.retire({
    helperAlias: "auth-writer",
    callerPaneId: "w1:p1",
    semanticEvidence,
    execute: true,
  });

  assert.deepEqual(result, {
    helperAlias: "auth-writer",
    action: "closed",
    reasons: [],
  });
  assert.deepEqual(herdr.calls, [
    "agent:auth-writer",
    "snapshot",
    "read:w2:p1",
    "remove:w2:/repo-worktrees/auth",
    "snapshot",
  ]);
  assert.equal(directory.resolve("auth-writer"), undefined);
});

test("retirement preserves sticky retention when rebinding a live pending helper", async () => {
  const directory = new HelperDirectory();
  directory.reserveManagedWorktree(
    "auth-writer",
    "w2:p1",
    {
      workspaceId: "w2",
      path: "/repo-worktrees/auth",
      branch: "fix/auth-expiry",
    },
    "writer",
  );
  const herdr = new FakeRetirementHerdr([managedSnapshot()], [managedAgent()]);
  const executor = new SkillRetirementExecutor({ herdr, directory });

  const result = await executor.retire({
    helperAlias: "auth-writer",
    callerPaneId: "w1:p1",
    semanticEvidence: { ...semanticEvidence, reportIntegrated: false },
    execute: false,
  });

  assert.equal(result.action, "retain");
  assert.equal(directory.resolve("auth-writer")?.terminalId, "term_helper");
  assert.equal(directory.resolve("auth-writer")?.reuseRole, "writer");
});

test("retirement retains a managed worktree containing another pane", async () => {
  const directory = managedDirectory();
  const herdr = new FakeRetirementHerdr([managedSnapshot(true)], [managedAgent()]);
  const executor = new SkillRetirementExecutor({ herdr, directory });

  const result = await executor.retire({
    helperAlias: "auth-writer",
    callerPaneId: "w1:p1",
    semanticEvidence,
    execute: true,
  });

  assert.deepEqual(result, {
    helperAlias: "auth-writer",
    action: "retain",
    reasons: ["managed-worktree-has-other-panes"],
  });
  assert.deepEqual(herdr.calls, ["agent:auth-writer", "snapshot"]);
});

test("dirty managed worktree removal reconciles and keeps its binding", async () => {
  const directory = managedDirectory();
  const herdr = new FakeRetirementHerdr(
    [managedSnapshot()],
    [managedAgent()],
    undefined,
    undefined,
    new HerdrRpcError("worktree_dirty", "worktree contains uncommitted changes"),
  );
  const executor = new SkillRetirementExecutor({ herdr, directory });

  const result = await executor.retire({
    helperAlias: "auth-writer",
    callerPaneId: "w1:p1",
    semanticEvidence,
    execute: true,
  });

  assert.deepEqual(result, {
    helperAlias: "auth-writer",
    action: "reconcile",
    reasons: ["close-unconfirmed:worktree contains uncommitted changes"],
  });
  assert.deepEqual(herdr.calls, [
    "agent:auth-writer",
    "snapshot",
    "read:w2:p1",
    "remove:w2:/repo-worktrees/auth",
  ]);
  assert.notEqual(directory.resolve("auth-writer"), undefined);
});

test("idle alone remains retained when semantic evidence is incomplete", async () => {
  const directory = new HelperDirectory();
  directory.bind("helper-reviewer", "w1:p2", "term_helper");
  const herdr = new FakeRetirementHerdr([snapshot(true)], [agent("idle")]);
  const executor = new SkillRetirementExecutor({ herdr, directory });

  const result = await executor.retire({
    helperAlias: "helper-reviewer",
    callerPaneId: "w1:p1",
    semanticEvidence: { ...semanticEvidence, reportIntegrated: false },
    execute: false,
  });

  assert.deepEqual(result, {
    helperAlias: "helper-reviewer",
    action: "retain",
    reasons: ["report-not-integrated"],
  });
  assert.deepEqual(herdr.calls, ["agent:helper-reviewer", "snapshot", "read:w1:p2"]);
});

test("initial snapshot failure returns reconciliation", async () => {
  const directory = new HelperDirectory();
  directory.bind("helper-reviewer", "w1:p2", "term_helper");
  const herdr = new FakeRetirementHerdr([], [agent()]);
  const executor = new SkillRetirementExecutor({ herdr, directory });

  const result = await executor.retire({
    helperAlias: "helper-reviewer",
    callerPaneId: "w1:p1",
    semanticEvidence,
    execute: true,
  });

  assert.deepEqual(result, {
    helperAlias: "helper-reviewer",
    action: "reconcile",
    reasons: ["snapshot-unconfirmed:missing fake snapshot"],
  });
});

test("recent transcript failure returns reconciliation", async () => {
  const directory = new HelperDirectory();
  directory.bind("helper-reviewer", "w1:p2", "term_helper");
  const herdr = new FakeRetirementHerdr([snapshot(true)], [agent()], new Error("socket closed"));
  const executor = new SkillRetirementExecutor({ herdr, directory });

  const result = await executor.retire({
    helperAlias: "helper-reviewer",
    callerPaneId: "w1:p1",
    semanticEvidence,
    execute: true,
  });

  assert.deepEqual(result, {
    helperAlias: "helper-reviewer",
    action: "reconcile",
    reasons: ["recent-transcript-unconfirmed:socket closed"],
  });
});

test("integrated report waits server-side for the child final response before close", async () => {
  const directory = new HelperDirectory();
  directory.bind("helper-reviewer", "w1:p2", "term_helper");
  const working = snapshot(true);
  (working.agents[0] as { agent_status: string }).agent_status = "working";
  const herdr = new FakeRetirementHerdr(
    [working, snapshot(true), snapshot(false)],
    [agent("working"), agent("done")],
  );
  const executor = new SkillRetirementExecutor({ herdr, directory });

  const result = await executor.retire({
    helperAlias: "helper-reviewer",
    callerPaneId: "w1:p1",
    semanticEvidence,
    execute: true,
  });

  assert.equal(result.action, "closed");
  assert.deepEqual(herdr.calls, [
    "agent:helper-reviewer",
    "snapshot",
    "wait-settled:helper-reviewer",
    "agent:helper-reviewer",
    "snapshot",
    "read:w1:p2",
    "close:w1:p2",
    "snapshot",
  ]);
});

test("managed worktree is rechecked after settlement before removal", async () => {
  const directory = managedDirectory();
  const herdr = new FakeRetirementHerdr(
    [managedSnapshot(), managedSnapshot(true)],
    [managedAgent("working"), managedAgent()],
  );
  const executor = new SkillRetirementExecutor({ herdr, directory });

  const result = await executor.retire({
    helperAlias: "auth-writer",
    callerPaneId: "w1:p1",
    semanticEvidence,
    execute: true,
  });

  assert.deepEqual(result, {
    helperAlias: "auth-writer",
    action: "retain",
    reasons: ["managed-worktree-has-other-panes"],
  });
  assert.deepEqual(herdr.calls, [
    "agent:auth-writer",
    "snapshot",
    "wait-settled:auth-writer",
    "agent:auth-writer",
    "snapshot",
  ]);
});

test("post-close snapshot failure returns reconciliation", async () => {
  const directory = new HelperDirectory();
  directory.bind("helper-reviewer", "w1:p2", "term_helper");
  const herdr = new FakeRetirementHerdr([snapshot(true)], [agent()]);
  const executor = new SkillRetirementExecutor({ herdr, directory });

  const result = await executor.retire({
    helperAlias: "helper-reviewer",
    callerPaneId: "w1:p1",
    semanticEvidence,
    execute: true,
  });

  assert.deepEqual(result, {
    helperAlias: "helper-reviewer",
    action: "reconcile",
    reasons: ["close-verification-unconfirmed:missing fake snapshot"],
  });
  assert.equal(directory.resolve("helper-reviewer")?.terminalId, "term_helper");
});

test("post-close binding persistence failure returns reconciliation", async (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "pi-loom-retirement-binding-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const bindingPath = join(temporary, "bindings.json");
  const directory = new HelperDirectory({ path: bindingPath });
  directory.bind("helper-reviewer", "w1:p2", "term_helper");
  rmSync(bindingPath);
  mkdirSync(bindingPath);
  const herdr = new FakeRetirementHerdr([snapshot(true), snapshot(false)], [agent()]);
  const executor = new SkillRetirementExecutor({ herdr, directory });

  const result = await executor.retire({
    helperAlias: "helper-reviewer",
    callerPaneId: "w1:p1",
    semanticEvidence,
    execute: true,
  });

  assert.deepEqual(result, {
    helperAlias: "helper-reviewer",
    action: "reconcile",
    reasons: ["binding-removal-failed"],
  });
  assert.equal(directory.resolve("helper-reviewer")?.terminalId, "term_helper");
});

test("retained helper reconciles when its explicit reuse role is not live", async () => {
  const directory = new HelperDirectory();
  directory.bind("helper-reviewer", "w1:p2", "term_helper");
  const live = snapshot(true);
  (live.panes[1] as { label: string }).label = "reviewer";
  const herdr = new FakeRetirementHerdr([live], [agent("idle")]);
  const executor = new SkillRetirementExecutor({ herdr, directory });

  const result = await executor.retire({
    helperAlias: "helper-reviewer",
    callerPaneId: "w1:p1",
    semanticEvidence: {
      reportIntegrated: true,
      durableEvidence: true,
      pendingApproval: false,
      pendingUserInput: false,
      queuedFollowup: false,
      runningService: false,
      unresolvedBlocker: false,
      descendantsSettled: true,
    },
    reuseRole: "maintainer",
    execute: false,
  });

  assert.deepEqual(result, {
    helperAlias: "helper-reviewer",
    action: "reconcile",
    reasons: ["reuse-role-label-unconfirmed"],
  });
  assert.deepEqual(herdr.calls, ["agent:helper-reviewer", "snapshot"]);
});

test("explicitly relabeled reuse helper remains retained", async () => {
  const directory = new HelperDirectory();
  directory.bind("helper-reviewer", "w1:p2", "term_helper");
  const live = snapshot(true);
  (live.panes[1] as { label: string }).label = "maintainer";
  const herdr = new FakeRetirementHerdr([live], [agent("idle")]);
  const executor = new SkillRetirementExecutor({ herdr, directory });

  const result = await executor.retire({
    helperAlias: "helper-reviewer",
    callerPaneId: "w1:p1",
    semanticEvidence: {
      reportIntegrated: true,
      durableEvidence: true,
      pendingApproval: false,
      pendingUserInput: false,
      queuedFollowup: false,
      runningService: false,
      unresolvedBlocker: false,
      descendantsSettled: true,
    },
    reuseRole: "maintainer",
    execute: true,
  });

  assert.deepEqual(result, {
    helperAlias: "helper-reviewer",
    action: "retain",
    reasons: ["named-reuse-role"],
  });
  assert.deepEqual(herdr.calls, ["agent:helper-reviewer", "snapshot", "read:w1:p2"]);
});
