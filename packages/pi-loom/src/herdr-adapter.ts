export type HerdrRequestTransport = {
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>;
};

export const HERDR_PROTOCOL = 19;

export type HerdrTransportStage = "before-send" | "after-send";

export class HerdrTransportError extends Error {
  constructor(
    message: string,
    readonly stage: HerdrTransportStage,
  ) {
    super(message);
    this.name = "HerdrTransportError";
  }
}

export class HerdrRpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HerdrRpcError";
  }
}

export type HerdrSnapshot = {
  version: string;
  protocol: number;
  focusedWorkspaceId?: string;
  focusedTabId?: string;
  focusedPaneId?: string;
  workspaces: unknown[];
  tabs: unknown[];
  panes: unknown[];
  layouts: unknown[];
  agents: unknown[];
};

export type PersistentLaunchInput = {
  name: string;
  argv: string[];
  cwd: string;
  targetPaneId: string;
  target?:
    | { kind: "split"; paneId: string; direction: "right" | "down" }
    | { kind: "existing"; paneId: string; tabId: string };
  split?: "right" | "down";
  roleLabel: string;
  workstreamLabel?: string;
  env: Record<string, string>;
};

export type HerdrCreatedPane = {
  workspaceId: string;
  tabId: string;
  paneId: string;
};

export type HerdrCreatedWorktree = HerdrCreatedPane & {
  path: string;
  branch: string;
};

export type HerdrAgentView = {
  paneId: string;
  terminalId: string;
  agentStatus: string;
  interactiveReady: boolean;
  launchPending: boolean;
};

export type HerdrAgentStatus = "idle" | "working" | "blocked" | "done";

export type PersistentLaunchOutcome =
  | {
      kind: "started";
      paneId: string;
      terminalId: string;
      agentStatus: string;
    }
  | { kind: "failed"; reason: string }
  | { kind: "ambiguous"; reason: string };

export type HerdrAdapterOptions = {
  transport: HerdrRequestTransport;
  supportedProtocol: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  startupTimeoutMs?: number;
};

type PingResult = {
  type: "pong";
  version: string;
  protocol: number;
  capabilities?: unknown;
};

