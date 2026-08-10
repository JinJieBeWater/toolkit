export type HelperAccess = "read-only" | "write";
export type PiThinking = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type PersistentHelperLaunchInput = {
  workstreamLabel?: string;
  expectedWorkstreamLabel?: string | null;
  roleLabel: string;
  cwd: string;
  extensionPath?: string;
  model?: string;
  thinking?: PiThinking;
  objective: string;
  scope:
    | {
        access: "read-only";
        allowedFiles: string[];
      }
    | {
        access: "write";
        allowedFiles: string[];
        userApproval: { confirmed: true };
      };
  returnChannel: {
    taskId: string;
    parentPaneId: string;
    coordinatorPaneId?: string;
    durableResult: string;
  };
  reuse: { kind: "retire-after-integration" } | { kind: "retain"; role: string };
  descendantResponsibilities: string;
};

export type CompiledPersistentHelperLaunch = {
  internal: {
    presentation: {
      workstreamLabel?: string;
      expectedWorkstreamLabel?: string | null;
      roleLabel: string;
    };
    returnChannel: {
      taskId: string;
      parentPaneId: string;
      coordinatorPaneId?: string;
    };
  };
  command: {
    argv: string[];
    cwd: string;
  };
  initialPrompt: string;
  modelView: {
    roleLabel: string;
    access: HelperAccess;
    configuration: { model: string; thinking: string };
    contracts: ["reporting", "local-hitl"];
    returnChannel: "bound";
    reuse: string;
  };
};

export function compilePersistentHelperLaunch(
  input: PersistentHelperLaunchInput,
): CompiledPersistentHelperLaunch {
  if (
    input.scope.access === "write" &&
    !("userApproval" in input.scope && input.scope.userApproval?.confirmed === true)
  ) {
    throw new Error("write launch requires explicit user approval for the file boundary");
  }

  const argv = ["pi"];
  if (input.extensionPath) argv.push("--no-extensions", "-e", input.extensionPath);
  if (input.scope.access === "read-only") {
    argv.push("--tools", "read,grep,find,ls,loom_report,loom_close,loom_status");
  }
  if (input.model) argv.push("--model", input.model);
  if (input.thinking) argv.push("--thinking", input.thinking);

  const fallback = input.returnChannel.coordinatorPaneId
    ? `If the primary target is missing, the fallback target is ${input.returnChannel.coordinatorPaneId}.`
    : "If the primary target is missing, keep the full report in this pane and show a Herdr notification.";
  const reuse =
    input.reuse.kind === "retain"
      ? `Retain this pane for role: ${input.reuse.role}.`
      : "Remain open after reporting until the parent integrates the result and retires this pane.";

  const initialPrompt = `You are a persistent Herdr helper owned by your direct parent.

Responsibility route
This assignment is Direct under pi-loom; the contract below is complete. Load pi-loom when you launch a descendant or receive its report.

Outcome
${input.objective}

Scope and ownership
- Access: ${input.scope.access}.
- Allowed files: ${input.scope.allowedFiles.join(", ")}.
- Durable result: ${input.returnChannel.durableResult}.
- ${reuse}
- ${input.descendantResponsibilities}

Local HITL
Local HITL stays in this child pane. Ask complete user questions here and wait here. Do not report ordinary user decisions upstream.

Return contract
Task ID: ${input.returnChannel.taskId}.
After durable output and verification, Report exactly once: call loom_report exactly once as your final tool action before your final response. It formats and delivers the canonical report. If that tool is unavailable but herdr_agent is available, use herdr_agent prompt with target ${input.returnChannel.parentPaneId}, wait false, and this exact report:
[Herdr child report][${input.returnChannel.taskId}][COMPLETED|BLOCKED]\nOutcome: <bounded result or blocker>\nDurable pointers: <issue, file, commit, artifact, or transcript>\nChanged: <files/refs, or none>\nVerification: <checks and result>\nNeed/next: <required input or parent action>\nChild pane: <pane-id> (<role>; workstream: <workstream>)
If neither reporting tool is available, preserve the full report in this pane and final response; do not inject raw pane input.
${fallback}
Use BLOCKED only for a blocker requiring parent action. Keep this pane open until the parent integrates the result.`;

  const returnChannel: CompiledPersistentHelperLaunch["internal"]["returnChannel"] = {
    taskId: input.returnChannel.taskId,
    parentPaneId: input.returnChannel.parentPaneId,
  };
  if (input.returnChannel.coordinatorPaneId) {
    returnChannel.coordinatorPaneId = input.returnChannel.coordinatorPaneId;
  }

  const presentation: CompiledPersistentHelperLaunch["internal"]["presentation"] = {
    roleLabel: input.roleLabel,
  };
  if (input.workstreamLabel) presentation.workstreamLabel = input.workstreamLabel;
  if (Object.prototype.hasOwnProperty.call(input, "expectedWorkstreamLabel")) {
    presentation.expectedWorkstreamLabel = input.expectedWorkstreamLabel ?? null;
  }

  return {
    internal: { presentation, returnChannel },
    command: { argv, cwd: input.cwd },
    initialPrompt,
    modelView: {
      roleLabel: input.roleLabel,
      access: input.scope.access,
      configuration: {
        model: input.model ?? "default",
        thinking: input.thinking ?? "default",
      },
      contracts: ["reporting", "local-hitl"],
      returnChannel: "bound",
      reuse:
        input.reuse.kind === "retain" ? `retain:${input.reuse.role}` : "retire-after-integration",
    },
  };
}
