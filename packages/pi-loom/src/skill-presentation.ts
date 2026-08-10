export type WorkstreamPresentationResult =
  | {
      kind: "ready";
      label: string;
      source: "explicit" | "inherited" | "live";
      mutation?: { expectedLabel: string | null; label: string };
    }
  | {
      kind: "conflict";
      code: "WORKSTREAM_LABEL_CONFLICT";
      requestedLabel: string;
      actualLabel: string | null;
    }
  | {
      kind: "rejected";
      code: "WORKSTREAM_LABEL_REQUIRED";
      reason: string;
    };

function nonBlank(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function isStructurallyAmbiguousLabel(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized || /^\d+$/.test(normalized)) return true;
  return /^(?:default|terminal|shell|pane|tab)(?:\s*[-#:]?\s*\d+)?$/.test(normalized);
}

export function compileWorkstreamPresentation(input: {
  explicitLabel?: string;
  inheritedLabel?: string;
  liveLabel?: string | null;
  expectedLabel?: string | null;
}): WorkstreamPresentationResult {
  const explicit = nonBlank(input.explicitLabel);
  const inherited = nonBlank(input.inheritedLabel);
  const live = nonBlank(input.liveLabel);
  const clearLive = live && !isStructurallyAmbiguousLabel(live) ? live : undefined;
  const label = explicit ?? inherited ?? clearLive;
  const source = explicit
    ? ("explicit" as const)
    : inherited
      ? ("inherited" as const)
      : ("live" as const);
  if (!label) {
    return {
      kind: "rejected",
      code: "WORKSTREAM_LABEL_REQUIRED",
      reason:
        "workstream label is unavailable from explicit input, inherited environment, or clear live tab",
    };
  }

  const actualLabel = live ?? null;
  const hasExpected = Object.prototype.hasOwnProperty.call(input, "expectedLabel");
  if (hasExpected && input.expectedLabel !== actualLabel) {
    return {
      kind: "conflict",
      code: "WORKSTREAM_LABEL_CONFLICT",
      requestedLabel: label,
      actualLabel,
    };
  }
  if (label === actualLabel) return { kind: "ready", label, source };
  if (actualLabel !== null && !hasExpected && !isStructurallyAmbiguousLabel(actualLabel)) {
    return {
      kind: "conflict",
      code: "WORKSTREAM_LABEL_CONFLICT",
      requestedLabel: label,
      actualLabel,
    };
  }
  return {
    kind: "ready",
    label,
    source,
    mutation: { expectedLabel: actualLabel, label },
  };
}
