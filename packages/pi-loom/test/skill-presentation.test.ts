import assert from "node:assert/strict";
import test from "node:test";
import { compileWorkstreamPresentation } from "../src/skill-presentation.ts";

test("clear live workstream label requires expected match before replacement", () => {
  assert.deepEqual(
    compileWorkstreamPresentation({ explicitLabel: "auth-expiry", liveLabel: "user-auth" }),
    {
      kind: "conflict",
      code: "WORKSTREAM_LABEL_CONFLICT",
      requestedLabel: "auth-expiry",
      actualLabel: "user-auth",
    },
  );
  assert.equal(
    compileWorkstreamPresentation({
      explicitLabel: "auth-expiry",
      liveLabel: "user-auth",
      expectedLabel: "user-auth",
    }).kind,
    "ready",
  );
});

test("ambiguous live labels may receive explicit workstream", () => {
  for (const liveLabel of ["1", "terminal", "Tab 2", "pane-3", "default"]) {
    assert.equal(
      compileWorkstreamPresentation({ explicitLabel: "auth-expiry", liveLabel }).kind,
      "ready",
    );
  }
  assert.equal(compileWorkstreamPresentation({ liveLabel: "terminal" }).kind, "rejected");
});

test("workstream resolution uses explicit, inherited, then clear live label", () => {
  assert.deepEqual(
    compileWorkstreamPresentation({
      explicitLabel: "explicit-auth",
      inheritedLabel: "inherited-auth",
    }),
    {
      kind: "ready",
      label: "explicit-auth",
      source: "explicit",
      mutation: { expectedLabel: null, label: "explicit-auth" },
    },
  );
  assert.equal(compileWorkstreamPresentation({ inheritedLabel: "inherited-auth" }).kind, "ready");
  assert.equal(compileWorkstreamPresentation({ liveLabel: "live-auth" }).kind, "ready");
  assert.equal(compileWorkstreamPresentation({}).kind, "rejected");
});
