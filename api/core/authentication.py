from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated
from urllib.parse import urlencode

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlmodel import Session, select

from api.core.config import settings
from api.core.database import SessionDep
from api.core.email import send_verification_otp_email
from api.core.security import (
    generate_otp,
    hash_otp,
    hash_password,
    otp_expiry,
    validate_password_strength,
    verify_otp,
    verify_password,
)
from api.models import EmailVerificationChallenge, Token, TokenType, User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def token_expires_at(access_token: str) -> datetime | None:
    """Read a token's exp without enforcing it. None when the token is junk."""
    try:
        payload = jwt.decode(
            access_token,
            settings.SECRET_KEY,
            algorithms=[settings.HASH_ALGORITHM],
            options={"verify_exp": False},
        )
    except jwt.InvalidTokenError:
        return None
    exp = payload.get("exp")
    if not isinstance(exp, int | float):
        return None
    return datetime.fromtimestamp(exp, tz=timezone.utc)


def get_db_token(session: Session, raw_token: str) -> Token:
    """Accept a bearer token only when its signature, expiry, and DB row agree."""
    try:
        jwt.decode(raw_token, settings.SECRET_KEY, algorithms=[settings.HASH_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise _unauthorized("Your session has expired. Please sign in again.")
    except jwt.InvalidTokenError:
        raise _unauthorized("Your session is invalid. Please sign in again.")

    db_token = session.exec(
        select(Token).where(Token.access_token == raw_token)
    ).first()
    if db_token is None:
        raise _unauthorized("Your session has expired. Please sign in again.")
    return db_token


# Keep the token the client just presented, plus a few newer ones, so an
# in-flight request still works while the app stores the refreshed token.
_MAX_LIVE_TOKENS_PER_USER = 8


def _prune_user_tokens(session: Session, user_id: int, *, keep_ids: set[int]) -> None:
    now = datetime.now(tz=timezone.utc)
    rows = session.exec(select(Token).where(Token.user_id == user_id)).all()
    live: list[tuple[datetime, Token]] = []
    for row in rows:
        expires = token_expires_at(row.access_token)
        if expires is None or expires <= now:
            session.delete(row)
            continue
        live.append((expires, row))
    overflow = len(live) - _MAX_LIVE_TOKENS_PER_USER
    for _, row in sorted(live, key=lambda item: item[0]):
        if overflow <= 0:
            break
        if row.id in keep_ids:
            continue
        session.delete(row)
        overflow -= 1


def slide_session(current: Token, session: Session) -> Token:
    """Mint a new idle window and keep the presented token valid for in-flight calls."""
    user = session.get(User, current.user_id)
    if user is None or user.disabled or not user.email_verified:
        raise _unauthorized("Your session has expired. Please sign in again.")
    previous_id = current.id
    fresh = create_access_token_for_user(user, session, record_login=False)
    keep = {previous_id, fresh.id}
    _prune_user_tokens(session, user.id, keep_ids={pk for pk in keep if pk is not None})
    session.commit()
    session.refresh(fresh)
    return fresh


async def get_current_user(
    session: SessionDep, token: Annotated[str, Depends(oauth2_scheme)]
):
    db_token = get_db_token(session, token)
    user = session.get(User, db_token.user_id)
    if user is None:
        raise _unauthorized("Please sign in again to continue.")
    return user


async def get_current_active_user(
    current_user: Annotated[User, Depends(get_current_user)],
):
    if current_user.disabled:
        raise HTTPException(
            status_code=400, detail="This account is disabled. Contact support."
        )
    if not current_user.email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "email_not_verified",
                "user_message": "Verify your email to continue.",
                "message": "Email address is not verified",
                "redirect_to": verify_email_redirect_path(current_user.email),
                "email": current_user.email,
            },
        )
    return current_user


async def get_admin_user(
    current_active_user: Annotated[User, Depends(get_current_active_user)],
):
    if not current_active_user.admin:
        raise HTTPException(
            status_code=403, detail="Admin access is required for that action."
        )
    return current_active_user


def normalize_email(email: str) -> str:
    return email.strip().lower()


def verify_email_redirect_path(email: str) -> str:
    query = urlencode({"email": normalize_email(email)})
    return f"{settings.VERIFY_EMAIL_PATH}?{query}"


def get_user_by_email(session: SessionDep, email: str) -> User | None:
    return session.exec(
        select(User).where(User.email == normalize_email(email))
    ).first()


