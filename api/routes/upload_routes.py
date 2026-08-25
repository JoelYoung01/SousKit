import os
import re
import secrets
from datetime import UTC, datetime
from pathlib import Path

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Response,
    UploadFile,
    status,
)
from sqlmodel import select

from api.core.authentication import CurrentUserDep, verify_access_token
from api.core.config import settings
from api.core.database import SessionDep
from api.core.logging import logger
from api.models import Upload
from api.schemas import UploadFileResponse

router = APIRouter(
    prefix="/upload", dependencies=[Depends(verify_access_token)], tags=["Upload"]
)

UPLOAD_PATH = Path(settings.UPLOAD_DIR)
UPLOAD_PATH.mkdir(parents=True, exist_ok=True)

MAX_UPLOAD_BYTES = 12 * 1024 * 1024  # 12 MiB
ALLOWED_IMAGE_PREFIXES = ("image/",)
# Browsers / OS pickers sometimes send octet-stream for HEIC/JPEG.
ALLOWED_FALLBACK_TYPES = {"application/octet-stream", ""}


def _safe_filename(original: str | None) -> tuple[str, str]:
    """Return (stem, extension) with safe defaults — never empty."""
    raw = (original or "").strip() or "photo.jpg"
    # Strip path segments some clients incorrectly include.
    raw = Path(raw).name
    if "." in raw:
        stem, ext = raw.rsplit(".", 1)
        ext = re.sub(r"[^a-zA-Z0-9]", "", ext)[:8].lower() or "jpg"
    else:
        stem, ext = raw, "jpg"
    stem = re.sub(r"[^a-zA-Z0-9._-]+", "-", stem).strip(".-") or "photo"
    return stem[:80], ext


@router.get("/{upload_id:int}/", response_model=UploadFileResponse)
def get_file_by_id(upload_id: int, current_user: CurrentUserDep, session: SessionDep):
    db_upload = session.exec(select(Upload).where(Upload.id == upload_id)).first()
    if not db_upload:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, f"Upload with id {upload_id} not found."
        )

    return db_upload


@router.post("/", response_model=UploadFileResponse)
async def upload_file(
    current_user: CurrentUserDep,
    session: SessionDep,
    file: UploadFile = File(..., description="Image file to store as a recipe cover"),
):
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type and not content_type.startswith(ALLOWED_IMAGE_PREFIXES):
        if content_type not in ALLOWED_FALLBACK_TYPES:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=(
                    f"That file type ({content_type}) isn’t supported. "
                    "Please upload a JPG, PNG, WEBP, or HEIC photo."
                ),
            )

    # Create user-specific directory
    user_dir = UPLOAD_PATH / str(current_user.id)
    try:
        user_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.error("Could not create upload dir %s: %s", user_dir, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Couldn’t prepare storage for that upload. Please try again.",
        ) from exc

    stem, ext = _safe_filename(file.filename)
    file_hash = secrets.token_hex(8)
    file_name = f"{stem}_{file_hash}.{ext}"
    display_name = f"{stem}.{ext}"

    # Set path
    file_path = Path(str(current_user.id)) / file_name
    full_path = UPLOAD_PATH / file_path

    # Write file contents to disk
    file_saved = False
    try:
        contents = await file.read()
        if not contents:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="That upload was empty. Pick a different photo and try again.",
            )
        if len(contents) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=(
                    f"That photo is too large "
                    f"({len(contents) // (1024 * 1024)}MB). "
                    f"Please use an image under {MAX_UPLOAD_BYTES // (1024 * 1024)}MB."
                ),
            )
        with open(full_path, "wb") as f:
            f.write(contents)

        file_saved = True
    except HTTPException:
        raise
    except Exception as e:
        logger.error("An error occurred while saving upload: %s", e)
    finally:
        await file.close()

    if not file_saved:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred while saving the file. Please try again.",
        )

    # Build corresponding db entry for file
    db_file = Upload(
        created_by_id=current_user.id,
        created_on=datetime.now(UTC),
        file_path=str(file_path),
        name=display_name[:255],
    )

    session.add(db_file)
    session.commit()
    session.refresh(db_file)

    return db_file


@router.delete("/file_path/{file_path:str}/")
async def delete_upload_by_path(
    file_path: str, current_user: CurrentUserDep, session: SessionDep
):
    # Construct the full path to the file
    full_path = UPLOAD_PATH / file_path

    # Check if the file exists and belongs to the current user
    if (
        not full_path.exists()
        or str(full_path).startswith(str(UPLOAD_PATH / str(current_user.id))) is False
        and current_user.admin is False
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="That file couldn’t be found or you don’t have access.",
        )

    # Delete the file
    os.remove(full_path)

    # Remove file from DB
    db_upload = session.exec(
        select(Upload).where(Upload.file_path == file_path)
    ).first()
    if not db_upload:
        raise HTTPException(
            status_code=404, detail=f"Upload with path {file_path} not found in DB."
        )
    session.delete(db_upload)
    session.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{upload_id:int}/")
async def delete_upload_by_id(
    upload_id: int, current_user: CurrentUserDep, session: SessionDep
):
    db_upload = session.exec(select(Upload).where(Upload.id == upload_id)).first()
    if not db_upload:
        raise HTTPException(
            status_code=404, detail=f"Upload with id {upload_id} not found in DB."
        )

    # Construct the full path to the file
    full_path = UPLOAD_PATH / db_upload.file_path

    # Check if the file exists and belongs to the current user
    if (
        not full_path.exists()
        or str(full_path).startswith(str(UPLOAD_PATH / str(current_user.id))) is False
        and current_user.admin is False
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="That file couldn’t be found or you don’t have access.",
        )

    # Delete the file
    os.remove(full_path)

    # Remove file from DB
    session.delete(db_upload)
    session.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)
