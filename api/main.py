from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from api.core.config import settings
from api.core.errors import register_exception_handlers
from api.routes import (
    admin_routes,
    auth_routes,
    grocery_routes,
    health_routes,
    household_routes,
    ingredient_routes,
    meal_plan_wizard_routes,
    planned_recipe_routes,
    recipe_routes,
    upload_routes,
    user_routes,
)

app = FastAPI(docs_url="/api/docs", redoc_url="/api/redoc")

# Add CORS middleware for development environment
if settings.ENVIRONMENT == "development":
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.all_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


api_router = APIRouter()
api_router.include_router(health_routes.router)
api_router.include_router(admin_routes.router)
api_router.include_router(recipe_routes.router)
api_router.include_router(recipe_routes.unauth_router)
api_router.include_router(auth_routes.router)
api_router.include_router(planned_recipe_routes.router)
api_router.include_router(meal_plan_wizard_routes.router)
api_router.include_router(ingredient_routes.router)
api_router.include_router(grocery_routes.router)
api_router.include_router(household_routes.router)
api_router.include_router(upload_routes.router)
api_router.include_router(user_routes.router)


app.include_router(api_router, prefix=settings.API_V1_STR)

# Normalize HTTP / validation / unexpected errors to { user_message, detail, ... }
# and keep SPA HTML fallback for non-API 404s in deployed builds.
register_exception_handlers(app)

# Add Uploads dir
app.mount("/uploads/", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")


def _apple_app_site_association() -> JSONResponse:
    """Universal Links manifest so https://…/join/… opens the iOS app when installed."""
    app_id = (
        f"{settings.APPLE_TEAM_ID}.{settings.APPLE_APP_BUNDLE_ID}"
        if settings.APPLE_TEAM_ID
        else None
    )
    details = (
        [
            {
                "appIDs": [app_id],
                "components": [
                    {"/": "/join/*"},
                    {"/": "/join"},
                ],
            }
        ]
        if app_id
        else []
    )
    payload = {
        "applinks": {
            "apps": [],
            "details": details,
        }
    }
    return JSONResponse(
        content=payload,
        media_type="application/json",
        headers={"Cache-Control": "public, max-age=300"},
    )


@app.get("/.well-known/apple-app-site-association", include_in_schema=False)
def apple_app_site_association_well_known():
    return _apple_app_site_association()


@app.get("/apple-app-site-association", include_in_schema=False)
def apple_app_site_association_root():
    return _apple_app_site_association()


# Add the static frontend files if not in development
if settings.ENVIRONMENT != "development":
    app.mount(
        "/", StaticFiles(directory=settings.VUE_STATIC_DIR, html=True), name="frontend"
    )
