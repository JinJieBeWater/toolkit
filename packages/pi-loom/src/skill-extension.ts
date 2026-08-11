import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Type, type Static } from "typebox";
import { HERDR_PROTOCOL, HerdrAdapter } from "./herdr-adapter.ts";
import { NodeHerdrSocketTransport } from "./herdr-socket-transport.ts";
import { compilePersistentHelperLaunch, type PiThinking } from "./skill-launch.ts";
import {
  SkillHelperDiscovery,
  type HelperContextView,
  type HelperDiscoveryPort,
} from "./skill-discovery.ts";
import {
  HelperDirectory,
  SkillLaunchExecutor,
  helperBindingStorePath,
  type SkillLaunchResult,
} from "./skill-launch-executor.ts";
import { SkillReportDelivery, type SkillReportDeliveryResult } from "./skill-reporting.ts";
import { SkillRetirementExecutor, type SkillRetirementResult } from "./skill-retirement.ts";

export type SkillExtensionEnvironment = Record<string, string | undefined>;

export function childExecutionEnv(env: SkillExtensionEnvironment): Record<string, string> {
  const child: Record<string, string> = {};
  for (const key of [
    "PATH",
    "PI_CODING_AGENT_DIR",
    "HOME",
    "PI_LOOM_EXTENSION_PATH",
    "PI_HERDR_WORKSTREAM_LABEL",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
  ] as const) {
    const value = env[key];
    if (value) child[key] = value;
  }
  return child;
}

type LaunchExecutorPort = {
  execute: (input: Parameters<SkillLaunchExecutor["execute"]>[0]) => Promise<SkillLaunchResult>;
};
type ReportingPort = {
  deliver: (
    input: Parameters<SkillReportDelivery["deliver"]>[0],
  ) => Promise<SkillReportDeliveryResult>;
};
type RetirementPort = {
  retire: (
    input: Parameters<SkillRetirementExecutor["retire"]>[0],
  ) => Promise<SkillRetirementResult>;
};
type ExistingHelperResult = {
  kind: "existing-helper";
  helperAlias: string;
  helper: HelperContextView;
  guidance: "Reuse existing helper or choose another name";
};
type ReportArtifact = {
  path: string;
  cleanup: () => Promise<void>;
};
export type LoomExtensionOptions = {
  env?: SkillExtensionEnvironment;
  extensionPath?: string;
  helperDirectory?: HelperDirectory;
  launchExecutor?: LaunchExecutorPort;
  reporting?: ReportingPort;
  reportArtifactWriter?: (details: string) => Promise<ReportArtifact>;
  retirement?: RetirementPort;
  discovery?: HelperDiscoveryPort;
};

function attachHelperDirectory(
  directory: HelperDirectory,
  ctx: Pick<ExtensionContext, "sessionManager">,
): void {
  const sessionFile = ctx.sessionManager?.getSessionFile();
  directory.attach(sessionFile ? helperBindingStorePath(sessionFile) : undefined);
}

const thinkingSchema = Type.Union([
  Type.Literal("off"),
  Type.Literal("minimal"),
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("xhigh"),
  Type.Literal("max"),
]);

const checkoutSchema = Type.Union([
  Type.Object({ kind: Type.Literal("current") }),
  Type.Object({ kind: Type.Literal("existing"), path: Type.String({ minLength: 1 }) }),
  Type.Object({
    kind: Type.Literal("worktree"),
    branch: Type.String({ minLength: 1 }),
    base: Type.Optional(Type.String({ minLength: 1 })),
    path: Type.Optional(Type.String({ minLength: 1 })),
  }),
]);

type CheckoutRequest = Static<typeof checkoutSchema>;

const DEFAULT_DESCENDANTS =
  "May delegate within the assigned workstream and approved access boundary; remains responsible for descendant integration and settlement.";
const MAX_REPORT_DETAILS_LENGTH = 1_048_576;

