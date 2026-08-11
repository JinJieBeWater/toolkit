import assert from "node:assert/strict";
import test from "node:test";
import type { HerdrSnapshot } from "../src/herdr-adapter.ts";
import { HelperDirectory } from "../src/skill-launch-executor.ts";
import { SkillHelperDiscovery } from "../src/skill-discovery.ts";

function snapshot(agents: unknown[]): HerdrSnapshot {
  return {
    version: "0.8.0",
    protocol: 19,
    workspaces: [],
    tabs: [],
    panes: [],
    layouts: [],
    agents,
  };
}

test("discovery merges named and unnamed Pi contexts without raw identities", async () => {
  const directory = new HelperDirectory();
  directory.bind("writer", "w1:p2", "term_writer");
  directory.bind("missing", "w1:p3", "term_missing", {
    workspaceId: "w1",
    path: "/repo-worktrees/missing",
    branch: "missing",
  });
  const discovery = new SkillHelperDiscovery({
    directory,
    herdr: {
      snapshot: async () =>
        snapshot([
          {
            agent: "pi",
            name: "writer",
            pane_id: "w1:p2",
            terminal_id: "term_writer",
            agent_status: "working",
          },
          {
            agent: "pi",
            name: "reviewer",
            pane_id: "w1:p4",
            terminal_id: "term_reviewer",
            agent_status: "idle",
          },
          { agent: "pi", pane_id: "w1:p5", terminal_id: "term_unnamed", agent_status: "done" },
          {
            agent: "claude",
            name: "not-pi",
            pane_id: "w1:p6",
            terminal_id: "term_other",
            agent_status: "idle",
          },
        ]),
    },
  });

  const result = await discovery.discover();

  assert.deepEqual(result, {
    kind: "available",
    helpers: [
      {
        name: null,
        state: "done",
        relation: "external",
        ownership: "external",
        control: "none",
        checkout: null,
      },
      {
        name: "missing",
        state: "missing",
        relation: "missing",
        ownership: "current-session",
        control: "local",
        checkout: "managed-worktree",
      },
      {
        name: "reviewer",
        state: "idle",
        relation: "external",
        ownership: "external",
        control: "none",
        checkout: null,
      },
      {
        name: "writer",
        state: "working",
        relation: "owned",
        ownership: "current-session",
        control: "local",
        checkout: "borrowed",
      },
    ],
  });
  assert.doesNotMatch(JSON.stringify(result), /w1:p|term_|\/repo-worktrees/);
});

test("discovery preserves missing lease beside same-name external context", async () => {
  const directory = new HelperDirectory();
  directory.bind("writer", "w1:p2", "term_bound");
  const discovery = new SkillHelperDiscovery({
    directory,
    herdr: {
      snapshot: async () =>
        snapshot([
          {
            agent: "pi",
            name: "writer",
            pane_id: "w1:p9",
            terminal_id: "term_external",
            agent_status: "idle",
          },
          { agent: "pi", pane_id: "w1:p5", terminal_id: "term_unnamed", agent_status: "done" },
        ]),
    },
  });

  assert.deepEqual(await discovery.discover("writer"), {
    kind: "available",
    helpers: [
      {
        name: "writer",
        state: "idle",
        relation: "external",
        ownership: "external",
        control: "none",
        checkout: null,
      },
      {
        name: "writer",
        state: "missing",
        relation: "missing",
        ownership: "current-session",
        control: "local",
        checkout: "borrowed",
      },
    ],
  });
});

test("discovery reports unavailable without transport detail", async () => {
  const discovery = new SkillHelperDiscovery({
    directory: new HelperDirectory(),
    herdr: {
      snapshot: async () => {
        throw new Error("socket /private/herdr.sock unavailable");
      },
    },
  });

  assert.deepEqual(await discovery.discover(), {
    kind: "unavailable",
    code: "DISCOVERY_UNAVAILABLE",
  });
});
