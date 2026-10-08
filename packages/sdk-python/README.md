# ProxyPilot Python SDK

The Python client is scheduled for Phase 9.

Phase 1 does not ship a client. When it lands, the intended surface is:

```python
from proxypilot import ProxyPilot

client = ProxyPilot(api_key="...")
response = client.request("https://example.com", policy="production")
```

Sticky sessions will be available through `client.session()`. The client will call the public HTTP API. It will not embed proxy credentials or bypass target access controls.