async function writeReportArtifact(details: string): Promise<ReportArtifact> {
  const directory = await mkdtemp(join(resolve(tmpdir()), "pi-loom-report-"));
  try {
    await chmod(directory, 0o700);
    const path = join(directory, "report.md");
    await writeFile(path, details, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await chmod(path, 0o600);
    return {
      path,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export function registerLoomExtension(pi: ExtensionAPI, options: LoomExtensionOptions = {}): void {
  const env = options.env ?? process.env;
  const paneId = env.HERDR_PANE_ID;
  if (env.HERDR_ENV !== "1" || !paneId) return;

  let adapter: HerdrAdapter | undefined;
  const herdr = (): HerdrAdapter => {
    if (adapter) return adapter;
    const socketPath = env.HERDR_SOCKET_PATH;
    if (!socketPath) throw new Error("HERDR_SOCKET_PATH is required for Pi Loom mechanics");
    adapter = new HerdrAdapter({
      transport: new NodeHerdrSocketTransport({ socketPath }),
      supportedProtocol: HERDR_PROTOCOL,
    });
    return adapter;
  };
  const directory = options.helperDirectory ?? new HelperDirectory();
  const launchExecutor =
    options.launchExecutor ??
    new SkillLaunchExecutor({
      herdr: herdr(),
      directory,
      executionEnv: childExecutionEnv(env),
    });
  const reporting = options.reporting ?? new SkillReportDelivery({ port: herdr() });
  const reportArtifactWriter = options.reportArtifactWriter ?? writeReportArtifact;
  const retirement =
    options.retirement ?? new SkillRetirementExecutor({ herdr: herdr(), directory });
  const discovery = options.discovery ?? new SkillHelperDiscovery({ herdr: herdr(), directory });
  const childRole = Boolean(env.PI_HERDR_PARENT_PANE_ID && env.PI_HERDR_TASK_ID);
  const reportDeliveries = new Map<
    "COMPLETED" | "BLOCKED",
    Promise<{ result: SkillReportDeliveryResult; artifactPath?: string }>
  >();

  const startPersistent = async (
    input: {
      name: string;
      workstream?: string;
      role: string;
      task: string;
      access: "read" | "write";
      files: string[];
      writeApproved?: boolean;
      deliverable: string;
      keep: boolean;
      descendants: string;
      model?: string;
      thinking?: PiThinking;
      checkout: CheckoutRequest;
      callerCwd: string;
    },
    ctx: Pick<ExtensionContext, "sessionManager">,
  ): Promise<SkillLaunchResult | ExistingHelperResult> => {
    attachHelperDirectory(directory, ctx);
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(input.name)) {
      throw new Error("name must match Herdr agent name grammar");
    }
    if (input.access === "write" && input.writeApproved !== true) {
      throw new Error("write launch requires explicit user approval for the file boundary");
    }
    const discovered = await discovery.discover(input.name);
    if (discovered.kind === "unavailable") {
      return {
        kind: "rejected",
        helperAlias: input.name,
        code: "DISCOVERY_UNAVAILABLE",
        reason: "global helper discovery is unavailable before launch",
      };
    }
    const existing = discovered.helpers.find(
      (helper) =>
        helper.name === input.name &&
        (helper.relation === "owned" || helper.relation === "external"),
    );
    if (existing) {
      return {
        kind: "existing-helper",
        helperAlias: input.name,
        helper: existing,
        guidance: "Reuse existing helper or choose another name",
      };
    }
    const scope =
      input.access === "read"
        ? { access: "read-only" as const, allowedFiles: input.files }
        : {
            access: "write" as const,
            allowedFiles: input.files,
            userApproval: { confirmed: true as const },
          };
    const extensionPath = options.extensionPath ?? env.PI_LOOM_EXTENSION_PATH;
    const cwd = input.checkout.kind === "existing" ? input.checkout.path : input.callerCwd;
    const launch = compilePersistentHelperLaunch({
      ...(input.workstream ? { workstreamLabel: input.workstream } : {}),
      roleLabel: input.role,
      cwd,
      ...(extensionPath ? { extensionPath } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.thinking ? { thinking: input.thinking } : {}),
      objective: input.task,
      scope,
      returnChannel: {
        taskId: input.name,
        parentPaneId: paneId,
        durableResult: input.deliverable,
        coordinatorPaneId: env.PI_HERDR_COORDINATOR_PANE_ID ?? paneId,
      },
      reuse: input.keep
        ? { kind: "retain", role: input.role }
        : { kind: "retire-after-integration" },
      descendantResponsibilities: input.descendants,
    });
    try {
      return await launchExecutor.execute({
        helperAlias: input.name,
        callerPaneId: paneId,
        callerCwd: input.callerCwd,
        launch,
        ...(input.keep ? { reuseRole: input.role } : {}),
        ...(input.checkout.kind === "worktree"
          ? {
              worktree: {
                branch: input.checkout.branch,
                ...(input.checkout.base ? { base: input.checkout.base } : {}),
                ...(input.checkout.path ? { path: input.checkout.path } : {}),
              },
            }
          : {}),
      });
    } catch {
      return {
        kind: "reconcile",
        helperAlias: input.name,
        reason: "Loom start state is unconfirmed; inspect live state before retry",
      };
    }
  };

  const startResult = (result: SkillLaunchResult | ExistingHelperResult) => {
    if (result.kind === "started") {
      return {
        content: [{ type: "text" as const, text: `Helper ${result.helperAlias} started` }],
        details: result,
      };
    }
    if (result.kind === "existing-helper") {
      return {
        content: [
          {
            type: "text" as const,
            text: `Helper ${result.helperAlias} already exists; ${result.guidance.toLowerCase()}`,
          },
        ],
        details: result,
      };
    }
    const details =
      result.kind === "rejected"
        ? { kind: result.kind, helperAlias: result.helperAlias, code: result.code }
        : { kind: result.kind, helperAlias: result.helperAlias };
    return {
      content: [
        {
          type: "text" as const,
          text:
            result.kind === "rejected"
              ? `Helper ${result.helperAlias} rejected: ${result.code}`
              : `Helper ${result.helperAlias} reconcile; inspect live state`,
        },
      ],
      details,
    };
  };

  const deliverReport = (input: {
    status: "COMPLETED" | "BLOCKED";
    outcome: string;
    durablePointers: string[];
    changed: string[];
    verification: string[];
    needNext: string;
  }) =>
    reporting.deliver({
      taskId: env.PI_HERDR_TASK_ID!,
      ...input,
      childPaneId: paneId,
      childLabel: env.PI_HERDR_CHILD_LABEL ?? "helper",
      ...(env.PI_HERDR_WORKSTREAM_LABEL ? { workstreamLabel: env.PI_HERDR_WORKSTREAM_LABEL } : {}),
      parentPaneId: env.PI_HERDR_PARENT_PANE_ID!,
      ...(env.PI_HERDR_COORDINATOR_PANE_ID
        ? { coordinatorPaneId: env.PI_HERDR_COORDINATOR_PANE_ID }
        : {}),
    });

  if (childRole) {
    pi.registerTool({
      name: "loom_report",
      label: "Loom Report",
      description: "Return one verified result to the direct Pi Loom owner",
      parameters: Type.Object({
        status: Type.Union([Type.Literal("COMPLETED"), Type.Literal("BLOCKED")]),
        summary: Type.String({ minLength: 1 }),
        details: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_REPORT_DETAILS_LENGTH })),
        pointers: Type.Array(Type.String()),
        changed: Type.Array(Type.String()),
        checks: Type.Array(Type.String(), { minItems: 1 }),
        next: Type.String({ minLength: 1 }),
      }),
      async execute(_toolCallId, params) {
        const existing = reportDeliveries.get(params.status);
        if (existing) {
          await existing;
          return {
            content: [{ type: "text" as const, text: "Report already delivered" }],
            details: { delivered: "duplicate", taskId: env.PI_HERDR_TASK_ID },
          };
        }
        const delivery = (async () => {
          const artifact = params.details ? await reportArtifactWriter(params.details) : undefined;
          try {
            const result = await deliverReport({
              status: params.status,
              outcome: params.summary,
              durablePointers: artifact ? [...params.pointers, artifact.path] : params.pointers,
              changed: params.changed,
              verification: params.checks,
              needNext: params.next,
            });
            return { result, ...(artifact ? { artifactPath: artifact.path } : {}) };
          } catch (error) {
            await artifact?.cleanup();
            throw error;
          }
        })();
        reportDeliveries.set(params.status, delivery);
        let delivered: { result: SkillReportDeliveryResult; artifactPath?: string };
        try {
          delivered = await delivery;
        } catch (error) {
          if (reportDeliveries.get(params.status) === delivery) {
            reportDeliveries.delete(params.status);
          }
          throw error;
        }
        return {
          content: [
            {
              type: "text" as const,
              text: delivered.artifactPath
                ? `Report delivered through ${delivered.result.delivered}\nArtifact: ${delivered.artifactPath}`
                : `Report delivered through ${delivered.result.delivered}`,
            },
          ],
          details: delivered.artifactPath
            ? { ...delivered.result, artifactPath: delivered.artifactPath }
            : delivered.result,
        };
      },
    });
  }

  pi.registerTool({
    name: "loom_start",
    label: "Loom Start",
    description: "Start one persistent Pi helper in a current, existing, or managed checkout",
    parameters: Type.Object({
      name: Type.String({ pattern: "^[a-z][a-z0-9_-]{0,31}$" }),
      task: Type.String({ minLength: 1 }),
      checkout: Type.Optional(checkoutSchema),
      workstream: Type.String({ minLength: 1 }),
      role: Type.Optional(Type.String({ minLength: 1 })),
      access: Type.Union([Type.Literal("read"), Type.Literal("write")]),
      files: Type.Array(Type.String(), { minItems: 1 }),
      writeApproved: Type.Optional(Type.Boolean({ default: false })),
      deliverable: Type.Optional(Type.String({ minLength: 1 })),
      keep: Type.Optional(Type.Boolean({ default: false })),
      model: Type.Optional(Type.String()),
      thinking: Type.Optional(thinkingSchema),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return startResult(
        await startPersistent(
          {
            name: params.name,
            workstream: params.workstream,
            role: params.role ?? "helper",
            task: params.task,
            access: params.access,
            files: params.files,
            ...(params.writeApproved === undefined ? {} : { writeApproved: params.writeApproved }),
            deliverable: params.deliverable ?? "child transcript",
            keep: params.keep ?? false,
            descendants:
              params.access === "read"
                ? "Do not launch descendants; ask the parent to route additional work."
                : DEFAULT_DESCENDANTS,
            ...(params.model ? { model: params.model } : {}),
            ...(params.thinking ? { thinking: params.thinking as PiThinking } : {}),
            checkout: (params.checkout ?? { kind: "current" }) as CheckoutRequest,
            callerCwd: ctx.cwd,
          },
          ctx,
        ),
      );
    },
  });

  pi.registerTool({
    name: "loom_close",
    label: "Loom Close",
    description: "Retain or close one Pi Loom helper after owner integration",
    parameters: Type.Object({
      name: Type.String({ pattern: "^[a-z][a-z0-9_-]{0,31}$" }),
      integrated: Type.Boolean(),
      evidence: Type.Boolean(),
      settled: Type.Boolean(),
      pending: Type.Boolean(),
      service: Type.Boolean(),
      keep: Type.Optional(Type.Boolean({ default: false })),
      release: Type.Optional(Type.Boolean({ default: false })),
      execute: Type.Optional(Type.Boolean({ default: false })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      attachHelperDirectory(directory, ctx);
      const discovered = await discovery.discover(params.name);
      const binding = directory.resolve(params.name);
      if (discovered.kind === "unavailable" && binding) {
        const result: SkillRetirementResult = {
          helperAlias: params.name,
          action: "reconcile",
          reasons: ["discovery-unavailable"],
        };
        return {
          content: [{ type: "text" as const, text: `Helper ${params.name}: reconcile` }],
          details: result,
        };
      }
      const helper =
        discovered.kind === "available"
          ? discovered.helpers.find(
              (candidate) => candidate.name === params.name && candidate.relation === "owned",
            )
          : undefined;
      const missing =
        discovered.kind === "available" &&
        discovered.helpers.some(
          (candidate) => candidate.name === params.name && candidate.relation === "missing",
        );
      if (missing) {
        const result: SkillRetirementResult = {
          helperAlias: params.name,
          action: "reconcile",
          reasons: ["helper-live-identity-missing"],
        };
        return {
          content: [{ type: "text" as const, text: `Helper ${params.name}: reconcile` }],
          details: result,
        };
      }
      if (!helper) {
        const result: SkillRetirementResult = {
          helperAlias: params.name,
          action: "not-owned",
          reasons: ["helper-not-owned-by-current-session"],
        };
        return {
          content: [{ type: "text" as const, text: `Helper ${params.name}: not-owned` }],
          details: result,
        };
      }
      const reuseRole = binding?.reuseRole;
      if (params.keep || (reuseRole && params.release !== true)) {
        const result = {
          helperAlias: params.name,
          action: "retain" as const,
          reasons: [params.keep ? "requested-reuse" : `sticky-retention:${reuseRole}`],
        };
        return {
          content: [{ type: "text" as const, text: `Helper ${params.name}: retain` }],
          details: result,
        };
      }
      const result = await retirement.retire({
        helperAlias: params.name,
        callerPaneId: paneId,
        semanticEvidence: {
          reportIntegrated: params.integrated,
          durableEvidence: params.evidence,
          pendingApproval: params.pending,
          pendingUserInput: params.pending,
          queuedFollowup: params.pending,
          runningService: params.service,
          unresolvedBlocker: params.pending,
          descendantsSettled: params.settled,
        },
        execute: params.execute ?? false,
      });
      return {
        content: [
          { type: "text" as const, text: `Helper ${result.helperAlias}: ${result.action}` },
        ],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "loom_status",
    label: "Loom Status",
    description: "Show persistent Pi Loom helpers without exposing Herdr identities",
    parameters: Type.Object({
      name: Type.Optional(Type.String({ pattern: "^[a-z][a-z0-9_-]{0,31}$" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      attachHelperDirectory(directory, ctx);
      const discovered = await discovery.discover(params.name);
      const helpers = discovered.kind === "available" ? discovered.helpers : [];
      return {
        content: [
          {
            type: "text" as const,
            text:
              discovered.kind === "unavailable"
                ? "Helper discovery unavailable"
                : helpers.length === 0
                  ? "No persistent Pi Loom helpers"
                  : helpers
                      .map(
                        (helper) =>
                          `${helper.name ?? "unnamed"}: ${helper.state} (${helper.relation}; ${helper.ownership}; ${helper.control}; ${helper.checkout ?? "none"})`,
                      )
                      .join("\n"),
          },
        ],
        details:
          discovered.kind === "available" ? { helpers } : { helpers, discovery: "unavailable" },
      };
    },
  });
}

export default registerLoomExtension;
