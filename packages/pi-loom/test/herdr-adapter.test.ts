import assert from "node:assert/strict";
import test from "node:test";
import {
  HERDR_PROTOCOL,
  HerdrAdapter,
  HerdrRpcError,
  HerdrTransportError,
  type HerdrRequestTransport,
} from "../src/herdr-adapter.ts";

type Request = { method: string; params: Record<string, unknown> };

class FakeTransport implements HerdrRequestTransport {
  readonly requests: Request[] = [];

  constructor(private readonly responses: Array<unknown | Error>) {}

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    this.requests.push({ method, params });
    const response = this.responses.shift();
    if (response instanceof Error) throw response;
    return response;
  }
}

const pong19 = {
  type: "pong",
  version: "0.8.0",
  protocol: 19,
  capabilities: { live_handoff: true, detached_server_daemon: true },
};

const agent = {
  terminal_id: "term_helper",
  agent_status: "working",
  workspace_id: "w1",
  tab_id: "w1:t1",
  pane_id: "w1:p2",
  focused: false,
  revision: 1,
};

const reviewerPane = {
  type: "pane_info",
  pane: {
    pane_id: "w1:p2",
    workspace_id: "w1",
    tab_id: "w1:t1",
    label: "reviewer",
  },
};

test("snapshot negotiates protocol 19 and preserves unknown server fields", async () => {
  const transport = new FakeTransport([
    pong19,
    {
      type: "session_snapshot",
      snapshot: {
        version: "0.8.0",
        protocol: 19,
        focused_workspace_id: "w1",
        focused_tab_id: "w1:t1",
        focused_pane_id: "w1:p1",
        workspaces: [{ workspace_id: "w1", future_field: true }],
        tabs: [],
        panes: [],
        layouts: [],
        agents: [],
      },
    },
  ]);
  const adapter = new HerdrAdapter({ transport, supportedProtocol: HERDR_PROTOCOL });

  const snapshot = await adapter.snapshot();

  assert.equal(snapshot.protocol, 19);
  assert.equal(snapshot.focusedPaneId, "w1:p1");
  assert.equal(snapshot.workspaces.length, 1);
  assert.deepEqual(
    transport.requests.map((request) => request.method),
    ["ping", "session.snapshot"],
  );
});

test("current product protocol matches Herdr 0.8", async () => {
  const transport = new FakeTransport([
    pong19,
    {
      type: "session_snapshot",
      snapshot: {
        version: "0.8.0",
        protocol: 19,
        workspaces: [],
        tabs: [],
        panes: [],
        layouts: [],
        agents: [],
      },
    },
  ]);
  const adapter = new HerdrAdapter({ transport, supportedProtocol: HERDR_PROTOCOL });

  assert.equal((await adapter.snapshot()).protocol, 19);
});

test("managed worktree creation returns its confirmed root pane", async () => {
  const transport = new FakeTransport([
    pong19,
    {
      type: "worktree_created",
      workspace: { workspace_id: "w2", worktree: { checkout_path: "/repo-worktrees/auth" } },
      tab: { tab_id: "w2:t1", workspace_id: "w2" },
      root_pane: { pane_id: "w2:p1", workspace_id: "w2", tab_id: "w2:t1" },
      worktree: { path: "/repo-worktrees/auth", branch: "fix/auth-expiry" },
    },
  ]);
  const adapter = new HerdrAdapter({ transport, supportedProtocol: HERDR_PROTOCOL });

  const created = await adapter.createWorktree({
    cwd: "/repo",
    branch: "fix/auth-expiry",
    base: "origin/main",
    label: "auth-expiry",
  });

  assert.deepEqual(created, {
    workspaceId: "w2",
    tabId: "w2:t1",
    paneId: "w2:p1",
    path: "/repo-worktrees/auth",
    branch: "fix/auth-expiry",
  });
  assert.deepEqual(transport.requests[1], {
    method: "worktree.create",
    params: {
      cwd: "/repo",
      branch: "fix/auth-expiry",
      base: "origin/main",
      label: "auth-expiry",
      focus: false,
    },
  });
});

