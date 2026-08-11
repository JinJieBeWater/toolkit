import type { HerdrAdapter, HerdrSnapshot } from "./herdr-adapter.ts";
import type { HelperBinding, HelperDirectory } from "./skill-launch-executor.ts";

export type HelperContextView = {
  name: string | null;
  state: string;
  relation: "owned" | "external" | "missing";
  ownership: "current-session" | "external";
  control: "local" | "none";
  checkout: "borrowed" | "managed-worktree" | null;
};

export type HelperDiscoveryResult =
  | { kind: "available"; helpers: HelperContextView[] }
  | { kind: "unavailable"; code: "DISCOVERY_UNAVAILABLE" };

export type SkillHelperDiscoveryPort = Pick<HerdrAdapter, "snapshot">;
export type HelperDiscoveryPort = Pick<SkillHelperDiscovery, "discover">;

type LivePiContext = {
  name: string | null;
  state: string;
  paneId?: string;
  terminalId?: string;
};

const PI_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const PI_STATE = new Set(["idle", "working", "blocked", "done", "unknown"]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function publicName(value: unknown): string | null {
  return typeof value === "string" && PI_NAME.test(value) ? value : null;
}

function publicState(value: unknown): string {
  return typeof value === "string" && PI_STATE.has(value) ? value : "unknown";
}

function livePiContexts(snapshot: HerdrSnapshot): LivePiContext[] {
  return snapshot.agents.flatMap((value) => {
    const agent = record(value);
    if (agent?.agent !== "pi") return [];
    return [
      {
        name: publicName(agent.name),
        state: publicState(agent.agent_status),
        ...(typeof agent.pane_id === "string" ? { paneId: agent.pane_id } : {}),
        ...(typeof agent.terminal_id === "string" ? { terminalId: agent.terminal_id } : {}),
      },
    ];
  });
}

function ownedCheckout(binding: HelperBinding): "borrowed" | "managed-worktree" {
  return binding.managedWorktree ? "managed-worktree" : "borrowed";
}

function compareContexts(left: HelperContextView, right: HelperContextView): number {
  if (left.name === null) {
    if (right.name !== null) return -1;
  } else if (right.name === null) {
    return 1;
  } else {
    const byName = left.name.localeCompare(right.name);
    if (byName) return byName;
  }
  return (
    left.relation.localeCompare(right.relation) ||
    left.state.localeCompare(right.state) ||
    left.ownership.localeCompare(right.ownership) ||
    left.control.localeCompare(right.control) ||
    String(left.checkout).localeCompare(String(right.checkout))
  );
}

export class SkillHelperDiscovery {
  constructor(
    private readonly options: { herdr: SkillHelperDiscoveryPort; directory: HelperDirectory },
  ) {}

  async discover(name?: string): Promise<HelperDiscoveryResult> {
    let snapshot: HerdrSnapshot;
    try {
      snapshot = await this.options.herdr.snapshot();
    } catch {
      return { kind: "unavailable", code: "DISCOVERY_UNAVAILABLE" };
    }
    const live = livePiContexts(snapshot);
    const consumed = new Set<LivePiContext>();
    const helpers: HelperContextView[] = [];
    for (const binding of this.options.directory.list()) {
      if (name && binding.alias !== name) continue;
      const sameName = live.filter((context) => context.name === binding.alias);
      const exact = sameName.find(
        (context) =>
          binding.terminalId !== undefined &&
          context.paneId === binding.paneId &&
          context.terminalId === binding.terminalId,
      );
      if (exact) {
        consumed.add(exact);
        helpers.push({
          name: binding.alias,
          state: exact.state,
          relation: "owned",
          ownership: "current-session",
          control: "local",
          checkout: ownedCheckout(binding),
        });
      } else {
        helpers.push({
          name: binding.alias,
          state: "missing",
          relation: "missing",
          ownership: "current-session",
          control: "local",
          checkout: ownedCheckout(binding),
        });
      }
    }
    for (const context of live) {
      if (consumed.has(context) || (name && context.name !== name)) continue;
      helpers.push({
        name: context.name,
        state: context.state,
        relation: "external",
        ownership: "external",
        control: "none",
        checkout: null,
      });
    }
    return { kind: "available", helpers: helpers.sort(compareContexts) };
  }
}
