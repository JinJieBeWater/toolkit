import {
  HerdrRpcError,
  type HerdrAdapter,
  type HerdrSnapshot,
  type PersistentLaunchInput,
  type PersistentLaunchOutcome,
} from "./herdr-adapter.ts";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { CompiledPersistentHelperLaunch } from "./skill-launch.ts";
import {
  compileWorkstreamPresentation,
  isStructurallyAmbiguousLabel,
} from "./skill-presentation.ts";

export type SkillLaunchHerdrPort = Pick<
  HerdrAdapter,
  | "snapshot"
  | "createWorktree"
  | "createTab"
  | "launchPersistent"
  | "promptAgent"
  | "sendPaneInput"
  | "waitAgentStatus"
>;

export type HelperBinding = {
  alias: string;
  paneId: string;
  terminalId?: string;
  workflowOwned: true;
  reuseRole?: string;
  managedWorktree?: {
    workspaceId: string;
    path: string;
    branch: string;
  };
};

type HelperBindingFile = {
  version: 1;
  bindings: HelperBinding[];
};

function parseHelperBindings(path: string): HelperBinding[] {
  if (!existsSync(path)) return [];
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("helper binding store must be a regular non-symlink file");
  }
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid helper binding store");
  }
  const file = value as Partial<HelperBindingFile>;
  if (file.version !== 1 || !Array.isArray(file.bindings)) {
    throw new Error("invalid helper binding store");
  }
  return file.bindings.map((binding) => {
    if (
      !binding ||
      typeof binding !== "object" ||
      !/^[a-z][a-z0-9_-]{0,31}$/.test(binding.alias) ||
      typeof binding.paneId !== "string" ||
      binding.paneId.length === 0 ||
      binding.workflowOwned !== true
    ) {
      throw new Error("invalid helper binding store");
    }
    const managedWorktree = binding.managedWorktree;
    if (
      binding.reuseRole !== undefined &&
      (typeof binding.reuseRole !== "string" || binding.reuseRole.trim().length === 0)
    ) {
      throw new Error("invalid helper binding store");
    }
    if (
      managedWorktree !== undefined &&
      (!managedWorktree ||
        typeof managedWorktree !== "object" ||
        typeof managedWorktree.workspaceId !== "string" ||
        managedWorktree.workspaceId.length === 0 ||
        typeof managedWorktree.path !== "string" ||
        managedWorktree.path.length === 0 ||
        typeof managedWorktree.branch !== "string" ||
        managedWorktree.branch.length === 0)
    ) {
      throw new Error("invalid helper binding store");
    }
    if (
      (binding.terminalId !== undefined &&
        (typeof binding.terminalId !== "string" || binding.terminalId.length === 0)) ||
      (binding.terminalId === undefined && managedWorktree === undefined)
    ) {
      throw new Error("invalid helper binding store");
    }
    return structuredClone(binding);
  });
}

