import test from "node:test";
import assert from "node:assert/strict";
import { decideFollowUp } from "./fieldservice_decision.ts";

test("completed job without a work-order photo is sent to technician follow-up", () => {
  const decision = decideFollowUp({
    jobId: "WO-1042",
    dispatchStatus: "complete",
    photos: []
  });
  assert.equal(decision, "technician_follow_up");
});

test("completed job with a photo can be closed", () => {
  const decision = decideFollowUp({
    jobId: "WO-1043",
    dispatchStatus: "complete",
    photos: [{ capturedAt: "2026-10-24T09:00:00Z", url: "https://example.com/photo.jpg" }]
  });
  assert.equal(decision, "close_job");
});
