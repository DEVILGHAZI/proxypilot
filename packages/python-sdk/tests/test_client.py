import io
import json
import unittest
from urllib.error import HTTPError

from proxypilot import ProxyPilot, ProxyPilotError


class Response:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.payload


class ClientTests(unittest.TestCase):
    def test_sends_bearer_and_decodes_data(self):
        seen = {}

        def transport(request, *, timeout):
            seen["url"] = request.full_url
            seen["authorization"] = request.get_header("Authorization")
            seen["timeout"] = timeout
            return Response({"success": True, "requestId": "req_test", "data": {"providers": [{"id": "p1"}]}})

        client = ProxyPilot("pp_live_test", base_url="https://api.example.test/", timeout=4, transport=transport)
        self.assertEqual(client.providers(), [{"id": "p1"}])
        self.assertEqual(seen["url"], "https://api.example.test/api/v1/providers")
        self.assertEqual(seen["authorization"], "Bearer pp_live_test")
        self.assertEqual(seen["timeout"], 4)

    def test_encodes_request_submission(self):
        seen = {}

        def transport(request, *, timeout):
            seen["method"] = request.method
            seen["body"] = json.loads(request.data)
            return Response({"success": True, "requestId": "req_test", "data": {"request": {"id": "r1"}}})

        client = ProxyPilot("pp_live_test", transport=transport)
        result = client.submit_request("pool-1", "https://example.com/", method="POST", body="hello")
        self.assertEqual(result["id"], "r1")
        self.assertEqual(seen["method"], "POST")
        self.assertEqual(
            seen["body"],
            {"url": "https://example.com/", "method": "POST", "body": "hello"},
        )

    def test_raises_structured_api_error(self):
        payload = json.dumps(
            {
                "success": False,
                "requestId": "req_denied",
                "error": {"code": "FORBIDDEN", "message": "Owner required."},
            }
        ).encode()

        def transport(_request, *, timeout):
            raise HTTPError("https://api.example.test", 403, "Forbidden", {}, io.BytesIO(payload))

        client = ProxyPilot("pp_live_test", transport=transport)
        with self.assertRaises(ProxyPilotError) as caught:
            client.audit()
        self.assertEqual(caught.exception.code, "FORBIDDEN")
        self.assertEqual(caught.exception.status, 403)
        self.assertEqual(caught.exception.request_id, "req_denied")

    def test_filters_empty_query_values(self):
        seen = {}

        def transport(request, *, timeout):
            seen["url"] = request.full_url
            return Response({"success": True, "requestId": "req_test", "data": {"proxies": []}})

        client = ProxyPilot("pp_live_test", transport=transport)
        client.proxies(providerId=None, status="HEALTHY")
        self.assertEqual(seen["url"], "http://localhost:4000/api/v1/proxies?status=HEALTHY")


if __name__ == "__main__":
    unittest.main()