function writeHelperBindings(path: string, bindings: HelperBinding[]): void {
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    writeFileSync(
      temporary,
      `${JSON.stringify({ version: 1, bindings } satisfies HelperBindingFile, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function helperBindingStorePath(sessionFile: string): string {
  return `${sessionFile}.pi-loom-bindings.json`;
}

export class HelperDirectory {
  readonly #bindings = new Map<string, HelperBinding>();
  #path: string | undefined;

  constructor(options: { path?: string } = {}) {
    if (options.path) this.attach(options.path);
  }

  attach(path: string | undefined): void {
    if (path === this.#path) return;
    this.#bindings.clear();
    this.#path = path;
    if (!path) return;
    for (const binding of parseHelperBindings(path)) {
      this.#bind(
        binding.alias,
        binding.paneId,
        binding.terminalId,
        binding.managedWorktree,
        binding.reuseRole,
        false,
      );
    }
  }

  bind(
    alias: string,
    paneId: string,
    terminalId: string,
    managedWorktree?: HelperBinding["managedWorktree"],
    reuseRole?: string,
  ): void {
    this.#bind(alias, paneId, terminalId, managedWorktree, reuseRole, true);
  }

  reserveManagedWorktree(
    alias: string,
    paneId: string,
    managedWorktree: NonNullable<HelperBinding["managedWorktree"]>,
    reuseRole?: string,
  ): void {
    this.#bind(alias, paneId, undefined, managedWorktree, reuseRole, false);
    this.#persist();
  }

  #bind(
    alias: string,
    paneId: string,
    terminalId: string | undefined,
    managedWorktree: HelperBinding["managedWorktree"],
    reuseRole: string | undefined,
    persist: boolean,
  ): void {
    if (reuseRole !== undefined && !reuseRole.trim()) {
      throw new Error("reuse role must not be blank");
    }
    const existing = this.#bindings.get(alias);
    if (existing && existing.paneId !== paneId) {
      throw new Error(`helper alias ${alias} is already bound`);
    }
    for (const binding of this.#bindings.values()) {
      if (binding.alias !== alias && binding.paneId === paneId) {
        throw new Error(`pane is already bound to ${binding.alias}`);
      }
    }
    const previous = this.#bindings.get(alias);
    this.#bindings.set(alias, {
      alias,
      paneId,
      ...(terminalId ? { terminalId } : {}),
      workflowOwned: true,
      ...(reuseRole ? { reuseRole } : {}),
      ...(managedWorktree ? { managedWorktree: structuredClone(managedWorktree) } : {}),
    });
    try {
      if (persist) this.#persist();
    } catch (error) {
      if (previous) this.#bindings.set(alias, previous);
      else this.#bindings.delete(alias);
      throw error;
    }
  }

  resolve(alias: string): HelperBinding | undefined {
    const binding = this.#bindings.get(alias);
    return binding ? structuredClone(binding) : undefined;
  }

  list(): HelperBinding[] {
    return [...this.#bindings.values()]
      .sort((left, right) => left.alias.localeCompare(right.alias))
      .map((binding) => structuredClone(binding));
  }

  remove(alias: string): void {
    const previous = this.#bindings.get(alias);
    if (!previous) return;
    this.#bindings.delete(alias);
    try {
      this.#persist();
    } catch (error) {
      this.#bindings.set(alias, previous);
      throw error;
    }
  }

  #persist(): void {
    if (!this.#path) return;
    writeHelperBindings(
      this.#path,
      [...this.#bindings.values()].sort((left, right) => left.alias.localeCompare(right.alias)),
    );
  }
}

type Rect = { width: number; height: number };
type Placement =
  | { kind: "sibling"; split: "right" | "down"; size: string; focusPreserved: true }
  | { kind: "workspace-tab"; size: string; focusPreserved: true }
  | {
      kind: "worktree";
      path: string;
      branch: string;
      size: string;
      focusPreserved: true;
    };
const HELPER_KICKOFF = "Execute the assignment provided in your system instructions.";

function writePromptContract(text: string): { path: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), "pi-herdr-contract-"));
  const path = join(directory, "contract.md");
  try {
    writeFileSync(path, text, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    path,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

export type SkillLaunchResult =
  | {
      kind: "started";
      helperAlias: string;
      agentStatus: string;
      placement: Placement;
      configuration: { model: string; thinking: string };
      presentation: { workstreamLabel: string; roleLabel: string };
    }
  | {
      kind: "rejected";
      helperAlias: string;
      code:
        | "CALLER_NOT_FOUND"
        | "HELPER_ALREADY_BOUND"
        | "UNUSABLE_LAYOUT"
        | "WORKSTREAM_LABEL_REQUIRED"
        | "WORKSTREAM_LABEL_CONFLICT"
        | "CHECKOUT_WORKSPACE_REQUIRED"
        | "LAUNCH_FAILED"
        | "DISCOVERY_UNAVAILABLE";
      reason: string;
    }
  | {
      kind: "reconcile";
      helperAlias: string;
      reason: string;
    };

export type SkillLaunchExecutorOptions = {
  herdr: SkillLaunchHerdrPort;
  directory: HelperDirectory;
  executionEnv?: Record<string, string>;
};

type SkillLaunchInput = {
  helperAlias: string;
  callerPaneId: string;
  callerCwd?: string;
  launch: CompiledPersistentHelperLaunch;
  reuseRole?: string;
  worktree?: { branch: string; base?: string; path?: string };
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function paneIdentity(
  snapshot: HerdrSnapshot,
  paneId: string,
):
  | {
      workspaceId: string;
      tabId: string;
    }
  | undefined {
  const pane = snapshot.panes.map(record).find((candidate) => candidate?.pane_id === paneId);
  return typeof pane?.workspace_id === "string" && typeof pane.tab_id === "string"
    ? { workspaceId: pane.workspace_id, tabId: pane.tab_id }
    : undefined;
}

function paneRect(snapshot: HerdrSnapshot, paneId: string): Rect | undefined {
  for (const value of snapshot.layouts) {
    const layout = record(value);
    if (!Array.isArray(layout?.panes)) continue;
    const pane = layout.panes.map(record).find((candidate) => candidate?.pane_id === paneId);
    const rect = record(pane?.rect);
    if (typeof rect?.width === "number" && typeof rect.height === "number") {
      return { width: rect.width, height: rect.height };
    }
  }
  return undefined;
}

function planSplit(rect: Rect): { split: "right" | "down"; rect: Rect } | undefined {
  const right = { width: Math.floor((rect.width - 1) / 2), height: rect.height };
  if (right.width >= 80 && right.height >= 24) return { split: "right", rect: right };
  const down = { width: rect.width, height: Math.floor((rect.height - 1) / 2) };
  return down.width >= 80 && down.height >= 24 ? { split: "down", rect: down } : undefined;
}

function focusMatches(before: HerdrSnapshot, after: HerdrSnapshot): boolean {
  return (
    before.focusedWorkspaceId === after.focusedWorkspaceId &&
    before.focusedTabId === after.focusedTabId &&
    before.focusedPaneId === after.focusedPaneId
  );
}

function checkoutPath(cwd: string): string | undefined {
  try {
    const root = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return root ? realpathSync(root) : undefined;
  } catch {
    return undefined;
  }
}

function workspaceCheckout(snapshot: HerdrSnapshot, workspaceId: string): string | undefined {
  const workspace = snapshot.workspaces
    .map(record)
    .find((candidate) => candidate?.workspace_id === workspaceId);
  const worktree = record(workspace?.worktree);
  if (typeof worktree?.checkout_path === "string") {
    try {
      return realpathSync(worktree.checkout_path);
    } catch {
      return undefined;
    }
  }
  const checkouts = new Set<string>();
  for (const pane of snapshot.panes.map(record)) {
    if (pane?.workspace_id !== workspaceId) continue;
    const cwd =
      typeof pane.foreground_cwd === "string"
        ? pane.foreground_cwd
        : typeof pane.cwd === "string"
          ? pane.cwd
          : undefined;
    const checkout = cwd ? checkoutPath(cwd) : undefined;
    if (checkout) checkouts.add(checkout);
  }
  return checkouts.size === 1 ? checkouts.values().next().value : undefined;
}

export class SkillLaunchExecutor {
  readonly #pendingAliases = new Set<string>();

  constructor(private readonly options: SkillLaunchExecutorOptions) {}

  async execute(input: SkillLaunchInput): Promise<SkillLaunchResult> {
    if (
      this.options.directory.resolve(input.helperAlias) ||
      this.#pendingAliases.has(input.helperAlias)
    ) {
      return {
        kind: "rejected",
        helperAlias: input.helperAlias,
        code: "HELPER_ALREADY_BOUND",
        reason: `helper alias ${input.helperAlias} is already bound`,
      };
    }
    this.#pendingAliases.add(input.helperAlias);
    try {
      return await this.#execute(input);
    } finally {
      this.#pendingAliases.delete(input.helperAlias);
    }
  }

  async #execute(input: SkillLaunchInput): Promise<SkillLaunchResult> {
    const before = await this.options.herdr.snapshot();
    const caller = paneIdentity(before, input.callerPaneId);
    if (!caller) {
      return {
        kind: "rejected",
        helperAlias: input.helperAlias,
        code: "CALLER_NOT_FOUND",
        reason: "caller pane is missing",
      };
    }

    const tab = before.tabs.map(record).find((candidate) => candidate?.tab_id === caller.tabId);
    let launch = input.launch;
    let managedWorktree:
      | { workspaceId: string; tabId: string; paneId: string; path: string; branch: string }
      | undefined;
    if (input.worktree) {
      const label = launch.internal.presentation.workstreamLabel;
      if (!label?.trim()) {
        return {
          kind: "rejected",
          helperAlias: input.helperAlias,
          code: "WORKSTREAM_LABEL_REQUIRED",
          reason: "managed worktree requires an explicit workstream label",
        };
      }
      try {
        managedWorktree = await this.options.herdr.createWorktree({
          cwd: launch.command.cwd,
          branch: input.worktree.branch,
          ...(input.worktree.base ? { base: input.worktree.base } : {}),
          ...(input.worktree.path ? { path: input.worktree.path } : {}),
          label,
        });
      } catch (error) {
        return {
          kind: "reconcile",
          helperAlias: input.helperAlias,
          reason: `managed worktree creation is unconfirmed: ${(error as Error).message}`,
        };
      }
      try {
        this.options.directory.reserveManagedWorktree(
          input.helperAlias,
          managedWorktree.paneId,
          {
            workspaceId: managedWorktree.workspaceId,
            path: managedWorktree.path,
            branch: managedWorktree.branch,
          },
          input.reuseRole,
        );
      } catch (error) {
        return {
          kind: "reconcile",
          helperAlias: input.helperAlias,
          reason: `managed worktree exists but lease persistence failed: ${(error as Error).message}`,
        };
      }
      launch = { ...launch, command: { ...launch.command, cwd: managedWorktree.path } };
    }
    const targetCheckout = checkoutPath(launch.command.cwd);
    const callerCheckout = checkoutPath(input.callerCwd ?? input.launch.command.cwd);
    const callerWorkspaceCheckout = workspaceCheckout(before, caller.workspaceId);
    const targetUsesCallerWorkspace = managedWorktree
      ? false
      : targetCheckout === undefined ||
        (callerWorkspaceCheckout
          ? callerWorkspaceCheckout === targetCheckout
          : callerCheckout === targetCheckout);
    const matchingWorkspaceIds =
      managedWorktree || targetUsesCallerWorkspace || !targetCheckout
        ? []
        : before.workspaces.flatMap((value) => {
            const workspace = record(value);
            return typeof workspace?.workspace_id === "string" &&
              workspaceCheckout(before, workspace.workspace_id) === targetCheckout
              ? [workspace.workspace_id]
              : [];
          });
    const targetWorkspaceId =
      managedWorktree?.workspaceId ??
      (targetUsesCallerWorkspace || !targetCheckout
        ? undefined
        : matchingWorkspaceIds.length === 1
          ? matchingWorkspaceIds[0]
          : undefined);
    if (!targetUsesCallerWorkspace && !targetWorkspaceId) {
      return {
        kind: "rejected",
        helperAlias: input.helperAlias,
        code: "CHECKOUT_WORKSPACE_REQUIRED",
        reason: `no Herdr workspace matches checkout ${targetCheckout}`,
      };
    }
    const liveWorkstream = typeof tab?.label === "string" ? tab.label : null;
    const requestedWorkstream = launch.internal.presentation.workstreamLabel;
    const independentWorkstream =
      input.callerCwd !== undefined &&
      targetUsesCallerWorkspace &&
      requestedWorkstream !== undefined &&
      liveWorkstream !== null &&
      !isStructurallyAmbiguousLabel(liveWorkstream) &&
      requestedWorkstream !== liveWorkstream &&
      !Object.prototype.hasOwnProperty.call(
        launch.internal.presentation,
        "expectedWorkstreamLabel",
      );
    const presentationInput = {
      ...(launch.internal.presentation.workstreamLabel
        ? { explicitLabel: launch.internal.presentation.workstreamLabel }
        : {}),
      ...(this.options.executionEnv?.PI_HERDR_WORKSTREAM_LABEL
        ? { inheritedLabel: this.options.executionEnv.PI_HERDR_WORKSTREAM_LABEL }
        : {}),
      liveLabel: targetUsesCallerWorkspace && !independentWorkstream ? liveWorkstream : null,
      ...(Object.prototype.hasOwnProperty.call(
        launch.internal.presentation,
        "expectedWorkstreamLabel",
      )
        ? { expectedLabel: launch.internal.presentation.expectedWorkstreamLabel }
        : {}),
    };
    const presentation = compileWorkstreamPresentation(presentationInput);
    if (presentation.kind === "rejected") {
      return {
        kind: "rejected",
        helperAlias: input.helperAlias,
        code: presentation.code,
        reason: presentation.reason,
      };
    }
    if (presentation.kind === "conflict") {
      return {
        kind: "rejected",
        helperAlias: input.helperAlias,
        code: presentation.code,
        reason: `requested workstream label conflicts with clear live label ${presentation.actualLabel}`,
      };
    }
    const workstreamLabel = presentation.label;

    const env: Record<string, string> = {
      ...this.options.executionEnv,
      PI_HERDR_TASK_ID: launch.internal.returnChannel.taskId,
      PI_HERDR_PARENT_PANE_ID: launch.internal.returnChannel.parentPaneId,
      PI_HERDR_CHILD_LABEL: launch.modelView.roleLabel,
      PI_HERDR_WORKSTREAM_LABEL: workstreamLabel,
    };
    if (launch.internal.returnChannel.coordinatorPaneId) {
      env.PI_HERDR_COORDINATOR_PANE_ID = launch.internal.returnChannel.coordinatorPaneId;
    }
    let target: PersistentLaunchInput["target"];
    let destinationTabId: string;
    let planned: ReturnType<typeof planSplit>;
    if (managedWorktree) {
      target = {
        kind: "existing",
        paneId: managedWorktree.paneId,
        tabId: managedWorktree.tabId,
      };
      destinationTabId = managedWorktree.tabId;
    } else if (targetUsesCallerWorkspace && !independentWorkstream) {
      const callerRect = paneRect(before, input.callerPaneId);
      planned = callerRect ? planSplit(callerRect) : undefined;
      if (!callerRect || !planned) {
        return {
          kind: "rejected",
          helperAlias: input.helperAlias,
          code: "UNUSABLE_LAYOUT",
          reason: callerRect
            ? `caller pane ${callerRect.width}x${callerRect.height} cannot retain two 80x24 panes`
            : "caller layout is missing",
        };
      }
      target = { kind: "split", paneId: input.callerPaneId, direction: planned.split };
      destinationTabId = caller.tabId;
    } else {
      let created;
      try {
        created = await this.options.herdr.createTab({
          workspaceId: independentWorkstream ? caller.workspaceId : targetWorkspaceId!,
          cwd: launch.command.cwd,
          label: workstreamLabel,
          env,
        });
      } catch (error) {
        return {
          kind: "reconcile",
          helperAlias: input.helperAlias,
          reason: `target checkout tab creation is unconfirmed: ${(error as Error).message}`,
        };
      }
      target = { kind: "existing", paneId: created.paneId, tabId: created.tabId };
      destinationTabId = created.tabId;
    }
    const promptContract = writePromptContract(launch.initialPrompt);
    const launchInput: PersistentLaunchInput = {
      name: input.helperAlias,
      argv: [...launch.command.argv, "--append-system-prompt", promptContract.path],
      cwd: launch.command.cwd,
      targetPaneId: input.callerPaneId,
      target,
      ...(target.kind === "split" ? { split: target.direction } : {}),
      roleLabel: launch.internal.presentation.roleLabel,
      ...(presentation.mutation ? { workstreamLabel } : {}),
      env,
    };
    let outcome: PersistentLaunchOutcome;
    try {
      outcome = await this.options.herdr.launchPersistent(launchInput);
    } catch (error) {
      promptContract.cleanup();
      throw error;
    }
    if (outcome.kind === "failed") {
      promptContract.cleanup();
      if (managedWorktree) {
        return {
          kind: "reconcile",
          helperAlias: input.helperAlias,
          reason: `managed worktree exists but helper launch failed: ${outcome.reason}`,
        };
      }
      return {
        kind: "rejected",
        helperAlias: input.helperAlias,
        code: "LAUNCH_FAILED",
        reason: outcome.reason,
      };
    }
    if (outcome.kind === "ambiguous") {
      return { kind: "reconcile", helperAlias: input.helperAlias, reason: outcome.reason };
    }

    try {
      this.options.directory.bind(
        input.helperAlias,
        outcome.paneId,
        outcome.terminalId,
        managedWorktree
          ? {
              workspaceId: managedWorktree.workspaceId,
              path: managedWorktree.path,
              branch: managedWorktree.branch,
            }
          : undefined,
        input.reuseRole,
      );
    } catch (error) {
      promptContract.cleanup();
      return {
        kind: "reconcile",
        helperAlias: input.helperAlias,
        reason: `helper started but workflow binding failed: ${(error as Error).message}`,
      };
    }
    let promptedStatus: string;
    try {
      const prompted = await this.options.herdr.promptAgent(
        input.helperAlias,
        HELPER_KICKOFF,
        ["working"],
        60_000,
      );
      promptedStatus = prompted.agentStatus;
    } catch (error) {
      if (error instanceof HerdrRpcError && error.code === "agent_prompt_stalled") {
        try {
          await this.options.herdr.sendPaneInput(outcome.paneId, { keys: ["enter"] });
          await this.options.herdr.waitAgentStatus(input.helperAlias, "working", 60_000);
          promptedStatus = "working";
        } catch (recoveryError) {
          return {
            kind: "reconcile",
            helperAlias: input.helperAlias,
            reason: `helper prompt was staged but submission recovery is unconfirmed: ${(recoveryError as Error).message}`,
          };
        }
      } else {
        return {
          kind: "reconcile",
          helperAlias: input.helperAlias,
          reason: `helper started but readiness or prompt submission is unconfirmed: ${(error as Error).message}`,
        };
      }
    } finally {
      promptContract.cleanup();
    }

    let after: HerdrSnapshot;
    try {
      after = await this.options.herdr.snapshot();
    } catch (error) {
      return {
        kind: "reconcile",
        helperAlias: input.helperAlias,
        reason: `helper started and prompted but presentation verification failed: ${(error as Error).message}`,
      };
    }
    const afterTab = after.tabs
      .map(record)
      .find((candidate) => candidate?.tab_id === destinationTabId);
    const afterPane = after.panes
      .map(record)
      .find((candidate) => candidate?.pane_id === outcome.paneId);
    if (
      afterTab?.label !== workstreamLabel ||
      afterPane?.label !== launch.internal.presentation.roleLabel
    ) {
      return {
        kind: "reconcile",
        helperAlias: input.helperAlias,
        reason:
          "helper launched but live workstream or role label does not match requested presentation",
      };
    }
    const actualRect = paneRect(after, outcome.paneId);
    if (
      !actualRect ||
      (target.kind === "split" && (actualRect.width < 80 || actualRect.height < 24))
    ) {
      return {
        kind: "reconcile",
        helperAlias: input.helperAlias,
        reason: "helper launched but verified geometry is unusable",
      };
    }
    if (!focusMatches(before, after)) {
      return {
        kind: "reconcile",
        helperAlias: input.helperAlias,
        reason: "helper launched but foreground context changed",
      };
    }

    return {
      kind: "started",
      helperAlias: input.helperAlias,
      agentStatus: promptedStatus,
      placement: {
        ...(managedWorktree
          ? {
              kind: "worktree" as const,
              path: managedWorktree.path,
              branch: managedWorktree.branch,
            }
          : target.kind === "split"
            ? { kind: "sibling" as const, split: target.direction }
            : { kind: "workspace-tab" as const }),
        size: `${actualRect.width}x${actualRect.height}`,
        focusPreserved: true,
      },
      configuration: structuredClone(launch.modelView.configuration),
      presentation: {
        workstreamLabel,
        roleLabel: launch.internal.presentation.roleLabel,
      },
    };
  }
}
