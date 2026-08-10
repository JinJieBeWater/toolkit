import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { childExecutionEnv, registerLoomExtension } from "../src/skill-extension.ts";
import { HelperDirectory, helperBindingStorePath } from "../src/skill-launch-executor.ts";

type RegisteredTool = {
  name: string;
  execute: (...args: any[]) => Promise<any>;
};

function fakePi(): {
  pi: { registerTool: (tool: RegisteredTool) => void };
  tools: Map<string, RegisteredTool>;
} {
  const tools = new Map<string, RegisteredTool>();
  return {
    pi: { registerTool: (tool) => tools.set(tool.name, tool) },
    tools,
  };
}

const retained = {
  retire: async () => ({ helperAlias: "x", action: "retain" as const, reasons: [] }),
};

test("child launch preserves isolated Pi config and executable path", () => {
  assert.deepEqual(
    childExecutionEnv({
      PATH: "/node24/bin:/usr/bin",
      PI_CODING_AGENT_DIR: "/tmp/case/pi-agent",
      HOME: "/Users/example",
      PI_LOOM_EXTENSION_PATH: "/repo",
      HTTP_PROXY: "http://127.0.0.1:7890",
      NO_PROXY: "localhost,127.0.0.1",
      SECRET: "not-forwarded",
    }),
    {
      PATH: "/node24/bin:/usr/bin",
      PI_CODING_AGENT_DIR: "/tmp/case/pi-agent",
      HOME: "/Users/example",
      PI_LOOM_EXTENSION_PATH: "/repo",
      HTTP_PROXY: "http://127.0.0.1:7890",
      NO_PROXY: "localhost,127.0.0.1",
    },
  );
});

test("default parent exposes only Pi Loom tools", () => {
  const { pi, tools } = fakePi();
  registerLoomExtension(pi as never, {
    env: {
      HERDR_ENV: "1",
      HERDR_PANE_ID: "w1:p1",
      HERDR_SOCKET_PATH: "/tmp/herdr.sock",
    },
    launchExecutor: {
      execute: async () => ({
        kind: "rejected",
        helperAlias: "x",
        code: "UNUSABLE_LAYOUT",
        reason: "test",
      }),
    } as never,
    retirement: retained,
  });

  assert.deepEqual([...tools.keys()].sort(), ["loom_close", "loom_start", "loom_status"]);
});

test("globally installed parent lets child inherit configured package", async () => {
  const { pi, tools } = fakePi();
  let received: any;
  registerLoomExtension(pi as never, {
    env: {
      HERDR_ENV: "1",
      HERDR_PANE_ID: "w1:p1",
      HERDR_SOCKET_PATH: "/tmp/herdr.sock",
    },
    launchExecutor: {
      execute: async (input: unknown) => {
        received = input;
        return {
          kind: "started" as const,
          helperAlias: "reviewer",
          agentStatus: "working",
          placement: {
            kind: "sibling" as const,
            split: "right" as const,
            size: "100x50",
            focusPreserved: true as const,
          },
          configuration: { model: "default", thinking: "default" },
          presentation: { workstreamLabel: "review", roleLabel: "reviewer" },
        };
      },
    },
    retirement: retained,
  });

  await tools.get("loom_start")!.execute(
    "call-start",
    {
      name: "reviewer",
      task: "Review.",
      workstream: "review",
      access: "read",
      files: ["src/**"],
    },
    undefined,
    undefined,
    { cwd: "/repo" },
  );

  assert.equal(received.launch.command.argv.includes("-e"), false);
});

test("loom_start maps short request to persistent launch seam", async () => {
  const { pi, tools } = fakePi();
  let received: any;
  registerLoomExtension(pi as never, {
    env: {
      HERDR_ENV: "1",
      HERDR_PANE_ID: "w1:p1",
      HERDR_SOCKET_PATH: "/tmp/herdr.sock",
    },
    extensionPath: "/repo",
    launchExecutor: {
      execute: async (input: unknown) => {
        received = input;
        return {
          kind: "started" as const,
          helperAlias: "reviewer",
          agentStatus: "working",
          placement: {
            kind: "workspace-tab" as const,
            size: "120x40",
            focusPreserved: true as const,
          },
          configuration: { model: "openai-codex/gpt-5.6-terra", thinking: "high" },
          presentation: { workstreamLabel: "target-review", roleLabel: "reviewer" },
        };
      },
    },
    retirement: retained,
  });

  await tools.get("loom_start")!.execute(
    "call-start",
    {
      name: "reviewer",
      task: "Review target checkout.",
      checkout: { kind: "existing", path: "/target" },
      workstream: "target-review",
      role: "reviewer",
      access: "read",
      files: ["src/**"],
      model: "openai-codex/gpt-5.6-terra",
      thinking: "high",
    },
    undefined,
    undefined,
    { cwd: "/caller" },
  );

  assert.equal(received.callerCwd, "/caller");
  assert.equal(received.launch.command.cwd, "/target");
  assert.deepEqual(received.launch.command.argv.slice(0, 5), [
    "pi",
    "--no-extensions",
    "-e",
    "/repo",
    "--tools",
  ]);
  assert.match(received.launch.initialPrompt, /Do not launch descendants/);
});