test("managed worktree removal refuses force and confirms its identity", async () => {
  const transport = new FakeTransport([
    pong19,
    {
      type: "worktree_removed",
      workspace_id: "w2",
      path: "/repo-worktrees/auth",
      forced: false,
    },
  ]);
  const adapter = new HerdrAdapter({ transport, supportedProtocol: HERDR_PROTOCOL });

  await adapter.removeWorktree("w2", "/repo-worktrees/auth");

  assert.deepEqual(transport.requests[1], {
    method: "worktree.remove",
    params: { workspace_id: "w2", force: false },
  });
});

test("persistent launch splits a shell pane then starts a ready protocol 19 Pi agent", async () => {
  const transport = new FakeTransport([
    pong19,
    {
      type: "pane_info",
      pane: { pane_id: "w1:p2", workspace_id: "w1", tab_id: "w1:t1" },
    },
    {
      type: "pane_info",
      pane: { pane_id: "w1:p2", workspace_id: "w1", tab_id: "w1:t1", label: "reviewer" },
    },
    {
      type: "tab_info",
      tab: { tab_id: "w1:t1", workspace_id: "w1", label: "auth-expiry" },
    },
    {
      type: "agent_started",
      agent: {
        ...agent,
        agent_status: "idle",
        name: "reviewer",
        interactive_ready: true,
        launch_pending: false,
      },
      argv: ["pi", "--model", "openai/gpt-5.4"],
    },
  ]);
  const adapter = new HerdrAdapter({ transport, supportedProtocol: HERDR_PROTOCOL });

  const outcome = await adapter.launchPersistent({
    name: "reviewer",
    argv: ["pi", "--model", "openai/gpt-5.4"],
    cwd: "/repo",
    targetPaneId: "w1:p1",
    split: "right",
    roleLabel: "reviewer",
    workstreamLabel: "auth-expiry",
    env: {
      PI_LOOM_API: "1",
      PI_HERDR_TASK_ID: "task_1",
    },
  });

  assert.deepEqual(outcome, {
    kind: "started",
    paneId: "w1:p2",
    terminalId: "term_helper",
    agentStatus: "idle",
  });
  assert.deepEqual(transport.requests[1], {
    method: "pane.split",
    params: {
      target_pane_id: "w1:p1",
      direction: "right",
      cwd: "/repo",
      focus: false,
      env: {
        PI_LOOM_API: "1",
        PI_HERDR_TASK_ID: "task_1",
      },
    },
  });
  assert.deepEqual(transport.requests[2], {
    method: "pane.rename",
    params: { pane_id: "w1:p2", label: "reviewer" },
  });
  assert.deepEqual(transport.requests[3], {
    method: "tab.rename",
    params: { tab_id: "w1:t1", label: "auth-expiry" },
  });
  assert.deepEqual(transport.requests[4], {
    method: "agent.start",
    params: {
      name: "reviewer",
      kind: "pi",
      pane_id: "w1:p2",
      args: ["--model", "openai/gpt-5.4"],
      timeout_ms: 30_000,
    },
  });
});

