export type FollowUp = "technician_follow_up" | "close_job";

export type WorkOrder = {
  jobId: string;
  dispatchStatus: "scheduled" | "en_route" | "complete";
  photos: Array<{ capturedAt: string; url: string }>;
  technicianNote?: string;
};

export function decideFollowUp(order: WorkOrder): FollowUp {
  const hasPhoto = order.photos.length > 0;
  const completedWithoutEvidence = order.dispatchStatus === "complete" && !hasPhoto;
  const needsHumanReview = order.dispatchStatus === "scheduled" && Boolean(order.technicianNote);
  return completedWithoutEvidence || needsHumanReview ? "technician_follow_up" : "close_job";
}