test("loom_start maps managed checkout intent without exposing Herdr identities", async () => {
  const { pi, tools } = fakePi();
  let received: any;
  registerLoomExtension(pi as never, {
    env: {
      HERDR_ENV: "1",
      HERDR_PANE_ID: "w1:p1",
      HERDR_SOCKET_PATH: "/tmp/herdr.sock",
    },
    launchExecutor: {
      execute: async (input: unknown) => {
        received = input;
        return {
          kind: "started" as const,
          helperAlias: "writer",
          agentStatus: "working",
          placement: {
            kind: "worktree" as const,
            path: "/repo-worktrees/auth",
            branch: "fix/auth-expiry",
            size: "120x40",
            focusPreserved: true as const,
          },
          configuration: { model: "default", thinking: "default" },
          presentation: { workstreamLabel: "auth-fix", roleLabel: "helper" },
        };
      },
    },
    retirement: retained,
  });

  const result = await tools.get("loom_start")!.execute(
    "call-start",
    {
      name: "writer",
      task: "Fix auth expiry.",
      workstream: "auth-fix",
      access: "write",
      files: ["src/auth/**"],
      writeApproved: true,
      checkout: {
        kind: "worktree",
        branch: "fix/auth-expiry",
        base: "origin/main",
      },
    },
    undefined,
    undefined,
    { cwd: "/repo" },
  );

  assert.equal(received.launch.command.cwd, "/repo");
  assert.deepEqual(received.worktree, {
    branch: "fix/auth-expiry",
    base: "origin/main",
  });
  assert.doesNotMatch(JSON.stringify(result), /w1:p1|workspaceId|paneId/);
});

test("loom_start hides raw transport errors", async () => {
  const { pi, tools } = fakePi();
  registerLoomExtension(pi as never, {
    env: {
      HERDR_ENV: "1",
      HERDR_PANE_ID: "w1:p1",
      HERDR_SOCKET_PATH: "/private/herdr.sock",
    },
    launchExecutor: {
      execute: async () => {
        throw new Error("connect ENOENT /private/herdr.sock");
      },
    },
    retirement: retained,
  });

  const result = await tools.get("loom_start")!.execute(
    "call-start",
    {
      name: "reviewer",
      task: "Review.",
      workstream: "review",
      access: "read",
      files: ["src/**"],
    },
    undefined,
    undefined,
    { cwd: "/repo" },
  );

  assert.doesNotMatch(JSON.stringify(result), /ENOENT|private\/herdr\.sock/);
  assert.match(result.content[0].text, /reconcile/);
});

test("loom_start binds helper to current Pi session", async (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "pi-loom-extension-session-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const sessionFile = join(temporary, "parent.jsonl");
  const directory = new HelperDirectory();
  const { pi, tools } = fakePi();
  registerLoomExtension(pi as never, {
    env: {
      HERDR_ENV: "1",
      HERDR_PANE_ID: "w1:p1",
      HERDR_SOCKET_PATH: "/tmp/herdr.sock",
    },
    helperDirectory: directory,
    launchExecutor: {
      execute: async () => {
        directory.bind("reviewer", "w1:p2", "term_helper");
        return {
          kind: "started" as const,
          helperAlias: "reviewer",
          agentStatus: "working",
          placement: {
            kind: "sibling" as const,
            split: "right" as const,
            size: "100x50",
            focusPreserved: true as const,
          },
          configuration: { model: "default", thinking: "default" },
          presentation: { workstreamLabel: "review", roleLabel: "reviewer" },
        };
      },
    },
    retirement: retained,
  });

  await tools.get("loom_start")!.execute(
    "call-start",
    {
      name: "reviewer",
      task: "Review.",
      workstream: "review",
      access: "read",
      files: ["src/**"],
    },
    undefined,
    undefined,
    { cwd: "/repo", sessionManager: { getSessionFile: () => sessionFile } },
  );

  assert.equal(
    new HelperDirectory({ path: helperBindingStorePath(sessionFile) }).resolve("reviewer")
      ?.terminalId,
    "term_helper",
  );
});

test("loom_start rejects invalid helper name before launch", async () => {
  const { pi, tools } = fakePi();
  let launched = false;
  registerLoomExtension(pi as never, {
    env: {
      HERDR_ENV: "1",
      HERDR_PANE_ID: "w1:p1",
      HERDR_SOCKET_PATH: "/tmp/herdr.sock",
    },
    launchExecutor: {
      execute: async () => {
        launched = true;
        throw new Error("must not launch");
      },
    },
    retirement: retained,
  });

  await assert.rejects(
    tools.get("loom_start")!.execute(
      "call-start",
      {
        name: "Review Helper",
        task: "Review.",
        workstream: "review",
        access: "read",
        files: ["src/**"],
      },
      undefined,
      undefined,
      { cwd: "/repo" },
    ),
    /name must match Herdr agent name grammar/,
  );
  assert.equal(launched, false);
});

