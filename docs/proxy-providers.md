# Proxy providers

Phase 3 writes provider and proxy records. The tables were created in Phase 1 so ownership and encryption columns did not have to be retrofitted.

Providers are user-defined records. The product does not hard-code Bright Data, Oxylabs, Decodo, or any other vendor. A provider has a name, type (`DATACENTER`, `RESIDENTIAL`, `ISP`, `MOBILE`, `CUSTOM`), protocol (`HTTP`, `HTTPS`, `SOCKS5`), metadata, status, and an encrypted credentials column.

Proxy endpoints belong to a provider and an organization. Host, port, protocol, and optional location are stored in the clear. Usernames and passwords are stored only as ciphertext (`usernameEncrypted`, `passwordEncrypted`). AES-256-GCM helpers live in `@proxypilot/database`. The key is `ENCRYPTION_KEY`, 32 bytes of base64. Phase 3 is the first phase that writes those columns.

Import formats:

- `host:port`
- `username:password@host:port`
- CSV `host,port,username,password,protocol,country`

`ProxyProviderAdapter` (`getProxies`, `refreshProxies`, `getUsage`, `getBandwidth`) is the extension point for a provider's own API. No vendor adapter ships in this phase. List and detail responses do not return decrypted credentials. Health checks decrypt proxy credentials in the worker only long enough to open the probe.

Pools group proxies. A proxy can sit in more than one pool through `PoolProxy`, and can carry many tags through `ProxyTag`.
