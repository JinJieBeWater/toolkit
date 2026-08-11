import {
  HerdrRpcError,
  type HerdrAdapter,
  type HerdrAgentView,
  type HerdrSnapshot,
} from "./herdr-adapter.ts";
import type { HelperBinding, HelperDirectory } from "./skill-launch-executor.ts";

type RetirementEvidence = {
  workflowOwned: boolean;
  explicitCurrentPermission: boolean;
  agentState: "idle" | "working" | "blocked" | "done" | "unknown";
  recentTranscriptChecked: boolean;
  reportIntegrated: boolean;
  durableEvidence: boolean;
  pendingApproval: boolean;
  pendingUserInput: boolean;
  queuedFollowup: boolean;
  runningService: boolean;
  unresolvedBlocker: boolean;
  descendantsSettled: boolean;
  namedReuseRole: boolean;
  callerPane: boolean;
  foregroundPane: boolean;
};

function retirementReasons(evidence: RetirementEvidence): string[] {
  const reasons: string[] = [];
  if (!evidence.workflowOwned && !evidence.explicitCurrentPermission)
    reasons.push("not-workflow-owned-or-permitted");
  if (evidence.agentState !== "idle" && evidence.agentState !== "done")
    reasons.push("agent-not-idle-or-done");
  if (!evidence.recentTranscriptChecked) reasons.push("recent-transcript-unchecked");
  if (!evidence.reportIntegrated) reasons.push("report-not-integrated");
  if (!evidence.durableEvidence) reasons.push("result-not-durable");
  if (evidence.pendingApproval) reasons.push("pending-approval");
  if (evidence.pendingUserInput) reasons.push("pending-user-input");
  if (evidence.queuedFollowup) reasons.push("queued-followup");
  if (evidence.runningService) reasons.push("running-service");
  if (evidence.unresolvedBlocker) reasons.push("unresolved-blocker");
  if (!evidence.descendantsSettled) reasons.push("descendants-unsettled");
  if (evidence.namedReuseRole) reasons.push("named-reuse-role");
  if (evidence.callerPane) reasons.push("caller-pane");
  if (evidence.foregroundPane) reasons.push("foreground-pane");
  return reasons;
}

export type SkillRetirementHerdrPort = Pick<
  HerdrAdapter,
  "snapshot" | "getAgent" | "waitAgentSettled" | "readRecent" | "closePane" | "removeWorktree"
>;

export type RetirementSemanticEvidence = Pick<
  RetirementEvidence,
  | "reportIntegrated"
  | "durableEvidence"
  | "pendingApproval"
  | "pendingUserInput"
  | "queuedFollowup"
  | "runningService"
  | "unresolvedBlocker"
  | "descendantsSettled"
>;

export type SkillRetirementResult = {
  helperAlias: string;
  action: "eligible" | "closed" | "retain" | "reconcile";
  reasons: string[];
};

