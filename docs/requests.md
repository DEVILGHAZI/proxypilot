# Requests

The request engine is implemented. `POST /api/v1/pools/:id/requests` queues one HTTP call. The worker selects an eligible proxy, connects through it, and writes `RequestJob` plus `RequestAttempt` rows. The response body is discarded. Proxy credentials stay in worker memory for that connection.

The pool needs an enabled policy. `timeoutMs` bounds the attempt. `maxRetries` is the number of extra attempts after the first. `maxConcurrency` counts queued and running jobs for that policy. `requestsPerSecond` is a one-second Redis window, along with organization, user, API key, and domain windows.

Retryable results are timeouts, connection failures, proxy auth failure (`407`), `408`, `425`, `429`, and HTTP `5xx`. `401` and `403` finish the job. The first retry waits 200 ms. The delay doubles up to 8 seconds. A non-sticky retry prefers a different eligible proxy. A sticky session keeps its proxy while that proxy is eligible.

Targets must be public `http` or `https` URLs. Loopback, private, link-local, metadata names, encoded address forms, and DNS answers in those ranges are rejected before the fetch. Redirects are checked again, up to three hops. `SSRF_ALLOW_HOSTS` can name exact hosts for an internal lab and is empty by default.

Usage for finished jobs is stored on `UsageMeter` with metric `requests` for the UTC month. Jobs still queued or running after 10 minutes are marked `STALE`. Completed and failed jobs older than 30 days are deleted by the cleanup worker.
