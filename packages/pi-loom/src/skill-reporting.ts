import type { HerdrSnapshot } from "./herdr-adapter.ts";

export type SkillTerminalReport = {
  taskId: string;
  status: "COMPLETED" | "BLOCKED";
  outcome: string;
  durablePointers: string[];
  changed: string[];
  verification: string[];
  needNext: string;
  childPaneId: string;
  childLabel: string;
  workstreamLabel?: string;
  parentPaneId: string;
  coordinatorPaneId?: string;
};

export type SkillReportingPort = {
  snapshot: () => Promise<HerdrSnapshot>;
  deliverAgentPrompt: (paneId: string, text: string) => Promise<"accepted" | "missing">;
  showNotification: (input: { title: string; body: string; sound: "done" }) => Promise<void>;
};

export type SkillReportDeliveryResult = {
  delivered: "primary" | "fallback" | "notification";
  taskId: string;
  status: "COMPLETED" | "BLOCKED";
};

function list(values: string[]): string {
  return values.length === 0 ? "none" : values.join(", ");
}

export function formatSkillTerminalReport(report: SkillTerminalReport): string {
  return [
    `[Herdr child report][${report.taskId}][${report.status}]`,
    `Outcome: ${report.outcome}`,
    `Durable pointers: ${list(report.durablePointers)}`,
    `Changed: ${list(report.changed)}`,
    `Verification: ${list(report.verification)}`,
    `Need/next: ${report.needNext}`,
    `Child pane: ${report.childPaneId} (${report.childLabel}; workstream: ${report.workstreamLabel ?? "workstream"})`,
  ].join("\n");
}

export class SkillReportDelivery {
  constructor(private readonly options: { port: SkillReportingPort }) {}

  async deliver(report: SkillTerminalReport): Promise<SkillReportDeliveryResult> {
    const presentation = await this.#livePresentation(report);
    const text = formatSkillTerminalReport({ ...report, ...presentation });
    const primary = await this.options.port.deliverAgentPrompt(report.parentPaneId, text);
    if (primary === "accepted") return this.#result(report, "primary");

    if (report.coordinatorPaneId && report.coordinatorPaneId !== report.parentPaneId) {
      const fallback = await this.options.port.deliverAgentPrompt(report.coordinatorPaneId, text);
      if (fallback === "accepted") return this.#result(report, "fallback");
    }

    await this.options.port.showNotification({
      title: "Herdr child report ready",
      body: `${report.taskId} in ${report.childPaneId}`,
      sound: "done",
    });
    return this.#result(report, "notification");
  }

  async #livePresentation(report: SkillTerminalReport): Promise<{
    childLabel: string;
    workstreamLabel: string;
  }> {
    const fallback = {
      childLabel: report.childLabel,
      workstreamLabel: report.workstreamLabel ?? "workstream",
    };
    try {
      const snapshot = await this.options.port.snapshot();
      const pane = snapshot.panes
        .map(record)
        .find((candidate) => candidate?.pane_id === report.childPaneId);
      if (!pane || typeof pane.tab_id !== "string") return fallback;
      const tab = snapshot.tabs.map(record).find((candidate) => candidate?.tab_id === pane.tab_id);
      return {
        childLabel: nonBlank(pane.label) ?? fallback.childLabel,
        workstreamLabel: nonBlank(tab?.label) ?? fallback.workstreamLabel,
      };
    } catch {
      return fallback;
    }
  }

  #result(
    report: SkillTerminalReport,
    delivered: SkillReportDeliveryResult["delivered"],
  ): SkillReportDeliveryResult {
    return { delivered, taskId: report.taskId, status: report.status };
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
