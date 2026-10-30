import logging
from datetime import UTC, datetime

from sqlmodel import Session, select

from api.core.config import settings
from api.core.recipe_versions import create_recipe
from api.core.security import hash_password
from api.models import Recipe, User

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _upsert_password_user(
    session: Session,
    *,
    email: str,
    password: str,
    display_name: str,
    admin: bool,
    google_user_id: str | None = None,
) -> User:
    email = email.strip().lower()
    existing = session.exec(select(User).where(User.email == email)).first()
    if existing is not None:
        changed = False
        if not existing.hashed_password:
            existing.hashed_password = hash_password(password)
            changed = True
        if not existing.email_verified:
            existing.email_verified = True
            changed = True
        if existing.admin != admin:
            existing.admin = admin
            changed = True
        if google_user_id and existing.google_user_id != google_user_id:
            existing.google_user_id = google_user_id
            changed = True
        if changed:
            session.add(existing)
            session.commit()
            session.refresh(existing)
            logger.info("Updated seeded user %s", email)
        else:
            logger.info("Seeded user %s already exists, skipping.", email)
        return existing

    user = User(
        username=email.split("@")[0],
        email=email,
        display_name=display_name,
        admin=admin,
        disabled=False,
        email_verified=True,
        hashed_password=hash_password(password),
        google_user_id=google_user_id,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    logger.info("Created seeded user %s (admin=%s)", email, admin)
    return user


def init_users(session: Session):
    """
    Seed local password users:
    - admin@example.com / adminpass123 (admin)
    - test@example.com / testpass123 (regular)

    The admin user also receives SUPERUSER_GID when set so Google promote /
    legacy Google-linked flows keep working.
    """
    admin = _upsert_password_user(
        session,
        email=settings.SEED_ADMIN_EMAIL,
        password=settings.SEED_ADMIN_PASSWORD,
        display_name="Admin",
        admin=True,
        google_user_id=settings.SUPERUSER_GID or None,
    )

    _upsert_password_user(
        session,
        email=settings.SEED_TEST_EMAIL,
        password=settings.SEED_TEST_PASSWORD,
        display_name="Test User",
        admin=False,
    )

    # Legacy: if an older Google-only admin row exists under SUPERUSER_GID with a
    # different email, leave it; password seed users above are the primary locals.
    if settings.SUPERUSER_GID and admin.google_user_id != settings.SUPERUSER_GID:
        admin.google_user_id = settings.SUPERUSER_GID
        session.add(admin)
        session.commit()


def init_households(session: Session):
    from api.core.household import ensure_user_household

    users = list(session.exec(select(User)).all())
    for user in users:
        ensure_user_household(session, user)
    logger.info("Ensured households for %s users", len(users))


def init_recipes(session: Session):
    existing_count = len(session.exec(select(Recipe)).all())
    if existing_count > 0:
        logger.info("Recipes already seeded (%s), skipping.", existing_count)
        return

    user = session.exec(
        select(User).where(User.email == settings.SEED_ADMIN_EMAIL)
    ).first()
    if user is None:
        user = session.exec(select(User)).first()

    if user is None:
        raise RuntimeError("No users available to attach seed recipes to.")

    from api.core.household import ensure_user_household

    household = ensure_user_household(session, user)

    import random

    recipes_source = [
        {
            "created_by_id": user.id,
            "household_id": household.id,
            "created_on": datetime.now(),
            "name": "Classic Chocolate Chip Cookies",
            "description": "Soft and chewy chocolate chip cookies that are perfect for any occasion",
            "instructions": "1. Preheat oven to 375°F\n2. Cream butter and sugars\n3. Beat in eggs and vanilla\n4. Mix in dry ingredients\n5. Stir in chocolate chips\n6. Drop by rounded tablespoons onto baking sheets\n7. Bake 9-11 minutes until golden brown",
            "notes": "For softer cookies, reduce baking time by 1-2 minutes",
            "public": False,
            "prep_time": random.randint(5, 60),
        },
        {
            "created_by_id": user.id,
            "household_id": household.id,
            "created_on": datetime.now(),
            "name": "Spaghetti Carbonara",
            "description": "Classic Italian pasta dish with eggs, cheese, pancetta and black pepper",
            "instructions": "1. Cook spaghetti in salted water\n2. Fry pancetta until crispy\n3. Mix eggs, cheese and pepper\n4. Combine hot pasta with egg mixture\n5. Add pancetta and extra cheese",
            "notes": "Work quickly when mixing eggs to avoid scrambling",
            "public": True,
            "prep_time": random.randint(5, 60),
        },
        {
            "created_by_id": user.id,
            "household_id": household.id,
            "created_on": datetime.now(),
            "name": "Chicken Stir Fry",
            "description": "Quick and healthy chicken stir fry with vegetables",
            "instructions": "1. Cut chicken into strips\n2. Chop vegetables\n3. Heat wok with oil\n4. Stir fry chicken until cooked\n5. Add vegetables\n6. Add sauce and simmer",
            "notes": "Can substitute any vegetables you have on hand",
            "public": True,
            "prep_time": random.randint(5, 60),
        },
        {
            "created_by_id": user.id,
            "household_id": household.id,
            "created_on": datetime.now(),
            "name": "Banana Bread",
            "description": "Moist and delicious banana bread using overripe bananas",
            "instructions": "1. Preheat oven to 350°F\n2. Mash bananas\n3. Mix wet ingredients\n4. Combine with dry ingredients\n5. Pour into loaf pan\n6. Bake 60-65 minutes",
            "notes": "Best with very ripe bananas with brown spots",
            "public": False,
            "prep_time": random.randint(5, 60),
        },
        {
            "created_by_id": user.id,
            "household_id": household.id,
            "created_on": datetime.now(),
            "name": "Greek Salad",
            "description": "Fresh and crisp traditional Greek salad",
            "instructions": "1. Chop cucumbers and tomatoes\n2. Slice red onion\n3. Add kalamata olives\n4. Crumble feta cheese\n5. Dress with olive oil and oregano",
            "notes": "Use the freshest vegetables possible",
            "public": True,
            "prep_time": random.randint(5, 60),
        },
        {
            "created_by_id": user.id,
            "household_id": household.id,
            "created_on": datetime.now(),
            "name": "Beef Tacos",
            "description": "Simple and delicious ground beef tacos",
            "instructions": "1. Brown ground beef\n2. Add taco seasoning\n3. Warm taco shells\n4. Prepare toppings\n5. Assemble tacos",
            "notes": "Can make taco seasoning from scratch for better flavor",
            "public": True,
            "prep_time": random.randint(5, 60),
        },
        {
            "created_by_id": user.id,
            "household_id": household.id,
            "created_on": datetime.now(),
            "name": "Vegetable Soup",
            "description": "Hearty homemade vegetable soup",
            "instructions": "1. Chop all vegetables\n2. Sauté onions and garlic\n3. Add vegetables and broth\n4. Simmer until vegetables are tender\n5. Season to taste",
            "notes": "Great way to use up leftover vegetables",
            "public": True,
            "prep_time": random.randint(5, 60),
        },
        {
            "created_by_id": user.id,
            "household_id": household.id,
            "created_on": datetime.now(),
            "name": "Blueberry Pancakes",
            "description": "Fluffy pancakes studded with fresh blueberries",
            "instructions": "1. Mix dry ingredients\n2. Combine wet ingredients\n3. Fold together gently\n4. Fold in blueberries\n5. Cook on griddle until golden",
            "notes": "Can use frozen blueberries if fresh aren't available",
            "public": False,
            "prep_time": random.randint(5, 60),
        },
        {
            "created_by_id": user.id,
            "household_id": household.id,
            "created_on": datetime.now(),
            "name": "Guacamole",
            "description": "Fresh homemade guacamole with ripe avocados",
            "instructions": "1. Mash avocados\n2. Dice onion and tomato\n3. Chop cilantro\n4. Mix ingredients\n5. Season with lime and salt",
            "notes": "Add jalapeño for extra heat",
            "public": True,
            "prep_time": random.randint(5, 60),
        },
        {
            "created_by_id": user.id,
            "household_id": household.id,
            "created_on": datetime.now(),
            "name": "Chicken Noodle Soup",
            "description": "Comforting homemade chicken noodle soup",
            "instructions": "1. Cook chicken in broth\n2. Chop vegetables\n3. Add vegetables to broth\n4. Cook egg noodles\n5. Season with herbs",
            "notes": "Can use rotisserie chicken for quicker preparation",
            "public": True,
            "prep_time": random.randint(5, 60),
        },
    ]

    for recipe_data in recipes_source:
        create_recipe(
            session,
            user_id=user.id,
            household_id=household.id,
            public=bool(recipe_data["public"]),
            name=recipe_data["name"],
            description=recipe_data["description"],
            instructions=recipe_data["instructions"],
            notes=recipe_data["notes"],
            prep_time=recipe_data["prep_time"],
            cover_image_id=None,
            ingredients=[],
            created_on=datetime.now(UTC),
        )
    logger.info("Successfully created recipes")


def seed_database(session: Session):
    from api.core.seed_ingredients import (
        ensure_sample_ingredients,
        ensure_sample_planned_meals,
    )

    init_users(session)
    init_households(session)
    init_recipes(session)
    ensure_sample_ingredients(session)
    ensure_sample_planned_meals(session)
