import assert from "node:assert/strict";
import test from "node:test";
import { SkillReportDelivery, type SkillReportingPort } from "../src/skill-reporting.ts";
import type { HerdrSnapshot } from "../src/herdr-adapter.ts";

const liveSnapshot: HerdrSnapshot = {
  version: "0.8.0",
  protocol: 19,
  focusedWorkspaceId: "w1",
  focusedTabId: "w1:t1",
  focusedPaneId: "w1:p1",
  workspaces: [{ workspace_id: "w1", label: "repo" }],
  tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "live-auth" }],
  panes: [
    { pane_id: "w1:p1", workspace_id: "w1", tab_id: "w1:t1", label: "owner" },
    { pane_id: "w1:p2", workspace_id: "w1", tab_id: "w1:t1", label: "live-reviewer" },
  ],
  layouts: [],
  agents: [],
};

class FakeReportingPort implements SkillReportingPort {
  readonly runs: Array<{ paneId: string; text: string }> = [];
  readonly notifications: Array<{ title: string; body: string; sound: "done" }> = [];

  constructor(
    private readonly missing: Set<string> = new Set(),
    private readonly snapshotResult: HerdrSnapshot | Error = liveSnapshot,
  ) {}

  async snapshot(): Promise<HerdrSnapshot> {
    if (this.snapshotResult instanceof Error) throw this.snapshotResult;
    return structuredClone(this.snapshotResult);
  }

  async deliverAgentPrompt(paneId: string, text: string): Promise<"accepted" | "missing"> {
    this.runs.push({ paneId, text });
    return this.missing.has(paneId) ? "missing" : "accepted";
  }

  async showNotification(input: { title: string; body: string; sound: "done" }): Promise<void> {
    this.notifications.push(structuredClone(input));
  }
}

const report = {
  taskId: "auth-review",
  status: "COMPLETED" as const,
  outcome: "Found one inclusive expiry boundary.",
  durablePointers: ["docs/auth-review.md", "src/auth/session.ts:42"],
  changed: ["docs/auth-review.md"],
  verification: ["npm test -- auth: passed"],
  needNext: "Parent should decide whether to patch <= to <.",
  childPaneId: "w1:p2",
  childLabel: "env-reviewer",
  workstreamLabel: "env-auth",
};

test("terminal report uses canonical Skill format and primary target", async () => {
  const port = new FakeReportingPort();
  const delivery = new SkillReportDelivery({ port });

  const result = await delivery.deliver({
    ...report,
    parentPaneId: "w1:p1",
    coordinatorPaneId: "w1:p0",
  });

  assert.deepEqual(result, {
    delivered: "primary",
    taskId: "auth-review",
    status: "COMPLETED",
  });
  assert.equal(port.runs.length, 1);
  assert.equal(port.runs[0]?.paneId, "w1:p1");
  assert.equal(
    port.runs[0]?.text,
    "[Herdr child report][auth-review][COMPLETED]\n" +
      "Outcome: Found one inclusive expiry boundary.\n" +
      "Durable pointers: docs/auth-review.md, src/auth/session.ts:42\n" +
      "Changed: docs/auth-review.md\n" +
      "Verification: npm test -- auth: passed\n" +
      "Need/next: Parent should decide whether to patch <= to <.\n" +
      "Child pane: w1:p2 (live-reviewer; workstream: live-auth)",
  );
  assert.deepEqual(port.notifications, []);
});

test("terminal report falls back to inherited labels when live presentation is unavailable", async () => {
  const port = new FakeReportingPort(new Set(), new Error("snapshot unavailable"));
  const delivery = new SkillReportDelivery({ port });

  await delivery.deliver({ ...report, parentPaneId: "w1:p1" });

  assert.match(port.runs[0]!.text, /Child pane: w1:p2 \(env-reviewer; workstream: env-auth\)$/);
});

test("missing targets fall back to coordinator then intact-transcript notification", async () => {
  const fallbackPort = new FakeReportingPort(new Set(["w1:p1"]));
  const fallback = new SkillReportDelivery({ port: fallbackPort });

  const fallbackResult = await fallback.deliver({
    ...report,
    parentPaneId: "w1:p1",
    coordinatorPaneId: "w1:p0",
  });

  assert.equal(fallbackResult.delivered, "fallback");
  assert.deepEqual(
    fallbackPort.runs.map((run) => run.paneId),
    ["w1:p1", "w1:p0"],
  );

  const missingPort = new FakeReportingPort(new Set(["w1:p1", "w1:p0"]));
  const missing = new SkillReportDelivery({ port: missingPort });
  const notificationResult = await missing.deliver({
    ...report,
    parentPaneId: "w1:p1",
    coordinatorPaneId: "w1:p0",
  });

  assert.equal(notificationResult.delivered, "notification");
  assert.deepEqual(missingPort.notifications, [
    {
      title: "Herdr child report ready",
      body: "auth-review in w1:p2",
      sound: "done",
    },
  ]);
});