def issue_email_otp(user: User, session: SessionDep) -> str:
    """Create/replace an OTP challenge and send it. Returns plaintext OTP."""
    otp = generate_otp()
    now = datetime.now(tz=timezone.utc)
    challenge = session.exec(
        select(EmailVerificationChallenge).where(
            EmailVerificationChallenge.user_id == user.id
        )
    ).first()

    if challenge is None:
        challenge = EmailVerificationChallenge(
            user_id=user.id,
            otp_hash=hash_otp(otp, user.email),
            expires_at=otp_expiry(now),
            attempts=0,
            last_sent_at=now,
        )
    else:
        challenge.otp_hash = hash_otp(otp, user.email)
        challenge.expires_at = otp_expiry(now)
        challenge.attempts = 0
        challenge.last_sent_at = now

    session.add(challenge)
    session.commit()
    session.refresh(challenge)

    send_verification_otp_email(user.email, otp)
    return otp


def can_resend_otp(challenge: EmailVerificationChallenge | None) -> bool:
    if challenge is None or challenge.last_sent_at is None:
        return True
    last = challenge.last_sent_at
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    elapsed = (datetime.now(tz=timezone.utc) - last).total_seconds()
    return elapsed >= settings.EMAIL_OTP_RESEND_COOLDOWN_SECONDS


def register_password_user(
    *,
    email: str,
    password: str,
    display_name: str,
    session: SessionDep,
) -> tuple[User, str]:
    strength_error = validate_password_strength(password)
    if strength_error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=strength_error
        )

    normalized = normalize_email(email)
    existing = get_user_by_email(session, normalized)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    user = User(
        username=normalized,
        email=normalized,
        display_name=display_name.strip(),
        hashed_password=hash_password(password),
        email_verified=False,
        admin=False,
        disabled=False,
        last_login=None,
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    from api.core.household import ensure_user_household

    ensure_user_household(session, user)

    otp = issue_email_otp(user, session)
    return user, otp


# Precomputed Argon2 hash used only to keep missing-user login timing similar.
_DUMMY_PASSWORD_HASH = hash_password("invalid-password-placeholder")


def authenticate_password_user(
    *, email: str, password: str, session: SessionDep
) -> User:
    user = get_user_by_email(session, email)
    hashed = user.hashed_password if user is not None else None
    if not hashed or not verify_password(password, hashed):
        if not hashed:
            verify_password(password, _DUMMY_PASSWORD_HASH)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user.disabled:
        raise HTTPException(
            status_code=400, detail="This account is disabled. Contact support."
        )

    return user


def email_not_verified_http_exception(email: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "code": "email_not_verified",
            "user_message": (
                "Email address is not verified. Enter the code we sent you."
            ),
            "message": ("Email address is not verified. Enter the code we sent you."),
            "redirect_to": verify_email_redirect_path(email),
            "email": normalize_email(email),
        },
        headers={"Location": verify_email_redirect_path(email)},
    )


def verify_user_email_otp(*, email: str, otp: str, session: SessionDep) -> User:
    user = get_user_by_email(session, email)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid verification code.",
        )

    if user.email_verified:
        return user

    challenge = session.exec(
        select(EmailVerificationChallenge).where(
            EmailVerificationChallenge.user_id == user.id
        )
    ).first()

    if challenge is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No verification code pending. Request a new one.",
        )

    expires_at = challenge.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if datetime.now(tz=timezone.utc) > expires_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification code has expired. Request a new one.",
        )

    if challenge.attempts >= settings.EMAIL_OTP_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many invalid attempts. Request a new code.",
        )

    if not verify_otp(otp.strip(), user.email, challenge.otp_hash):
        challenge.attempts += 1
        session.add(challenge)
        session.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid verification code.",
        )

    user.email_verified = True
    session.add(user)
    session.delete(challenge)
    session.commit()
    session.refresh(user)
    return user


def get_or_create_user_from_google_token(google_token, session: SessionDep):
    db_user = session.exec(
        select(User).where(User.google_user_id == google_token["sub"])
    ).first()

    if db_user is None:
        email = normalize_email(google_token["email"])
        # Link an existing password account with the same verified Google email.
        db_user = get_user_by_email(session, email)
        if db_user is None:
            new_user = {
                "username": email,
                "email": email,
                "display_name": google_token.get("name") or email.split("@")[0],
                "google_user_id": google_token["sub"],
                "avatar_url": google_token.get("picture"),
                "email_verified": True,
                "last_login": datetime.now(tz=timezone.utc),
            }
            db_user = User.model_validate(new_user)
            session.add(db_user)
            session.commit()
            session.refresh(db_user)
            from api.core.household import ensure_user_household

            ensure_user_household(session, db_user)
        else:
            db_user.google_user_id = google_token["sub"]
            db_user.email_verified = True
            if not db_user.avatar_url and google_token.get("picture"):
                db_user.avatar_url = google_token["picture"]
            session.add(db_user)
            session.commit()
            session.refresh(db_user)
    elif not db_user.email_verified:
        db_user.email_verified = True
        session.add(db_user)
        session.commit()
        session.refresh(db_user)

    return db_user