test("persistent launch can start in a confirmed target-workspace tab without splitting caller", async () => {
  const transport = new FakeTransport([
    pong19,
    {
      type: "tab_created",
      tab: { tab_id: "w2:t1", workspace_id: "w2", label: "target-review" },
      root_pane: { pane_id: "w2:p1", workspace_id: "w2", tab_id: "w2:t1" },
    },
    {
      type: "pane_info",
      pane: { pane_id: "w2:p1", workspace_id: "w2", tab_id: "w2:t1", label: "reviewer" },
    },
    {
      type: "tab_info",
      tab: { tab_id: "w2:t1", workspace_id: "w2", label: "target-review" },
    },
    {
      type: "agent_started",
      agent: {
        ...agent,
        workspace_id: "w2",
        tab_id: "w2:t1",
        pane_id: "w2:p1",
        agent_status: "idle",
        name: "reviewer",
        interactive_ready: true,
        launch_pending: false,
      },
      argv: ["pi"],
    },
  ]);
  const adapter = new HerdrAdapter({ transport, supportedProtocol: HERDR_PROTOCOL });
  const created = await adapter.createTab({
    workspaceId: "w2",
    cwd: "/target",
    label: "target-review",
    env: {},
  });

  const outcome = await adapter.launchPersistent({
    name: "reviewer",
    argv: ["pi"],
    cwd: "/target",
    targetPaneId: "w1:p1",
    target: { kind: "existing", paneId: created.paneId, tabId: created.tabId },
    roleLabel: "reviewer",
    workstreamLabel: "target-review",
    env: {},
  });

  assert.equal(outcome.kind, "started");
  assert.equal(
    transport.requests.some((request) => request.method === "pane.split"),
    false,
  );
  assert.deepEqual(transport.requests[1], {
    method: "tab.create",
    params: {
      workspace_id: "w2",
      cwd: "/target",
      label: "target-review",
      focus: false,
      env: {},
    },
  });
});

test("persistent launch stops before agent.start when post-split role rename is uncertain", async () => {
  const transport = new FakeTransport([
    pong19,
    {
      type: "pane_info",
      pane: { pane_id: "w1:p2", workspace_id: "w1", tab_id: "w1:t1" },
    },
    new HerdrTransportError("rename request was not written", "before-send"),
  ]);
  const adapter = new HerdrAdapter({ transport, supportedProtocol: HERDR_PROTOCOL });

  const outcome = await adapter.launchPersistent({
    name: "reviewer",
    argv: ["pi"],
    cwd: "/repo",
    targetPaneId: "w1:p1",
    roleLabel: "reviewer",
    env: {},
  });

  assert.deepEqual(outcome, {
    kind: "ambiguous",
    reason:
      "helper pane exists but role or workstream presentation is unconfirmed: rename request was not written",
  });
  assert.deepEqual(
    transport.requests.map((request) => request.method),
    ["ping", "pane.split", "pane.rename"],
  );
});

test("persistent launch stops before agent.start when post-split workstream rename is uncertain", async () => {
  const transport = new FakeTransport([
    pong19,
    {
      type: "pane_info",
      pane: { pane_id: "w1:p2", workspace_id: "w1", tab_id: "w1:t1" },
    },
    reviewerPane,
    new HerdrTransportError("tab rename response was lost", "after-send"),
  ]);
  const adapter = new HerdrAdapter({ transport, supportedProtocol: HERDR_PROTOCOL });

  const outcome = await adapter.launchPersistent({
    name: "reviewer",
    argv: ["pi"],
    cwd: "/repo",
    targetPaneId: "w1:p1",
    roleLabel: "reviewer",
    workstreamLabel: "auth-expiry",
    env: {},
  });

  assert.equal(outcome.kind, "ambiguous");
  assert.match(outcome.reason, /role or workstream presentation is unconfirmed/);
  assert.deepEqual(
    transport.requests.map((request) => request.method),
    ["ping", "pane.split", "pane.rename", "tab.rename"],
  );
});