function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid Herdr ${context} response`);
  }
  return value as Record<string, unknown>;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function array(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`invalid Herdr ${context} response`);
  return value;
}

export class HerdrAdapter {
  #negotiation?: Promise<PingResult>;

  constructor(private readonly options: HerdrAdapterOptions) {}

  async snapshot(): Promise<HerdrSnapshot> {
    await this.#negotiate();
    const response = record(
      await this.options.transport.request("session.snapshot", {}),
      "session.snapshot",
    );
    if (response.type !== "session_snapshot") {
      throw new Error("invalid Herdr session.snapshot response type");
    }
    const snapshot = record(response.snapshot, "session.snapshot payload");
    if (
      typeof snapshot.version !== "string" ||
      typeof snapshot.protocol !== "number" ||
      snapshot.protocol !== this.options.supportedProtocol
    ) {
      throw new Error("invalid Herdr session.snapshot protocol metadata");
    }

    const result: HerdrSnapshot = {
      version: snapshot.version,
      protocol: snapshot.protocol,
      workspaces: array(snapshot.workspaces, "session.snapshot workspaces"),
      tabs: array(snapshot.tabs, "session.snapshot tabs"),
      panes: array(snapshot.panes, "session.snapshot panes"),
      layouts: array(snapshot.layouts, "session.snapshot layouts"),
      agents: array(snapshot.agents, "session.snapshot agents"),
    };
    const focusedWorkspaceId = stringOrUndefined(snapshot.focused_workspace_id);
    const focusedTabId = stringOrUndefined(snapshot.focused_tab_id);
    const focusedPaneId = stringOrUndefined(snapshot.focused_pane_id);
    if (focusedWorkspaceId) result.focusedWorkspaceId = focusedWorkspaceId;
    if (focusedTabId) result.focusedTabId = focusedTabId;
    if (focusedPaneId) result.focusedPaneId = focusedPaneId;
    return result;
  }

  async promptAgent(
    target: string,
    text: string,
    until?: HerdrAgentStatus[],
    timeoutMs?: number,
  ): Promise<HerdrAgentView> {
    await this.#negotiate();
    const params: Record<string, unknown> = { target, text };
    if (until || timeoutMs !== undefined) {
      params.wait = {
        ...(until ? { until: [...until] } : {}),
        ...(timeoutMs === undefined ? {} : { timeout_ms: timeoutMs }),
      };
    }
    const response = record(
      await this.options.transport.request("agent.prompt", params),
      "agent.prompt",
    );
    if (response.type !== "agent_prompted") {
      throw new Error("invalid Herdr agent.prompt response type");
    }
    return this.#agentView(response.agent, "agent.prompt");
  }

  async sendPaneInput(paneId: string, input: { text?: string; keys?: string[] }): Promise<void> {
    await this.#negotiate();
    const params: Record<string, unknown> = { pane_id: paneId };
    if (input.text !== undefined) params.text = input.text;
    if (input.keys !== undefined) params.keys = [...input.keys];
    const response = await this.options.transport.request("pane.send_input", params);
    this.#expectOk(response, "pane.send_input");
  }

  async deliverAgentPrompt(paneId: string, text: string): Promise<"accepted" | "missing"> {
    try {
      await this.promptAgent(paneId, text);
      return "accepted";
    } catch (error) {
      if (
        error instanceof HerdrRpcError &&
        ["agent_not_found", "agent_name_not_found", "pane_not_found"].includes(error.code)
      ) {
        return "missing";
      }
      throw error;
    }
  }

  async showNotification(input: {
    title: string;
    body: string;
    sound: "none" | "done" | "request";
  }): Promise<void> {
    await this.#negotiate();
    const response = record(
      await this.options.transport.request("notification.show", { ...input }),
      "notification.show",
    );
    if (response.type !== "notification_show" || response.shown !== true) {
      throw new Error("invalid Herdr notification.show response type");
    }
  }

  async waitAgentStatus(
    target: string,
    status: HerdrAgentStatus,
    timeoutMs: number,
  ): Promise<void> {
    await this.#waitAgent(target, [status], timeoutMs);
  }

  async waitAgentSettled(target: string, timeoutMs: number): Promise<void> {
    await this.#waitAgent(target, ["idle", "done"], timeoutMs);
  }

  async readRecent(paneId: string, lines = 120): Promise<string> {
    return this.#readPane(paneId, "recent_unwrapped", lines);
  }

  async readVisible(paneId: string): Promise<string> {
    return this.#readPane(paneId, "visible");
  }

  async closePane(paneId: string): Promise<void> {
    await this.#negotiate();
    const response = await this.options.transport.request("pane.close", { pane_id: paneId });
    this.#expectOk(response, "pane.close");
  }

  async renameTab(tabId: string, label: string): Promise<void> {
    await this.#negotiate();
    const response = record(
      await this.options.transport.request("tab.rename", { tab_id: tabId, label }),
      "tab.rename",
    );
    if (response.type !== "tab_info") throw new Error("invalid Herdr tab.rename response type");
    const tab = record(response.tab, "tab.rename tab");
    if (tab.tab_id !== tabId || tab.label !== label) {
      throw new Error("invalid Herdr tab.rename confirmation");
    }
  }

  async renamePane(paneId: string, label: string): Promise<void> {
    await this.#negotiate();
    const response = record(
      await this.options.transport.request("pane.rename", { pane_id: paneId, label }),
      "pane.rename",
    );
    if (response.type !== "pane_info") throw new Error("invalid Herdr pane.rename response type");
    const pane = record(response.pane, "pane.rename pane");
    if (pane.pane_id !== paneId || pane.label !== label) {
      throw new Error("invalid Herdr pane.rename confirmation");
    }
  }

  async getAgent(target: string): Promise<HerdrAgentView> {
    await this.#negotiate();
    const response = await this.options.transport.request("agent.get", { target });
    return this.#agentInfo(response, "agent.get");
  }

  async createWorktree(input: {
    cwd: string;
    branch: string;
    base?: string;
    path?: string;
    label: string;
  }): Promise<HerdrCreatedWorktree> {
    await this.#negotiate();
    const response = record(
      await this.options.transport.request("worktree.create", {
        cwd: input.cwd,
        branch: input.branch,
        ...(input.base ? { base: input.base } : {}),
        ...(input.path ? { path: input.path } : {}),
        label: input.label,
        focus: false,
      }),
      "worktree.create",
    );
    if (response.type !== "worktree_created") {
      throw new Error("invalid Herdr worktree.create response type");
    }
    const workspace = record(response.workspace, "worktree.create workspace");
    const workspaceWorktree = record(workspace.worktree, "worktree.create workspace worktree");
    const tab = record(response.tab, "worktree.create tab");
    const pane = record(response.root_pane, "worktree.create root pane");
    const worktree = record(response.worktree, "worktree.create worktree");
    if (
      typeof workspace.workspace_id !== "string" ||
      typeof tab.tab_id !== "string" ||
      tab.workspace_id !== workspace.workspace_id ||
      typeof pane.pane_id !== "string" ||
      pane.workspace_id !== workspace.workspace_id ||
      pane.tab_id !== tab.tab_id ||
      typeof worktree.path !== "string" ||
      worktree.path.length === 0 ||
      worktree.branch !== input.branch ||
      workspaceWorktree.checkout_path !== worktree.path
    ) {
      throw new Error("invalid Herdr worktree.create identity");
    }
    return {
      workspaceId: workspace.workspace_id,
      tabId: tab.tab_id,
      paneId: pane.pane_id,
      path: worktree.path,
      branch: input.branch,
    };
  }

  async removeWorktree(workspaceId: string, path: string): Promise<void> {
    await this.#negotiate();
    const response = record(
      await this.options.transport.request("worktree.remove", {
        workspace_id: workspaceId,
        force: false,
      }),
      "worktree.remove",
    );
    if (
      response.type !== "worktree_removed" ||
      response.workspace_id !== workspaceId ||
      response.path !== path ||
      response.forced !== false
    ) {
      throw new Error("invalid Herdr worktree.remove confirmation");
    }
  }

  async createTab(input: {
    workspaceId: string;
    cwd: string;
    label: string;
    env: Record<string, string>;
  }): Promise<HerdrCreatedPane> {
    await this.#negotiate();
    const response = record(
      await this.options.transport.request("tab.create", {
        workspace_id: input.workspaceId,
        cwd: input.cwd,
        label: input.label,
        focus: false,
        env: { ...input.env },
      }),
      "tab.create",
    );
    if (response.type !== "tab_created") {
      throw new Error("invalid Herdr tab.create response type");
    }
    const tab = record(response.tab, "tab.create tab");
    const pane = record(response.root_pane, "tab.create root pane");
    if (
      typeof tab.tab_id !== "string" ||
      tab.workspace_id !== input.workspaceId ||
      typeof pane.pane_id !== "string" ||
      pane.tab_id !== tab.tab_id ||
      pane.workspace_id !== input.workspaceId
    ) {
      throw new Error("invalid Herdr tab.create identity");
    }
    return { workspaceId: input.workspaceId, tabId: tab.tab_id, paneId: pane.pane_id };
  }

  async launchPersistent(input: PersistentLaunchInput): Promise<PersistentLaunchOutcome> {
    await this.#negotiate();
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(input.name)) {
      throw new Error("helper name must match Herdr agent name grammar");
    }
    if (input.argv[0] !== "pi") {
      throw new Error("persistent helper argv must start with pi");
    }

    let paneId: string;
    let tabId: string;
    const target = input.target ?? {
      kind: "split" as const,
      paneId: input.targetPaneId,
      direction: input.split ?? "right",
    };
    if (target.kind === "existing") {
      paneId = target.paneId;
      tabId = target.tabId;
    } else {
      let splitResponse: unknown;
      try {
        splitResponse = await this.options.transport.request("pane.split", {
          target_pane_id: target.paneId,
          direction: target.direction,
          cwd: input.cwd,
          focus: false,
          env: { ...input.env },
        });
      } catch (error) {
        if (error instanceof HerdrTransportError) {
          return {
            kind: error.stage === "after-send" ? "ambiguous" : "failed",
            reason: error.message,
          };
        }
        if (error instanceof HerdrRpcError) {
          return { kind: "failed", reason: error.message };
        }
        throw error;
      }
      try {
        const split = record(splitResponse, "pane.split");
        if (split.type !== "pane_info") throw new Error("invalid Herdr pane.split response type");
        const pane = record(split.pane, "pane.split pane");
        if (typeof pane.pane_id !== "string" || typeof pane.tab_id !== "string") {
          throw new Error("invalid Herdr pane.split pane identity");
        }
        paneId = pane.pane_id;
        tabId = pane.tab_id;
      } catch (error) {
        return {
          kind: "ambiguous",
          reason: `helper pane split may have succeeded but its identity is unconfirmed: ${(error as Error).message}`,
        };
      }
    }

    try {
      await this.renamePane(paneId, input.roleLabel);
      if (input.workstreamLabel) await this.renameTab(tabId, input.workstreamLabel);
    } catch (error) {
      return {
        kind: "ambiguous",
        reason: `helper pane exists but role or workstream presentation is unconfirmed: ${(error as Error).message}`,
      };
    }

    const params: Record<string, unknown> = {
      name: input.name,
      kind: "pi",
      pane_id: paneId,
      args: input.argv.slice(1),
      timeout_ms: 30_000,
    };

    const now = this.options.now ?? Date.now;
    const sleep = this.options.sleep ?? defaultSleep;
    const deadline = now() + (this.options.startupTimeoutMs ?? 30_000);
    let agent: HerdrAgentView;
    while (true) {
      try {
        const response = record(
          await this.options.transport.request("agent.start", params),
          "agent.start",
        );
        if (response.type !== "agent_started") {
          throw new Error("invalid Herdr agent.start response type");
        }
        agent = this.#agentView(response.agent, "agent.start");
        if (agent.paneId !== paneId) {
          return {
            kind: "ambiguous",
            reason: "helper agent started in a different pane than the confirmed target",
          };
        }
        break;
      } catch (error) {
        if (
          error instanceof HerdrRpcError &&
          ["agent_pane_busy", "agent_pane_unavailable"].includes(error.code) &&
          now() < deadline
        ) {
          await sleep(100);
          continue;
        }
        return {
          kind: "ambiguous",
          reason: `helper shell pane exists but agent startup is unconfirmed: ${(error as Error).message}`,
        };
      }
    }

    const startedTerminalId = agent.terminalId;
    while (!agent.interactiveReady) {
      if (!agent.launchPending) {
        return {
          kind: "ambiguous",
          reason: "helper process exited before interactive readiness could be confirmed",
        };
      }
      if (now() >= deadline) {
        return {
          kind: "ambiguous",
          reason: "helper startup timed out before interactive readiness could be confirmed",
        };
      }
      await sleep(100);
      try {
        agent = await this.getAgent(input.name);
      } catch (error) {
        return {
          kind: "ambiguous",
          reason: `helper startup reconciliation failed: ${(error as Error).message}`,
        };
      }
      if (agent.terminalId !== startedTerminalId) {
        return {
          kind: "ambiguous",
          reason: "helper name resolved to a different terminal during startup",
        };
      }
      if (agent.paneId !== paneId) {
        return {
          kind: "ambiguous",
          reason: "helper name resolved to a different pane during startup",
        };
      }
    }
    return {
      kind: "started",
      paneId: agent.paneId,
      terminalId: agent.terminalId,
      agentStatus: agent.agentStatus,
    };
  }

  async #readPane(
    paneId: string,
    source: "visible" | "recent_unwrapped",
    lines?: number,
  ): Promise<string> {
    await this.#negotiate();
    const params: Record<string, unknown> = {
      pane_id: paneId,
      source,
      format: "text",
      strip_ansi: true,
    };
    if (lines !== undefined) params.lines = lines;
    const response = record(await this.options.transport.request("pane.read", params), "pane.read");
    if (response.type !== "pane_read") throw new Error("invalid Herdr pane.read response type");
    const read = record(response.read, "pane.read payload");
    if (typeof read.text !== "string") throw new Error("invalid Herdr pane.read text");
    return read.text;
  }

  #expectOk(response: unknown, context: string): void {
    const result = record(response, context);
    if (result.type !== "ok") throw new Error(`invalid Herdr ${context} response type`);
  }

  #agentInfo(response: unknown, context: string): HerdrAgentView {
    const result = record(response, context);
    if (result.type !== "agent_info") throw new Error(`invalid Herdr ${context} response type`);
    return this.#agentView(result.agent, context);
  }

  #agentView(value: unknown, context: string): HerdrAgentView {
    const agent = record(value, `${context} agent`);
    if (
      typeof agent.pane_id !== "string" ||
      typeof agent.terminal_id !== "string" ||
      typeof agent.agent_status !== "string"
    ) {
      throw new Error(`invalid Herdr ${context} agent identity`);
    }
    return {
      paneId: agent.pane_id,
      terminalId: agent.terminal_id,
      agentStatus: agent.agent_status,
      interactiveReady: agent.interactive_ready === true,
      launchPending: agent.launch_pending === true,
    };
  }

  async #waitAgent(
    target: string,
    until: HerdrAgentStatus[],
    timeoutMs: number,
  ): Promise<HerdrAgentView> {
    await this.#negotiate();
    const response = await this.options.transport.request("agent.wait", {
      target,
      until: [...until],
      timeout_ms: timeoutMs,
    });
    return this.#agentInfo(response, "agent.wait");
  }

  async #negotiate(): Promise<PingResult> {
    if (!this.#negotiation) {
      this.#negotiation = (async () => {
        const response = record(await this.options.transport.request("ping", {}), "ping");
        if (
          response.type !== "pong" ||
          typeof response.version !== "string" ||
          typeof response.protocol !== "number"
        ) {
          throw new Error("invalid Herdr ping response");
        }
        if (response.protocol !== this.options.supportedProtocol) {
          throw new Error(
            `unsupported Herdr protocol ${response.protocol}; expected ${this.options.supportedProtocol}`,
          );
        }
        return response as PingResult;
      })();
    }
    return this.#negotiation;
  }
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
