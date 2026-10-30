"""WebAuthn passkeys.

iOS uses a platform passkey (Face ID / Touch ID) as a discoverable credential.
The relying party id must match the app's `webcredentials:` associated domain.
After the session idle window elapses, the app signs back in with that passkey
instead of a password.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlmodel import Session, select
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.exceptions import (
    InvalidAuthenticationResponse,
    InvalidRegistrationResponse,
)
from webauthn.helpers.structs import (
    AuthenticatorAttachment,
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from api.core.authentication import create_access_token_for_user
from api.core.config import settings
from api.models import Passkey, Token, User, WebAuthnChallenge

logger = logging.getLogger(__name__)

_REGISTER = "register"
_AUTHENTICATE = "authenticate"


def relying_party_origins() -> list[str]:
    """Origins a ceremony may claim.

    Native iOS passkeys report ``https://<rp id>``. The web app reports
    ``FRONTEND_HOST`` when someone registers from a browser later.
    """
    origins = [f"https://{settings.WEBAUTHN_RP_ID}"]
    frontend = settings.FRONTEND_HOST.rstrip("/")
    if frontend and frontend not in origins:
        origins.append(frontend)
    return origins


def _user_handle(user_id: int) -> bytes:
    return user_id.to_bytes(8, "big")


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _purge_expired_challenges(session: Session) -> None:
    now = datetime.now(tz=timezone.utc)
    rows = session.exec(select(WebAuthnChallenge)).all()
    for row in rows:
        if _as_utc(row.expires_at) <= now:
            session.delete(row)


def _store_challenge(
    session: Session, challenge: str, purpose: str, user_id: int | None
) -> None:
    _purge_expired_challenges(session)
    now = datetime.now(tz=timezone.utc)
    session.add(
        WebAuthnChallenge(
            challenge=challenge,
            purpose=purpose,
            user_id=user_id,
            expires_at=now + timedelta(seconds=settings.WEBAUTHN_CHALLENGE_TTL_SECONDS),
        )
    )
    session.commit()


def _take_challenge(
    session: Session, credential: dict, purpose: str, user_id: int | None
) -> bytes:
    """Return the challenge bytes if this ceremony was issued here and is fresh."""
    try:
        client_data = json.loads(
            base64url_to_bytes(credential["response"]["clientDataJSON"])
        )
        challenge = client_data["challenge"]
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Passkey response is missing a challenge.",
        )
    if not isinstance(challenge, str) or not challenge:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Passkey response is missing a challenge.",
        )

    row = session.exec(
        select(WebAuthnChallenge).where(WebAuthnChallenge.challenge == challenge)
    ).first()
    if row is None or row.purpose != purpose:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="That passkey challenge is no longer valid. Try again.",
        )
    if user_id is not None and row.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="That passkey challenge is no longer valid. Try again.",
        )
    if _as_utc(row.expires_at) <= datetime.now(tz=timezone.utc):
        session.delete(row)
        session.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="That passkey challenge expired. Try again.",
        )
    session.delete(row)
    session.commit()
    return base64url_to_bytes(challenge)


def _canonical_credential_id(value: str) -> str:
    return bytes_to_base64url(base64url_to_bytes(value))


def registration_options(user: User, session: Session) -> dict:
    existing = session.exec(select(Passkey).where(Passkey.user_id == user.id)).all()
    options = generate_registration_options(
        rp_id=settings.WEBAUTHN_RP_ID,
        rp_name=settings.WEBAUTHN_RP_NAME,
        user_id=_user_handle(user.id or 0),
        user_name=user.email,
        user_display_name=user.display_name,
        authenticator_selection=AuthenticatorSelectionCriteria(
            authenticator_attachment=AuthenticatorAttachment.PLATFORM,
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=[
            PublicKeyCredentialDescriptor(id=base64url_to_bytes(row.credential_id))
            for row in existing
        ],
    )
    payload = json.loads(options_to_json(options))
    _store_challenge(session, payload["challenge"], _REGISTER, user.id)
    return payload


def verify_registration(user: User, credential: dict, session: Session) -> Passkey:
    expected = _take_challenge(session, credential, _REGISTER, user.id)
    try:
        verified = verify_registration_response(
            credential=credential,
            expected_challenge=expected,
            expected_rp_id=settings.WEBAUTHN_RP_ID,
            expected_origin=relying_party_origins(),
            require_user_verification=True,
        )
    except InvalidRegistrationResponse as exc:
        logger.info("Passkey registration rejected: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="That passkey could not be verified. Try again.",
        ) from exc

    credential_id = bytes_to_base64url(verified.credential_id)
    already = session.exec(
        select(Passkey).where(Passkey.credential_id == credential_id)
    ).first()
    if already is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That passkey is already saved.",
        )

    transports = credential.get("response", {}).get("transports")
    stored_transports = None
    if isinstance(transports, list) and transports:
        stored_transports = ",".join(str(item) for item in transports)

    row = Passkey(
        user_id=user.id or 0,
        credential_id=credential_id,
        public_key=bytes_to_base64url(verified.credential_public_key),
        sign_count=verified.sign_count,
        transports=stored_transports,
        aaguid=verified.aaguid,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def authentication_options(session: Session) -> dict:
    options = generate_authentication_options(
        rp_id=settings.WEBAUTHN_RP_ID,
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    payload = json.loads(options_to_json(options))
    _store_challenge(session, payload["challenge"], _AUTHENTICATE, None)
    return payload


def verify_authentication(credential: dict, session: Session) -> Token:
    expected = _take_challenge(session, credential, _AUTHENTICATE, None)
    try:
        credential_id = _canonical_credential_id(credential["id"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Passkey response is missing a credential id.",
        )

    row = session.exec(
        select(Passkey).where(Passkey.credential_id == credential_id)
    ).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No Sous Kit passkey matches that credential.",
        )

    try:
        verified = verify_authentication_response(
            credential=credential,
            expected_challenge=expected,
            expected_rp_id=settings.WEBAUTHN_RP_ID,
            expected_origin=relying_party_origins(),
            credential_public_key=base64url_to_bytes(row.public_key),
            credential_current_sign_count=row.sign_count,
            require_user_verification=True,
        )
    except InvalidAuthenticationResponse as exc:
        logger.info("Passkey sign-in rejected: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="That passkey could not be verified. Try again.",
        ) from exc

    user = session.get(User, row.user_id)
    if user is None or user.disabled or not user.email_verified:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This account cannot sign in.",
        )

    row.sign_count = verified.new_sign_count
    row.last_used_on = datetime.now(tz=timezone.utc)
    session.add(row)
    session.commit()
    return create_access_token_for_user(user, session, record_login=True)