test("persistent launch confirms interactive readiness for the same named agent", async () => {
  const transport = new FakeTransport([
    pong19,
    {
      type: "pane_info",
      pane: { pane_id: "w1:p2", workspace_id: "w1", tab_id: "w1:t1" },
    },
    reviewerPane,
    {
      type: "agent_started",
      agent: {
        ...agent,
        agent_status: "idle",
        name: "reviewer",
        interactive_ready: false,
        launch_pending: true,
      },
      argv: ["pi"],
    },
    {
      type: "agent_info",
      agent: {
        ...agent,
        agent_status: "idle",
        name: "reviewer",
        interactive_ready: true,
        launch_pending: false,
      },
    },
  ]);
  const adapter = new HerdrAdapter({
    transport,
    supportedProtocol: HERDR_PROTOCOL,
    sleep: async () => {},
  });

  const outcome = await adapter.launchPersistent({
    name: "reviewer",
    argv: ["pi"],
    cwd: "/repo",
    targetPaneId: "w1:p1",
    split: "right",
    roleLabel: "reviewer",
    env: {},
  });

  assert.equal(outcome.kind, "started");
  assert.deepEqual(transport.requests[4], {
    method: "agent.get",
    params: { target: "reviewer" },
  });
});

test("persistent launch rejects an agent started in a different pane", async () => {
  const transport = new FakeTransport([
    pong19,
    {
      type: "pane_info",
      pane: { pane_id: "w1:p2", workspace_id: "w1", tab_id: "w1:t1" },
    },
    reviewerPane,
    {
      type: "agent_started",
      agent: {
        ...agent,
        pane_id: "w1:p9",
        agent_status: "idle",
        name: "reviewer",
        interactive_ready: true,
        launch_pending: false,
      },
      argv: ["pi"],
    },
  ]);
  const adapter = new HerdrAdapter({ transport, supportedProtocol: HERDR_PROTOCOL });

  const outcome = await adapter.launchPersistent({
    name: "reviewer",
    argv: ["pi"],
    cwd: "/repo",
    targetPaneId: "w1:p1",
    roleLabel: "reviewer",
    env: {},
  });

  assert.deepEqual(outcome, {
    kind: "ambiguous",
    reason: "helper agent started in a different pane than the confirmed target",
  });
});

test("persistent launch retries only a definite fresh-shell busy response", async () => {
  const transport = new FakeTransport([
    pong19,
    {
      type: "pane_info",
      pane: { pane_id: "w1:p2", workspace_id: "w1", tab_id: "w1:t1" },
    },
    reviewerPane,
    new HerdrRpcError("agent_pane_busy", "agent target pane w1:p2 is not an available shell"),
    {
      type: "agent_started",
      agent: {
        ...agent,
        agent_status: "idle",
        name: "reviewer",
        interactive_ready: true,
        launch_pending: false,
      },
      argv: ["pi"],
    },
  ]);
  const adapter = new HerdrAdapter({
    transport,
    supportedProtocol: HERDR_PROTOCOL,
    sleep: async () => {},
  });

  const outcome = await adapter.launchPersistent({
    name: "reviewer",
    argv: ["pi"],
    cwd: "/repo",
    targetPaneId: "w1:p1",
    roleLabel: "reviewer",
    env: {},
  });

  assert.equal(outcome.kind, "started");
  assert.equal(transport.requests.filter((request) => request.method === "agent.start").length, 2);
});

test("agent prompt atomically submits and waits for protocol 19 working state", async () => {
  const transport = new FakeTransport([
    pong19,
    {
      type: "agent_prompted",
      agent: {
        ...agent,
        name: "reviewer",
        interactive_ready: true,
        launch_pending: false,
      },
    },
  ]);
  const adapter = new HerdrAdapter({ transport, supportedProtocol: HERDR_PROTOCOL });

  const prompted = await adapter.promptAgent(
    "reviewer",
    "Inspect README.md and report through loom_report.",
    ["working"],
    60_000,
  );

  assert.equal(prompted.agentStatus, "working");
  assert.deepEqual(transport.requests[1], {
    method: "agent.prompt",
    params: {
      target: "reviewer",
      text: "Inspect README.md and report through loom_report.",
      wait: { until: ["working"], timeout_ms: 60_000 },
    },
  });
});

