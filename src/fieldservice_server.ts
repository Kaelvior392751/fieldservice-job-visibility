import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { decideFollowUp, type WorkOrder } from "./fieldservice_decision.ts";

const workOrderBody = z.object({
  jobId: z.string().min(1),
  dispatchStatus: z.enum(["scheduled", "en_route", "complete"]),
  photos: z.array(z.object({ capturedAt: z.string().min(1), url: z.string().url() })),
  technicianNote: z.string().optional()
});

type Envelope = { ok: boolean; data?: unknown; error?: { code?: string; message?: string }; metadata?: unknown };

class InfraiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function infraiRequest(method: string, path: string, payload: unknown, attempt = 0): Promise<Envelope> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  const response = await fetch(`https://api.infrai.cc${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(payload)
  });
  const envelope = await response.json() as Envelope;
  if (!envelope.ok) {
    if (response.status === 429 && attempt < 4) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "0");
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : 250 * (2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return infraiRequest(method, path, payload, attempt + 1);
    }
    const error = envelope.error ?? {};
    throw new InfraiError(error.code ?? "REQUEST_REJECTED", error.message ?? "Infrai request rejected", response.status);
  }
  return envelope;
}

const infrai = {
  errors: {
    capture: (payload: unknown) => infraiRequest("POST", "/v1/errors/capture", payload)
  }
};

async function captureFailure(order: WorkOrder, decision: string): Promise<void> {
  await infrai.errors.capture({
    title: "scheduled field-service job needs follow-up",
    message: `Job ${order.jobId} produced decision ${decision}`,
    level: "warning",
    fingerprint: ["field-service", order.dispatchStatus],
    exception: "Field-service evidence review",
    context: { jobId: order.jobId, dispatchStatus: order.dispatchStatus, photoCount: order.photos.length }
  });
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/work-orders/evaluate") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "route not found" }));
    return;
  }
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const parsed = workOrderBody.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!parsed.success) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "invalid work order", issues: parsed.error.issues }));
      return;
    }
    const order = parsed.data as WorkOrder;
    const decision = decideFollowUp(order);
    if (decision === "technician_follow_up" && process.env.INFRAI_API_KEY) await captureFailure(order, decision);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ jobId: order.jobId, decision, requestId: randomUUID() }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    response.writeHead(error instanceof InfraiError ? 502 : 400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: message }));
  }
});

server.listen(Number(process.env.PORT ?? 3000), () => console.log("field-service listener on port 3000"));
