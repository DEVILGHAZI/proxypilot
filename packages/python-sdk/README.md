# ProxyPilot Python SDK

The SDK uses only the Python standard library and supports Python 3.11 or newer.

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e packages/python-sdk
```

```python
from proxypilot import ProxyPilot

client = ProxyPilot(
    api_key="pp_live_...",
    base_url="http://localhost:4000",
)

for pool in client.pools():
    print(pool["id"], pool["name"])

job = client.submit_request("pool_id", "https://example.com/")
print(job["id"])
```

The client exposes providers, proxies, pools, policies, selection, request submission and history, health checks, analytics, and audit events. `ProxyPilotError` carries the API error code, HTTP status, and request ID.

## CLI

Set the API origin and API key in the environment:

```bash
export PROXYPILOT_BASE_URL=http://localhost:4000
export PROXYPILOT_API_KEY=pp_live_...

proxypilot pools
proxypilot select pool_id
proxypilot request pool_id https://example.com/
proxypilot requests --limit 10
```

`proxypilot status` and `proxypilot version` are public. Other commands require an API key. The CLI never writes the key to its output.
