import assert from "node:assert/strict";
import test from "node:test";
import { compilePersistentHelperLaunch } from "../src/skill-launch.ts";

test("read-only persistent launch excludes descendant launcher", () => {
  const compiled = compilePersistentHelperLaunch({
    workstreamLabel: "auth-expiry",
    expectedWorkstreamLabel: "auth",
    roleLabel: "reviewer",
    cwd: "/repo",
    model: "openai/gpt-5.6",
    thinking: "high",
    objective: "Find every session expiry boundary and return verified risks.",
    scope: {
      access: "read-only",
      allowedFiles: ["src/auth/**", "test/auth/**"],
    },
    returnChannel: {
      taskId: "auth-expiry-review",
      parentPaneId: "w1:p4",
      coordinatorPaneId: "w1:p1",
      durableResult: "docs/research/auth-expiry.md",
    },
    reuse: { kind: "retire-after-integration" },
    descendantResponsibilities: "Do not launch descendants.",
  });

  assert.deepEqual(compiled.command, {
    argv: [
      "pi",
      "--tools",
      "read,grep,find,ls,loom_report,loom_close,loom_status",
      "--model",
      "openai/gpt-5.6",
      "--thinking",
      "high",
    ],
    cwd: "/repo",
  });
  assert.deepEqual(compiled.modelView, {
    roleLabel: "reviewer",
    access: "read-only",
    configuration: { model: "openai/gpt-5.6", thinking: "high" },
    contracts: ["reporting", "local-hitl"],
    returnChannel: "bound",
    reuse: "retire-after-integration",
  });
  assert.doesNotMatch(JSON.stringify(compiled.modelView), /w1:p4|w1:p1/);
  assert.deepEqual(compiled.internal.returnChannel, {
    taskId: "auth-expiry-review",
    parentPaneId: "w1:p4",
    coordinatorPaneId: "w1:p1",
  });
  assert.deepEqual(compiled.internal.presentation, {
    workstreamLabel: "auth-expiry",
    expectedWorkstreamLabel: "auth",
    roleLabel: "reviewer",
  });
});

test("persistent write launch requires one explicit approved file boundary", () => {
  assert.throws(
    () =>
      compilePersistentHelperLaunch({
        roleLabel: "writer",
        cwd: "/repo",
        objective: "Update auth expiry handling.",
        scope: {
          access: "write",
          allowedFiles: ["src/auth/session.ts"],
        } as never,
        returnChannel: {
          taskId: "auth-expiry-write",
          parentPaneId: "w1:p4",
          durableResult: "src/auth/session.ts",
        },
        reuse: { kind: "retire-after-integration" },
        descendantResponsibilities: "Do not launch descendants.",
      }),
    /write launch requires explicit user approval for the file boundary/,
  );
});
