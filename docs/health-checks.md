# Health checks

Active checks are implemented. The score model below is what the worker applies. Thresholds are `HEALTHY_SCORE_MIN` (70) and `DEGRADED_SCORE_MIN` (40).

## Status

| Status | Score |
| --- | --- |
| `HEALTHY` | `>= 70` |
| `DEGRADED` | `40` inclusive to `70` exclusive |
| `QUARANTINED` | `< 40` |
| `DISABLED` | operator override; excluded from selection and not auto-deleted |

## Score

Start at 100. Clamp every update to `0..100`. The database rejects scores outside that range.

| Event | Delta |
| --- | --- |
| Success | +2 |
| HTTP 5xx | -5 |
| Timeout | -15 |
| Connection failure | -20 |
| Repeated failure | extra −10 when the previous result was also a failure |

A bad score moves `HEALTHY` to `DEGRADED` to `QUARANTINED`. Rows are kept.

`avgLatencyMs` is an exponential moving average with weight 0.3. Every score write is clamped to `0..100`.

A target HTTP status below 500 counts as a successful proxy hop, including 3xx and 4xx. `407` is a connection failure. `401` and `403` do not by themselves quarantine a proxy. The probe URL is `HEALTH_CHECK_URL`, an operator setting, not a URL from the caller.

## Recovery

Quarantine sets `cooldownUntil`. The first window is `HEALTH_COOLDOWN_SECONDS` (60). Each failed recovery doubles that window up to `HEALTH_MAX_COOLDOWN_SECONDS` (3600). The recovery queue waits out the cooldown and probes again. The first success moves the proxy to `DEGRADED` and places the score in that band. Further successes can return it to `HEALTHY`.

`DISABLED` is an operator override. Checks may still be requested, and the score can change, but the status stays `DISABLED` and recovery does not select it. Enabling a proxy again sets the status from the current score.

## Worker

The worker consumes `health-check` at `HEALTH_CHECK_CONCURRENCY` (default 20) and `proxy-recovery` at most 10. Every `HEALTH_CHECK_INTERVAL_SECONDS` (60) it queues proxies in `HEALTHY` or `DEGRADED` whose last check is older than that interval, and it ensures quarantined proxies have a recovery job. Checks record `status`, `latencyMs`, `httpStatus`, `errorCode`, `errorMessage`, and `checkedAt` on `HealthCheck`.

Credentials are decrypted only for the probe and are not written to the check row or the log. Probe errors have userinfo removed.

`system.ping` still writes the worker heartbeat.
