from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

JsonObject = dict[str, Any]
Transport = Callable[..., Any]


@dataclass(slots=True)
class ProxyPilotError(Exception):
    message: str
    code: str = "CLIENT_ERROR"
    status: int = 0
    request_id: str | None = None

    def __str__(self) -> str:
        detail = f"{self.code}: {self.message}"
        return f"{detail} ({self.request_id})" if self.request_id else detail


class ProxyPilot:
    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str = "http://localhost:4000",
        timeout: float = 30.0,
        transport: Transport = urlopen,
    ) -> None:
        if not base_url.startswith(("http://", "https://")):
            raise ValueError("base_url must use http or https")
        if timeout <= 0:
            raise ValueError("timeout must be positive")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._transport = transport

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: JsonObject | None = None,
        query: JsonObject | None = None,
    ) -> JsonObject:
        url = f"{self.base_url}{path}"
        if query:
            values = {key: value for key, value in query.items() if value is not None}
            if values:
                url = f"{url}?{urlencode(values)}"
        headers = {"accept": "application/json", "user-agent": "proxypilot-python/0.1.0"}
        if self.api_key:
            headers["authorization"] = f"Bearer {self.api_key}"
        encoded = None
        if body is not None:
            headers["content-type"] = "application/json"
            encoded = json.dumps(body).encode("utf-8")
        request = Request(url, data=encoded, headers=headers, method=method)
        try:
            with self._transport(request, timeout=self.timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            try:
                payload = json.loads(error.read().decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                raise ProxyPilotError("The API returned an unreadable error.", status=error.code) from error
            self._raise_api_error(payload, error.code)
        except URLError as error:
            raise ProxyPilotError(str(error.reason), code="CONNECTION_ERROR") from error
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ProxyPilotError("The API returned invalid JSON.", code="INVALID_RESPONSE") from error
        if not isinstance(payload, dict):
            raise ProxyPilotError("The API returned an invalid envelope.", code="INVALID_RESPONSE")
        if payload.get("success") is not True or not isinstance(payload.get("data"), dict):
            self._raise_api_error(payload, 0)
        return payload["data"]

    @staticmethod
    def _raise_api_error(payload: object, status: int) -> None:
        if isinstance(payload, dict):
            error = payload.get("error")
            if isinstance(error, dict):
                raise ProxyPilotError(
                    str(error.get("message", "Request failed.")),
                    code=str(error.get("code", "API_ERROR")),
                    status=status,
                    request_id=str(payload["requestId"]) if payload.get("requestId") else None,
                )
        raise ProxyPilotError("The API returned an invalid error envelope.", code="INVALID_RESPONSE", status=status)

    def health(self) -> JsonObject:
        return self._request("GET", "/health")

    def ready(self) -> JsonObject:
        return self._request("GET", "/ready")

    def version(self) -> JsonObject:
        return self._request("GET", "/api/v1")

    def me(self) -> JsonObject:
        return self._request("GET", "/api/v1/auth/me")

    def providers(self) -> list[JsonObject]:
        return self._request("GET", "/api/v1/providers")["providers"]

    def create_provider(
        self,
        *,
        name: str,
        provider_type: str,
        protocol: str,
        username: str | None = None,
        password: str | None = None,
        metadata: JsonObject | None = None,
    ) -> JsonObject:
        body: JsonObject = {"name": name, "type": provider_type, "protocol": protocol}
        if username is not None:
            body["username"] = username
        if password is not None:
            body["password"] = password
        if metadata is not None:
            body["metadata"] = metadata
        return self._request("POST", "/api/v1/providers", body=body)["provider"]

    def proxies(self, **filters: str | None) -> list[JsonObject]:
        return self._request("GET", "/api/v1/proxies", query=filters)["proxies"]

    def create_proxy(
        self,
        *,
        provider_id: str,
        host: str,
        port: int,
        protocol: str | None = None,
        username: str | None = None,
        password: str | None = None,
        tag_names: list[str] | None = None,
    ) -> JsonObject:
        body: JsonObject = {"providerId": provider_id, "host": host, "port": port}
        optional = {
            "protocol": protocol,
            "username": username,
            "password": password,
            "tagNames": tag_names,
        }
        body.update({key: value for key, value in optional.items() if value is not None})
        return self._request("POST", "/api/v1/proxies", body=body)["proxy"]

    def pools(self) -> list[JsonObject]:
        return self._request("GET", "/api/v1/pools")["pools"]

    def policies(self) -> list[JsonObject]:
        return self._request("GET", "/api/v1/policies")["policies"]

    def select(self, pool_id: str) -> JsonObject:
        return self._request("POST", f"/api/v1/pools/{pool_id}/select")["selection"]

    def submit_request(
        self,
        pool_id: str,
        url: str,
        *,
        method: str = "GET",
        body: str | None = None,
    ) -> JsonObject:
        payload: JsonObject = {"url": url, "method": method}
        if body is not None:
            payload["body"] = body
        return self._request("POST", f"/api/v1/pools/{pool_id}/requests", body=payload)["request"]

    def requests(self, *, limit: int = 20) -> list[JsonObject]:
        return self._request("GET", "/api/v1/requests", query={"limit": limit})["requests"]

    def request(self, request_id: str) -> JsonObject:
        return self._request("GET", f"/api/v1/requests/{request_id}")

    def health_checks(self, *, proxy_id: str | None = None, limit: int = 20) -> list[JsonObject]:
        return self._request(
            "GET",
            "/api/v1/health",
            query={"proxyId": proxy_id, "limit": limit},
        )["checks"]

    def check_proxy(self, proxy_id: str) -> JsonObject:
        return self._request("POST", f"/api/v1/proxies/{proxy_id}/check")

    def analytics(self, *, hours: int = 24) -> JsonObject:
        return self._request("GET", "/api/v1/analytics", query={"hours": hours})["analytics"]

    def audit(self, *, limit: int = 50) -> list[JsonObject]:
        return self._request("GET", "/api/v1/audit", query={"limit": limit})["events"]
