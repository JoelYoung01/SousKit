"""Idle sessions and passkey ceremonies.

Run: uv run python -m unittest api.tests.test_access_model
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

# Point the API at a throwaway database before any settings import.
_DB = tempfile.NamedTemporaryFile(prefix="souskit-access-", suffix=".db", delete=False)
_DB.close()
os.environ["SQLITE_FILE_NAME"] = _DB.name
os.environ.setdefault("VITE_GOOGLE_CLIENT_ID", "test-google-client")
os.environ.setdefault("SUPERUSER_GID", "test-superuser")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-access-model")
os.environ.setdefault("ENVIRONMENT", "development")

import cbor2  # noqa: E402
import jwt  # noqa: E402
from cryptography.hazmat.primitives import hashes  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import Session, select  # noqa: E402
from webauthn.helpers import bytes_to_base64url  # noqa: E402

from api.core.config import settings  # noqa: E402
from api.core.database import engine  # noqa: E402
from api.core.security import hash_password  # noqa: E402
from api.main import app  # noqa: E402
from api.models import BaseDbModel, Passkey, Token, TokenType, User  # noqa: E402

BaseDbModel.metadata.create_all(engine)

_ORIGIN = f"https://{settings.WEBAUTHN_RP_ID}"
_EMAIL = "ada@example.com"
_PASSWORD = "password123"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _exp(token: str) -> datetime:
    payload = jwt.decode(
        token,
        settings.SECRET_KEY,
        algorithms=[settings.HASH_ALGORITHM],
        options={"verify_exp": False},
    )
    return datetime.fromtimestamp(payload["exp"], tz=timezone.utc)


def _client_data(kind: str, challenge: str) -> bytes:
    return json.dumps(
        {"type": kind, "challenge": challenge, "origin": _ORIGIN},
        separators=(",", ":"),
    ).encode()


class _SoftPasskey:
    """Minimal platform authenticator with a 'none' attestation."""

    def __init__(self) -> None:
        self._key = ec.generate_private_key(ec.SECP256R1())
        self.credential_id = os.urandom(32)
        numbers = self._key.public_key().public_numbers()
        self._cose = cbor2.dumps(
            {
                1: 2,
                3: -7,
                -1: 1,
                -2: numbers.x.to_bytes(32, "big"),
                -3: numbers.y.to_bytes(32, "big"),
            }
        )

    def registration(self, challenge: str) -> dict:
        rp_hash = hashlib.sha256(settings.WEBAUTHN_RP_ID.encode()).digest()
        flags = 0x01 | 0x04 | 0x40  # UP, UV, AT
        auth_data = (
            rp_hash
            + bytes([flags])
            + (0).to_bytes(4, "big")
            + (b"\x00" * 16)
            + len(self.credential_id).to_bytes(2, "big")
            + self.credential_id
            + self._cose
        )
        attestation = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})
        client = _client_data("webauthn.create", challenge)
        cred = bytes_to_base64url(self.credential_id)
        return {
            "id": cred,
            "rawId": cred,
            "type": "public-key",
            "response": {
                "clientDataJSON": bytes_to_base64url(client),
                "attestationObject": bytes_to_base64url(attestation),
                "transports": ["internal"],
            },
            "clientExtensionResults": {},
            "authenticatorAttachment": "platform",
        }

    def assertion(self, challenge: str, sign_count: int) -> dict:
        rp_hash = hashlib.sha256(settings.WEBAUTHN_RP_ID.encode()).digest()
        flags = 0x01 | 0x04  # UP, UV
        auth_data = rp_hash + bytes([flags]) + sign_count.to_bytes(4, "big")
        client = _client_data("webauthn.get", challenge)
        signature = self._key.sign(
            auth_data + hashlib.sha256(client).digest(),
            ec.ECDSA(hashes.SHA256()),
        )
        cred = bytes_to_base64url(self.credential_id)
        return {
            "id": cred,
            "rawId": cred,
            "type": "public-key",
            "response": {
                "clientDataJSON": bytes_to_base64url(client),
                "authenticatorData": bytes_to_base64url(auth_data),
                "signature": bytes_to_base64url(signature),
                "userHandle": bytes_to_base64url((1).to_bytes(8, "big")),
            },
            "clientExtensionResults": {},
            "authenticatorAttachment": "platform",
        }


class AccessModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(app)
        with Session(engine) as session:
            session.add(
                User(
                    username=_EMAIL,
                    email=_EMAIL,
                    display_name="Ada",
                    hashed_password=hash_password(_PASSWORD),
                    email_verified=True,
                    admin=False,
                    disabled=False,
                )
            )
            session.commit()

    def setUp(self) -> None:
        settings.ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * settings.SESSION_IDLE_DAYS

    def _login(self) -> str:
        response = self.client.post(
            "/api/auth/login/", json={"email": _EMAIL, "password": _PASSWORD}
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["access_token"]

    def test_idle_window_is_thirty_days_and_use_resets_it(self) -> None:
        self.assertEqual(settings.SESSION_IDLE_DAYS, 30)
        settings.ACCESS_TOKEN_EXPIRE_MINUTES = 5
        short = self._login()
        short_exp = _exp(short)
        self.assertLess(short_exp, datetime.now(tz=timezone.utc) + timedelta(minutes=6))

        settings.ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 30
        refreshed = self.client.get("/api/auth/verify-session/", headers=_auth(short))
        self.assertEqual(refreshed.status_code, 200, refreshed.text)
        fresh = refreshed.json()["access_token"]
        self.assertNotEqual(fresh, short)
        fresh_exp = _exp(fresh)
        now = datetime.now(tz=timezone.utc)
        self.assertGreater(fresh_exp, now + timedelta(days=29))
        self.assertLess(fresh_exp, now + timedelta(days=31))
        self.assertGreater(fresh_exp, short_exp + timedelta(days=20))

        # The token the app was still holding stays valid for in-flight calls.
        again = self.client.get("/api/auth/verify-session/", headers=_auth(short))
        self.assertEqual(again.status_code, 200, again.text)

    def test_expired_or_unknown_token_is_rejected(self) -> None:
        with Session(engine) as session:
            user = session.exec(select(User).where(User.email == _EMAIL)).one()
            expired = jwt.encode(
                {
                    "user_id": user.id,
                    "email": user.email,
                    "exp": datetime.now(tz=timezone.utc) - timedelta(minutes=1),
                },
                settings.SECRET_KEY,
                algorithm=settings.HASH_ALGORITHM,
            )
            session.add(
                Token(
                    user_id=user.id,
                    access_token=expired,
                    token_type=TokenType.Access,
                )
            )
            session.commit()

        rejected = self.client.get("/api/auth/verify-session/", headers=_auth(expired))
        self.assertEqual(rejected.status_code, 401)

        token = self._login()
        with Session(engine) as session:
            row = session.exec(select(Token).where(Token.access_token == token)).one()
            session.delete(row)
            session.commit()
        missing = self.client.get("/api/household/", headers=_auth(token))
        self.assertEqual(missing.status_code, 401)

    def test_passkey_registers_and_signs_in_with_face_id_credential(self) -> None:
        token = self._login()
        options = self.client.post(
            "/api/auth/passkeys/register/options/", headers=_auth(token)
        )
        self.assertEqual(options.status_code, 200, options.text)
        challenge = options.json()["challenge"]
        self.assertEqual(options.json()["rp"]["id"], settings.WEBAUTHN_RP_ID)
        self.assertEqual(
            options.json()["authenticatorSelection"]["userVerification"], "required"
        )

        authenticator = _SoftPasskey()
        registered = self.client.post(
            "/api/auth/passkeys/register/verify/",
            headers=_auth(token),
            json=authenticator.registration(challenge),
        )
        self.assertEqual(registered.status_code, 200, registered.text)
        passkey_id = registered.json()["id"]

        listed = self.client.get("/api/auth/passkeys/", headers=_auth(token))
        self.assertEqual(listed.status_code, 200)
        self.assertEqual([row["id"] for row in listed.json()], [passkey_id])

        login_options = self.client.post("/api/auth/passkeys/login/options/")
        self.assertEqual(login_options.status_code, 200, login_options.text)
        assertion = authenticator.assertion(
            login_options.json()["challenge"], sign_count=1
        )
        signed_in = self.client.post("/api/auth/passkeys/login/verify/", json=assertion)
        self.assertEqual(signed_in.status_code, 200, signed_in.text)
        self.assertTrue(signed_in.json()["access_token"])
        self.assertEqual(signed_in.json()["user"]["email"], _EMAIL)

        replay = self.client.post("/api/auth/passkeys/login/options/")
        replay_body = authenticator.assertion(replay.json()["challenge"], sign_count=1)
        rejected = self.client.post(
            "/api/auth/passkeys/login/verify/", json=replay_body
        )
        self.assertEqual(rejected.status_code, 401)

        again = self.client.post("/api/auth/passkeys/login/options/")
        ok = self.client.post(
            "/api/auth/passkeys/login/verify/",
            json=authenticator.assertion(again.json()["challenge"], sign_count=2),
        )
        self.assertEqual(ok.status_code, 200, ok.text)

        removed = self.client.delete(
            f"/api/auth/passkeys/{passkey_id}/", headers=_auth(token)
        )
        self.assertEqual(removed.status_code, 204)
        with Session(engine) as session:
            self.assertIsNone(session.get(Passkey, passkey_id))

    def test_aasa_advertises_webcredentials(self) -> None:
        response = self.client.get("/.well-known/apple-app-site-association")
        self.assertEqual(response.status_code, 200)
        self.assertIn("webcredentials", response.json())
        self.assertIn("apps", response.json()["webcredentials"])


if __name__ == "__main__":
    unittest.main()
