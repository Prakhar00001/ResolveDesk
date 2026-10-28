"""Shared demo access gate and response security policy (no auth dependencies)."""
import base64
import binascii
import os
from secrets import compare_digest

from starlette.responses import JSONResponse


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
}
CHALLENGE = 'Basic realm="ResolveDesk", charset="UTF-8"'


def access_credentials():
    production = os.getenv("APP_ENV", "").lower() == "production"
    password = os.getenv("APP_ACCESS_PASSWORD")
    if production and (password is None or len(password) < 16):
        raise RuntimeError("Production requires APP_ACCESS_PASSWORD of at least 16 characters")
    if password is None:
        return None
    username = os.getenv("APP_ACCESS_USERNAME", "reviewer")
    if not password or not username or ":" in username:
        raise RuntimeError("APP_ACCESS_USERNAME and APP_ACCESS_PASSWORD must be valid Basic credentials")
    return username.encode("utf-8"), password.encode("utf-8")


class AccessMiddleware:
    def __init__(self, app, credentials):
        self.app = app
        self.credentials = credentials

    def authorized(self, scope):
        headers = [value for key, value in scope["headers"] if key.lower() == b"authorization"]
        if len(headers) != 1:
            return False
        parts = headers[0].split()
        if len(parts) != 2 or parts[0].lower() != b"basic":
            return False
        try:
            decoded = base64.b64decode(parts[1], validate=True)
        except (binascii.Error, ValueError):
            return False
        username, separator, password = decoded.partition(b":")
        if not separator:
            return False
        expected_username, expected_password = self.credentials
        # Evaluate both byte comparisons, even when the username does not match.
        return compare_digest(username, expected_username) & compare_digest(password, expected_password)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def secure_send(message):
            if message["type"] == "http.response.start":
                names = {name.lower().encode("ascii") for name in SECURITY_HEADERS}
                message = {
                    **message,
                    "headers": [
                        (name, value) for name, value in message.get("headers", [])
                        if name.lower() not in names
                    ] + [(name.lower().encode("ascii"), value.encode("ascii"))
                         for name, value in SECURITY_HEADERS.items()],
                }
            await send(message)

        public_health = scope["path"] == "/healthz" and scope["method"] in {"GET", "HEAD"}
        if self.credentials is not None and not public_health and not self.authorized(scope):
            response = JSONResponse(
                {"detail": "Authentication required"}, status_code=401,
                headers={"WWW-Authenticate": CHALLENGE},
            )
            await response(scope, receive, secure_send)
            return
        await self.app(scope, receive, secure_send)