test("report delivery prompts the parent agent and maps missing targets", async () => {
  const transport = new FakeTransport([
    pong19,
    {
      type: "agent_prompted",
      agent: {
        ...agent,
        pane_id: "w1:p1",
        terminal_id: "term_parent",
        agent_status: "idle",
        interactive_ready: true,
        launch_pending: false,
      },
    },
    new HerdrRpcError("agent_not_found", "agent w1:p9 not found"),
    { type: "notification_show", shown: true, reason: "shown" },
  ]);
  const adapter = new HerdrAdapter({ transport, supportedProtocol: HERDR_PROTOCOL });

  assert.equal(await adapter.deliverAgentPrompt("w1:p1", "report"), "accepted");
  assert.equal(await adapter.deliverAgentPrompt("w1:p9", "report"), "missing");
  await adapter.showNotification({ title: "Report ready", body: "task in helper", sound: "done" });

  assert.deepEqual(transport.requests.slice(1), [
    {
      method: "agent.prompt",
      params: { target: "w1:p1", text: "report" },
    },
    {
      method: "agent.prompt",
      params: { target: "w1:p9", text: "report" },
    },
    {
      method: "notification.show",
      params: { title: "Report ready", body: "task in helper", sound: "done" },
    },
  ]);
});

test("agent status wait uses the protocol 19 identity-pinned server wait", async () => {
  const transport = new FakeTransport([
    pong19,
    {
      type: "agent_info",
      agent: {
        ...agent,
        agent_status: "idle",
        name: "reviewer",
        interactive_ready: true,
        launch_pending: false,
      },
    },
  ]);
  const adapter = new HerdrAdapter({ transport, supportedProtocol: HERDR_PROTOCOL });

  await adapter.waitAgentStatus("reviewer", "idle", 60_000);

  assert.deepEqual(transport.requests[1], {
    method: "agent.wait",
    params: {
      target: "reviewer",
      until: ["idle"],
      timeout_ms: 60_000,
    },
  });
});

test("agent settlement uses one protocol 19 wait for idle or done", async () => {
  const transport = new FakeTransport([
    pong19,
    {
      type: "agent_info",
      agent: {
        ...agent,
        agent_status: "done",
        name: "reviewer",
        interactive_ready: true,
        launch_pending: false,
      },
    },
  ]);
  const adapter = new HerdrAdapter({ transport, supportedProtocol: HERDR_PROTOCOL });

  await adapter.waitAgentSettled("reviewer", 30_000);

  assert.deepEqual(transport.requests[1], {
    method: "agent.wait",
    params: {
      target: "reviewer",
      until: ["idle", "done"],
      timeout_ms: 30_000,
    },
  });
});

test("retirement adapter reads recent transcript and closes exact pane", async () => {
  const transport = new FakeTransport([
    pong19,
    {
      type: "pane_read",
      read: {
        pane_id: "w1:p2",
        workspace_id: "w1",
        tab_id: "w1:t1",
        source: "recent_unwrapped",
        format: "text",
        text: "report sent",
        revision: 2,
        truncated: false,
      },
    },
    { type: "ok" },
  ]);
  const adapter = new HerdrAdapter({ transport, supportedProtocol: HERDR_PROTOCOL });

  assert.equal(await adapter.readRecent("w1:p2", 240), "report sent");
  await adapter.closePane("w1:p2");

  assert.deepEqual(transport.requests.slice(1), [
    {
      method: "pane.read",
      params: {
        pane_id: "w1:p2",
        source: "recent_unwrapped",
        lines: 240,
        format: "text",
        strip_ansi: true,
      },
    },
    { method: "pane.close", params: { pane_id: "w1:p2" } },
  ]);
});

