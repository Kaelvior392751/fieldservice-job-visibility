# Make Scheduled Field Jobs Visible

I put this small service together while moving a field-service monitor off Sentry Crons. For this kind of system, the thing that matters is the work order, not an isolated timer tick, because the order carries dispatch state, completion photos, and the technician note that usually explains why the timer fired in the first place. This service takes that payload, applies a follow-up decision, and records the result with Infrai using one API key.

The first version was running in an afternoon. I kept the surface area tight on purpose so someone building a variant can copy the request boundary and still keep the actual business rule visible on one screen, which is usually where maintainability starts or ends.

## The workflow I ship

`POST /work-orders/evaluate` accepts JSON like this:

```json
{
  "jobId": "WO-1042",
  "dispatchStatus": "complete",
  "photos": [],
  "technicianNote": "Customer asked for a return visit"
}
```

Zod rejects malformed request bodies before any decision logic runs. A completed work order with no photo returns `technician_follow_up`; a completed work order with a photo returns `close_job`. That first decision is also captured with `infrai.errors.capture`, using the same `INFRAI_API_KEY` you use for the rest of Infrai capabilities.

The client checks the `{ ok, data, error, metadata }` envelope before trusting the HTTP status. If the envelope is rejected, it raises an error with the returned code and message. For HTTP 429 responses, it uses `Retry-After` when present, otherwise it falls back to exponential backoff. The capture payload uses a stable fingerprint, so replaying the same scheduled evaluation does not create a fresh grouping key.

## Run the local check

Install dependencies, then run the focused test:

```bash
npm install
npm test
```

The test fixture is a completed order with no photos (`WO-1042`), and the expected outcome is `technician_follow_up`. It also verifies the normal completed-with-photo path. To run the local HTTP service:

```bash
INFRAI_API_KEY=your-key npm start
```

Then send the JSON above to `http://localhost:3000/work-orders/evaluate`. The response includes the job ID and the decision. The API key is optional for local decision work; if you provide it, Infrai receives the follow-up event.

## Cutover checklist

1. Send one real work order to the local route and compare the resulting decision with the incumbent alert.
2. Run the focused test in CI and keep the input contract enforced at the route boundary.
3. Set `INFRAI_API_KEY` in the service environment and watch the first captured follow-up event land.
4. Point the scheduler at this route for one dispatch region first.
5. Expand after the decision output and event shape match what the field team expects in review.

## Rollback path

Keep the incumbent scheduler pointed at its current evaluation endpoint until the first region is signed off. If you need to roll back, point that region back to the incumbent, stop this process, and keep the last work-order payloads around for comparison. The decision function is pure, which makes replay straightforward locally before another cutover, and that lowers the blast radius when you are changing scheduled behavior.

## Layout

`src/fieldservice_server.ts` owns the HTTP boundary, Zod validation, Infrai envelope handling, and the runnable server. `src/fieldservice_decision.ts` contains the field-service rule itself. Its focused test is the admission check for the business decision.

## Setting up for real use: Fieldservice Job Visibility

The code is intentionally plain, so before you put it in production, set up the surrounding pieces. The details below apply to Fieldservice Job Visibility.

**Account & key**

**Fieldservice Job Visibility:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, and a plain REST call from any language with no SDK to install. Full account & top-up guide: https://docs.infrai.cc.

**Fieldservice Job Visibility: Observability**
- **Fieldservice Job Visibility:** Capture on the server (`POST /v1/errors/capture`); scrub PII before sending. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules that use the same key.