type SkillRetirementInput = {
  helperAlias: string;
  callerPaneId: string;
  semanticEvidence: RetirementSemanticEvidence;
  reuseRole?: string;
  execute: boolean;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hasPane(snapshot: HerdrSnapshot, paneId: string): boolean {
  return snapshot.panes.some((value) => record(value)?.pane_id === paneId);
}

function hasWorkspace(snapshot: HerdrSnapshot, workspaceId: string): boolean {
  return snapshot.workspaces.some((value) => record(value)?.workspace_id === workspaceId);
}

function paneLabel(snapshot: HerdrSnapshot, paneId: string): string | null | undefined {
  const pane = snapshot.panes.map(record).find((value) => value?.pane_id === paneId);
  if (!pane) return undefined;
  return typeof pane.label === "string" && pane.label.length > 0 ? pane.label : null;
}

function agentState(value: string): RetirementEvidence["agentState"] {
  return value === "idle" || value === "working" || value === "blocked" || value === "done"
    ? value
    : "unknown";
}

function managedWorktreeGuard(
  snapshot: HerdrSnapshot,
  paneId: string,
  managedWorktree: NonNullable<HelperBinding["managedWorktree"]>,
): { action: "retain" | "reconcile"; reasons: string[] } | undefined {
  const pane = snapshot.panes.map(record).find((value) => value?.pane_id === paneId);
  const workspace = snapshot.workspaces
    .map(record)
    .find((value) => value?.workspace_id === managedWorktree.workspaceId);
  const worktree = record(workspace?.worktree);
  if (
    pane?.workspace_id !== managedWorktree.workspaceId ||
    worktree?.checkout_path !== managedWorktree.path
  ) {
    return { action: "reconcile", reasons: ["managed-worktree-identity-mismatch"] };
  }
  if (
    snapshot.panes.some((value) => {
      const candidate = record(value);
      return (
        candidate?.workspace_id === managedWorktree.workspaceId && candidate.pane_id !== paneId
      );
    })
  ) {
    return { action: "retain", reasons: ["managed-worktree-has-other-panes"] };
  }
  return undefined;
}

export class SkillRetirementExecutor {
  constructor(
    private readonly options: {
      herdr: SkillRetirementHerdrPort;
      directory: HelperDirectory;
    },
  ) {}

  async #removeManagedWorktree(
    helperAlias: string,
    managedWorktree: NonNullable<HelperBinding["managedWorktree"]>,
  ): Promise<SkillRetirementResult> {
    try {
      await this.options.herdr.removeWorktree(managedWorktree.workspaceId, managedWorktree.path);
    } catch (error) {
      return {
        helperAlias,
        action: "reconcile",
        reasons: [`close-unconfirmed:${(error as Error).message}`],
      };
    }
    let after: HerdrSnapshot;
    try {
      after = await this.options.herdr.snapshot();
    } catch (error) {
      return {
        helperAlias,
        action: "reconcile",
        reasons: [`close-verification-unconfirmed:${(error as Error).message}`],
      };
    }
    if (hasWorkspace(after, managedWorktree.workspaceId)) {
      return {
        helperAlias,
        action: "reconcile",
        reasons: ["worktree-still-present-after-remove"],
      };
    }
    try {
      this.options.directory.remove(helperAlias);
    } catch {
      return {
        helperAlias,
        action: "reconcile",
        reasons: ["binding-removal-failed"],
      };
    }
    return { helperAlias, action: "closed", reasons: [] };
  }

  async #retirePendingWorktree(
    input: SkillRetirementInput,
    binding: HelperBinding,
  ): Promise<SkillRetirementResult> {
    const managedWorktree = binding.managedWorktree!;
    let before: HerdrSnapshot;
    try {
      before = await this.options.herdr.snapshot();
    } catch (error) {
      return {
        helperAlias: input.helperAlias,
        action: "reconcile",
        reasons: [`snapshot-unconfirmed:${(error as Error).message}`],
      };
    }
    const guard = managedWorktreeGuard(before, binding.paneId, managedWorktree);
    if (guard) return { helperAlias: input.helperAlias, ...guard };
    const reasons = retirementReasons({
      workflowOwned: binding.workflowOwned,
      explicitCurrentPermission: false,
      agentState: "done",
      recentTranscriptChecked: true,
      ...input.semanticEvidence,
      reportIntegrated: true,
      durableEvidence: true,
      namedReuseRole: Boolean(input.reuseRole),
      callerPane: binding.paneId === input.callerPaneId,
      foregroundPane: before.focusedPaneId === binding.paneId,
    });
    if (reasons.length > 0) {
      return { helperAlias: input.helperAlias, action: "retain", reasons };
    }
    if (!input.execute) {
      return { helperAlias: input.helperAlias, action: "eligible", reasons: [] };
    }
    return await this.#removeManagedWorktree(input.helperAlias, managedWorktree);
  }

  async retire(input: SkillRetirementInput): Promise<SkillRetirementResult> {
    let binding = this.options.directory.resolve(input.helperAlias);
    if (!binding) {
      return {
        helperAlias: input.helperAlias,
        action: "retain",
        reasons: ["helper-not-bound"],
      };
    }

    let live: HerdrAgentView;
    try {
      live = await this.options.herdr.getAgent(input.helperAlias);
    } catch (error) {
      if (
        binding.terminalId === undefined &&
        binding.managedWorktree &&
        error instanceof HerdrRpcError &&
        ["agent_not_found", "agent_name_not_found"].includes(error.code)
      ) {
        return await this.#retirePendingWorktree(input, binding);
      }
      return {
        helperAlias: input.helperAlias,
        action: "reconcile",
        reasons: [`agent-resolution-unconfirmed:${(error as Error).message}`],
      };
    }
    if (binding.terminalId === undefined) {
      if (!binding.managedWorktree || live.paneId !== binding.paneId) {
        return {
          helperAlias: input.helperAlias,
          action: "reconcile",
          reasons: ["pending-helper-identity-mismatch"],
        };
      }
      try {
        this.options.directory.bind(
          binding.alias,
          binding.paneId,
          live.terminalId,
          binding.managedWorktree,
          binding.reuseRole,
        );
        binding = this.options.directory.resolve(binding.alias)!;
      } catch (error) {
        return {
          helperAlias: input.helperAlias,
          action: "reconcile",
          reasons: [`pending-helper-binding-failed:${(error as Error).message}`],
        };
      }
    }
    if (live.terminalId !== binding.terminalId) {
      return {
        helperAlias: input.helperAlias,
        action: "reconcile",
        reasons: ["helper-name-terminal-mismatch"],
      };
    }

    let before: HerdrSnapshot;
    try {
      before = await this.options.herdr.snapshot();
    } catch (error) {
      return {
        helperAlias: input.helperAlias,
        action: "reconcile",
        reasons: [`snapshot-unconfirmed:${(error as Error).message}`],
      };
    }
    if (!hasPane(before, live.paneId)) {
      return {
        helperAlias: input.helperAlias,
        action: "reconcile",
        reasons: ["live-pane-missing"],
      };
    }
    if (binding.managedWorktree) {
      const guard = managedWorktreeGuard(before, live.paneId, binding.managedWorktree);
      if (guard) return { helperAlias: input.helperAlias, ...guard };
    }
    if (
      agentState(live.agentStatus) === "working" &&
      input.semanticEvidence.reportIntegrated &&
      !input.semanticEvidence.pendingApproval &&
      !input.semanticEvidence.pendingUserInput &&
      !input.semanticEvidence.unresolvedBlocker
    ) {
      try {
        await this.options.herdr.waitAgentSettled(input.helperAlias, 30_000);
        live = await this.options.herdr.getAgent(input.helperAlias);
        if (live.terminalId !== binding.terminalId) {
          return {
            helperAlias: input.helperAlias,
            action: "reconcile",
            reasons: ["helper-name-terminal-mismatch"],
          };
        }
        before = await this.options.herdr.snapshot();
        if (binding.managedWorktree) {
          const guard = managedWorktreeGuard(before, live.paneId, binding.managedWorktree);
          if (guard) return { helperAlias: input.helperAlias, ...guard };
        }
      } catch (error) {
        return {
          helperAlias: input.helperAlias,
          action: "reconcile",
          reasons: [`settlement-unconfirmed:${(error as Error).message}`],
        };
      }
    }
    if (input.reuseRole && paneLabel(before, live.paneId) !== input.reuseRole) {
      return {
        helperAlias: input.helperAlias,
        action: "reconcile",
        reasons: ["reuse-role-label-unconfirmed"],
      };
    }
    try {
      await this.options.herdr.readRecent(live.paneId);
    } catch (error) {
      return {
        helperAlias: input.helperAlias,
        action: "reconcile",
        reasons: [`recent-transcript-unconfirmed:${(error as Error).message}`],
      };
    }
    const reasons = retirementReasons({
      workflowOwned: binding.workflowOwned,
      explicitCurrentPermission: false,
      agentState: agentState(live.agentStatus),
      recentTranscriptChecked: true,
      ...input.semanticEvidence,
      namedReuseRole: Boolean(input.reuseRole),
      callerPane: live.paneId === input.callerPaneId,
      foregroundPane: before.focusedPaneId === live.paneId,
    });
    if (reasons.length > 0) {
      return {
        helperAlias: input.helperAlias,
        action: "retain",
        reasons,
      };
    }
    if (!input.execute) {
      return { helperAlias: input.helperAlias, action: "eligible", reasons: [] };
    }

    if (binding.managedWorktree) {
      return await this.#removeManagedWorktree(input.helperAlias, binding.managedWorktree);
    }
    try {
      await this.options.herdr.closePane(live.paneId);
    } catch (error) {
      return {
        helperAlias: input.helperAlias,
        action: "reconcile",
        reasons: [`close-unconfirmed:${(error as Error).message}`],
      };
    }
    let after: HerdrSnapshot;
    try {
      after = await this.options.herdr.snapshot();
    } catch (error) {
      return {
        helperAlias: input.helperAlias,
        action: "reconcile",
        reasons: [`close-verification-unconfirmed:${(error as Error).message}`],
      };
    }
    if (hasPane(after, live.paneId)) {
      return {
        helperAlias: input.helperAlias,
        action: "reconcile",
        reasons: ["pane-still-present-after-close"],
      };
    }
    try {
      this.options.directory.remove(input.helperAlias);
    } catch {
      return {
        helperAlias: input.helperAlias,
        action: "reconcile",
        reasons: ["binding-removal-failed"],
      };
    }
    return { helperAlias: input.helperAlias, action: "closed", reasons: [] };
  }
}