def create_access_token_for_user(
    user: User, session: Session, *, record_login: bool = True
) -> Token:
    access_token = jwt.encode(
        {
            "user_id": user.id,
            "email": user.email,
            # Unique per mint. exp is whole seconds, so two refreshes in the
            # same second would otherwise be the same string.
            "jti": secrets.token_urlsafe(16),
            "exp": datetime.now(timezone.utc)
            + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        },
        settings.SECRET_KEY,
        algorithm=settings.HASH_ALGORITHM,
    )

    db_token = Token.model_validate(
        {
            "access_token": access_token,
            "token_type": TokenType.Access,
            "user_id": user.id,
        }
    )

    session.add(db_token)

    if record_login:
        user.last_login = datetime.now(timezone.utc)
        session.add(user)

    session.commit()
    session.refresh(db_token)

    return db_token


def get_or_create_user_from_apple_token(
    apple_token: dict, display_name: str | None, session: SessionDep
) -> User:
    db_user = session.exec(
        select(User).where(User.apple_user_id == apple_token["sub"])
    ).first()

    if db_user is not None:
        if not db_user.email_verified:
            db_user.email_verified = True
            session.add(db_user)
            session.commit()
            session.refresh(db_user)
        return db_user

    # Apple only omits the email claim when the app didn't request the email
    # scope; Sous Kit always requests it.
    raw_email = apple_token.get("email")
    if not raw_email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Apple did not share an email address for this account.",
        )
    email = normalize_email(raw_email)

    # Link an existing account with the same email. Apple addresses are
    # verified by Apple, including private-relay ones.
    db_user = get_user_by_email(session, email)
    if db_user is None:
        db_user = User.model_validate(
            {
                "username": email,
                "email": email,
                "display_name": (display_name or "").strip() or email.split("@")[0],
                "apple_user_id": apple_token["sub"],
                "email_verified": True,
                "last_login": datetime.now(tz=timezone.utc),
            }
        )
        session.add(db_user)
        session.commit()
        session.refresh(db_user)
        from api.core.household import ensure_user_household

        ensure_user_household(session, db_user)
        return db_user

    db_user.apple_user_id = apple_token["sub"]
    db_user.email_verified = True
    session.add(db_user)
    session.commit()
    session.refresh(db_user)
    return db_user


def create_access_token(google_token, session: SessionDep):
    user = get_or_create_user_from_google_token(google_token, session)
    return create_access_token_for_user(user, session)


def verify_access_token(
    access_token: Annotated[str, Depends(oauth2_scheme)], session: SessionDep
) -> Token:
    return get_db_token(session, access_token)


def verify_google_token(encoded_google_token: str):
    from google.auth.transport import requests as google_req
    from google.oauth2 import id_token

    request = google_req.Request()
    # Skip built-in audience verification (single-audience only) and check
    # `aud` against every allowed client: web app + optional iOS app.
    decoded_token = id_token.verify_oauth2_token(
        encoded_google_token, request, audience=None
    )
    allowed_audiences = {settings.VITE_GOOGLE_CLIENT_ID}
    if settings.GOOGLE_IOS_CLIENT_ID:
        allowed_audiences.add(settings.GOOGLE_IOS_CLIENT_ID)
    if decoded_token.get("aud") not in allowed_audiences:
        raise ValueError("Token has wrong audience.")
    return decoded_token


_APPLE_ISSUER = "https://appleid.apple.com"
_APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
_apple_jwk_client: jwt.PyJWKClient | None = None


def _get_apple_jwk_client() -> jwt.PyJWKClient:
    global _apple_jwk_client
    if _apple_jwk_client is None:
        _apple_jwk_client = jwt.PyJWKClient(
            _APPLE_JWKS_URL, cache_keys=True, lifespan=3600
        )
    return _apple_jwk_client


def verify_apple_token(encoded_apple_token: str) -> dict:
    """Verify a Sign in with Apple identity token against Apple's JWKS."""
    signing_key = _get_apple_jwk_client().get_signing_key_from_jwt(encoded_apple_token)
    return jwt.decode(
        encoded_apple_token,
        signing_key.key,
        algorithms=["RS256"],
        audience=settings.APPLE_APP_BUNDLE_ID,
        issuer=_APPLE_ISSUER,
    )


CurrentUserDep = Annotated[User, Depends(get_current_active_user)]
AdminUserDep = Annotated[User, Depends(get_admin_user)]