test("presentation adapter renames pane and tab through protocol 19 confirmations", async () => {
  const transport = new FakeTransport([
    pong19,
    {
      type: "pane_info",
      pane: { pane_id: "w1:p2", tab_id: "w1:t1", label: "maintainer" },
    },
    {
      type: "tab_info",
      tab: { tab_id: "w1:t1", workspace_id: "w1", label: "auth-maintenance" },
    },
  ]);
  const adapter = new HerdrAdapter({ transport, supportedProtocol: HERDR_PROTOCOL });

  await adapter.renamePane("w1:p2", "maintainer");
  await adapter.renameTab("w1:t1", "auth-maintenance");

  assert.deepEqual(transport.requests.slice(1), [
    {
      method: "pane.rename",
      params: { pane_id: "w1:p2", label: "maintainer" },
    },
    {
      method: "tab.rename",
      params: { tab_id: "w1:t1", label: "auth-maintenance" },
    },
  ]);
});

test("post-send transport loss makes launch ambiguous instead of retryable", async () => {
  const transport = new FakeTransport([
    pong19,
    {
      type: "pane_info",
      pane: { pane_id: "w1:p2", workspace_id: "w1", tab_id: "w1:t1" },
    },
    reviewerPane,
    new HerdrTransportError("connection closed after write", "after-send"),
  ]);
  const adapter = new HerdrAdapter({ transport, supportedProtocol: HERDR_PROTOCOL });

  const outcome = await adapter.launchPersistent({
    name: "reviewer",
    argv: ["pi"],
    cwd: "/repo",
    targetPaneId: "w1:p1",
    roleLabel: "reviewer",
    env: { PI_LOOM_API: "1", PI_HERDR_TASK_ID: "task_1" },
  });

  assert.deepEqual(outcome, {
    kind: "ambiguous",
    reason:
      "helper shell pane exists but agent startup is unconfirmed: connection closed after write",
  });
  assert.equal(transport.requests.filter((request) => request.method === "agent.start").length, 1);
});

test("start failure after a confirmed split remains reconcilable", async () => {
  const transport = new FakeTransport([
    pong19,
    {
      type: "pane_info",
      pane: { pane_id: "w1:p2", workspace_id: "w1", tab_id: "w1:t1" },
    },
    reviewerPane,
    new HerdrTransportError("start request was not written", "before-send"),
  ]);
  const adapter = new HerdrAdapter({ transport, supportedProtocol: HERDR_PROTOCOL });

  const outcome = await adapter.launchPersistent({
    name: "reviewer",
    argv: ["pi"],
    cwd: "/repo",
    targetPaneId: "w1:p1",
    roleLabel: "reviewer",
    env: {},
  });

  assert.deepEqual(outcome, {
    kind: "ambiguous",
    reason:
      "helper shell pane exists but agent startup is unconfirmed: start request was not written",
  });
});

test("malformed split confirmation remains ambiguous after the mutation request", async () => {
  const transport = new FakeTransport([pong19, { type: "ok" }]);
  const adapter = new HerdrAdapter({ transport, supportedProtocol: HERDR_PROTOCOL });

  const outcome = await adapter.launchPersistent({
    name: "reviewer",
    argv: ["pi"],
    cwd: "/repo",
    targetPaneId: "w1:p1",
    roleLabel: "reviewer",
    env: {},
  });

  assert.deepEqual(outcome, {
    kind: "ambiguous",
    reason:
      "helper pane split may have succeeded but its identity is unconfirmed: invalid Herdr pane.split response type",
  });
  assert.equal(
    transport.requests.some((request) => request.method === "agent.start"),
    false,
  );
});

test("unsupported protocol fails before any state-changing request", async () => {
  const transport = new FakeTransport([{ ...pong19, protocol: 18 }]);
  const adapter = new HerdrAdapter({ transport, supportedProtocol: HERDR_PROTOCOL });

  await assert.rejects(
    adapter.launchPersistent({
      name: "reviewer",
      argv: ["pi"],
      cwd: "/repo",
      targetPaneId: "w1:p1",
      roleLabel: "reviewer",
      env: { PI_LOOM_API: "1", PI_HERDR_TASK_ID: "task_1" },
    }),
    /unsupported Herdr protocol 18/,
  );
  assert.deepEqual(
    transport.requests.map((request) => request.method),
    ["ping"],
  );
});
