# SDK and CLI

Phase 9 adds a Python 3.11+ client and a terminal command. Both call the same `/api/v1` routes documented by `GET /openapi.json`.

## Install for local development

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e packages/python-sdk
```

The package has no runtime dependencies outside the Python standard library.

## Python

```python
from proxypilot import ProxyPilot

client = ProxyPilot(
    api_key="pp_live_...",
    base_url="http://localhost:4000",
)

selection = client.select("pool_id")
job = client.submit_request("pool_id", "https://example.com/")
detail = client.request(job["id"])
```

`ProxyPilotError` provides `code`, `status`, and `request_id`. Provider and proxy responses follow the API and never expose stored credentials.

## Terminal

Keep the key in an environment variable so it does not become part of a command:

```bash
export PROXYPILOT_BASE_URL=http://localhost:4000
export PROXYPILOT_API_KEY=pp_live_...

proxypilot me
proxypilot providers
proxypilot proxies --status HEALTHY
proxypilot pools
proxypilot policies
proxypilot select pool_id
proxypilot request pool_id https://example.com/
proxypilot requests --limit 10
proxypilot request-get request_id
proxypilot health --limit 10
proxypilot check proxy_id
proxypilot analytics --hours 24
proxypilot audit --limit 20
```

`proxypilot status` and `proxypilot version` do not require an API key. Output is JSON so shell scripts can pass it to tools such as `jq`.
