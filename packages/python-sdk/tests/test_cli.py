import contextlib
import io
import json
import unittest
from unittest.mock import patch

from proxypilot.cli import main


class CliTests(unittest.TestCase):
    def test_requires_an_api_key_for_protected_commands(self):
        stderr = io.StringIO()
        with patch.dict("os.environ", {}, clear=True), contextlib.redirect_stderr(stderr):
            code = main(["providers"])
        self.assertEqual(code, 2)
        self.assertIn("PROXYPILOT_API_KEY", stderr.getvalue())

    def test_status_is_public_and_prints_json(self):
        stdout = io.StringIO()
        with patch("proxypilot.cli.ProxyPilot.ready", return_value={"status": "ready"}), contextlib.redirect_stdout(stdout):
            code = main(["status"])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(stdout.getvalue()), {"status": "ready"})

    def test_request_passes_command_arguments(self):
        stdout = io.StringIO()
        with (
            patch(
                "proxypilot.cli.ProxyPilot.submit_request",
                return_value={"id": "req-1", "status": "QUEUED"},
            ) as submit,
            contextlib.redirect_stdout(stdout),
        ):
            code = main(
                [
                    "--api-key",
                    "pp_live_test",
                    "request",
                    "pool-1",
                    "https://example.com/",
                    "--method",
                    "POST",
                    "--body",
                    "hello",
                ]
            )
        self.assertEqual(code, 0)
        submit.assert_called_once_with("pool-1", "https://example.com/", method="POST", body="hello")


if __name__ == "__main__":
    unittest.main()