test("child exposes Loom tools and reports canonical result", async () => {
  const { pi, tools } = fakePi();
  let received: any;
  let deliveries = 0;
  registerLoomExtension(pi as never, {
    env: {
      HERDR_ENV: "1",
      HERDR_PANE_ID: "w1:p2",
      HERDR_SOCKET_PATH: "/tmp/herdr.sock",
      PI_HERDR_TASK_ID: "review",
      PI_HERDR_PARENT_PANE_ID: "w1:p1",
      PI_HERDR_CHILD_LABEL: "reviewer",
      PI_HERDR_WORKSTREAM_LABEL: "target-review",
    },
    launchExecutor: {
      execute: async () => ({
        kind: "rejected",
        helperAlias: "x",
        code: "UNUSABLE_LAYOUT",
        reason: "test",
      }),
    } as never,
    retirement: retained,
    reporting: {
      deliver: async (input: unknown) => {
        deliveries += 1;
        received = input;
        return { delivered: "primary" as const, taskId: "review", status: "COMPLETED" as const };
      },
    },
  });

  assert.deepEqual([...tools.keys()].sort(), [
    "loom_close",
    "loom_report",
    "loom_start",
    "loom_status",
  ]);
  const report = {
    status: "COMPLETED",
    summary: "Review complete.",
    pointers: ["report.md"],
    changed: [],
    checks: ["npm test"],
    next: "Parent integrate.",
  } as const;
  const [, duplicate] = await Promise.all([
    tools.get("loom_report")!.execute("call-report", report),
    tools.get("loom_report")!.execute("call-report-again", report),
  ]);
  await tools.get("loom_report")!.execute("call-report-different", {
    ...report,
    summary: "Different duplicate content.",
  });

  assert.equal(deliveries, 1);
  assert.match(duplicate.content[0].text, /already delivered/);
  assert.equal(received.outcome, "Review complete.");
  assert.deepEqual(received.durablePointers, ["report.md"]);
  assert.deepEqual(received.verification, ["npm test"]);
});

test("loom_close maps owner checks to retirement evidence", async () => {
  const { pi, tools } = fakePi();
  let received: any;
  registerLoomExtension(pi as never, {
    env: {
      HERDR_ENV: "1",
      HERDR_PANE_ID: "w1:p1",
      HERDR_SOCKET_PATH: "/tmp/herdr.sock",
    },
    launchExecutor: {
      execute: async () => ({
        kind: "rejected",
        helperAlias: "x",
        code: "UNUSABLE_LAYOUT",
        reason: "test",
      }),
    } as never,
    retirement: {
      retire: async (input: unknown) => {
        received = input;
        return { helperAlias: "reviewer", action: "closed" as const, reasons: [] };
      },
    },
  });

  await tools.get("loom_close")!.execute(
    "call-close",
    {
      name: "reviewer",
      integrated: true,
      evidence: true,
      settled: true,
      pending: false,
      service: false,
      execute: true,
    },
    undefined,
    undefined,
    { cwd: "/repo", sessionManager: { getSessionFile: () => undefined } },
  );

  assert.deepEqual(received.semanticEvidence, {
    reportIntegrated: true,
    durableEvidence: true,
    pendingApproval: false,
    pendingUserInput: false,
    queuedFollowup: false,
    runningService: false,
    unresolvedBlocker: false,
    descendantsSettled: true,
  });
});

test("loom_status returns opaque empty roster", async () => {
  const { pi, tools } = fakePi();
  registerLoomExtension(pi as never, {
    env: {
      HERDR_ENV: "1",
      HERDR_PANE_ID: "w1:p1",
      HERDR_SOCKET_PATH: "/tmp/herdr.sock",
    },
    launchExecutor: {
      execute: async () => ({
        kind: "rejected",
        helperAlias: "x",
        code: "UNUSABLE_LAYOUT",
        reason: "test",
      }),
    } as never,
    retirement: retained,
  });

  const result = await tools.get("loom_status")!.execute("call-status", {}, undefined, undefined, {
    cwd: "/repo",
    sessionManager: { getSessionFile: () => undefined },
  });

  assert.deepEqual(result.details, { helpers: [] });
  assert.doesNotMatch(JSON.stringify(result), /pane|terminal|socket/i);
});

test("outside Herdr extension registers no tools", () => {
  const { pi, tools } = fakePi();
  registerLoomExtension(pi as never, { env: {} });
  assert.equal(tools.size, 0);
});
