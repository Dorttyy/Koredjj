import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logger = logging.getLogger(__name__)

# Deploy-safe configuration: a missing .env (it is lost on every fork, and a
# production deploy may inject only some variables) must NEVER crash the API at
# import time — a crashed API is exactly what an installed APK reports as
# "Can't reach the server". Managed deployments inject MONGO_URL / DB_NAME, so
# these defaults only ever apply to a bare local container.
_LOCAL_MONGO = not (os.environ.get("MONGO_URL") or "").strip()
MONGO_URL = (os.environ.get("MONGO_URL") or "mongodb://localhost:27017").strip()
if _LOCAL_MONGO:
    logger.warning("MONGO_URL not set — falling back to local MongoDB")

client = AsyncIOMotorClient(MONGO_URL, serverSelectionTimeoutMS=15000)


def _database_name() -> str:
    """DB name from configuration only: DB_NAME, else the database embedded in
    MONGO_URL (``mongodb+srv://…/<db>``). Never a name invented in code."""
    name = (os.environ.get("DB_NAME") or "").strip()
    if name:
        return name
    try:
        return client.get_default_database().name
    except Exception as exc:  # ConfigurationError: URI carries no database
        if _LOCAL_MONGO:
            # Bare local container with no configuration at all (e.g. a fresh
            # fork before .env is restored): use the local dev database so the
            # API still boots. Managed deployments always inject MONGO_URL AND
            # DB_NAME, so this branch can never pick a database for them.
            logger.warning("DB_NAME not set — using the local development database")
            return "linguaconnect"
        raise RuntimeError(
            "DB_NAME is not configured and MONGO_URL names no database — set DB_NAME"
        ) from exc


DB_NAME = _database_name()
db = client[DB_NAME]

users_col = db["users"]
conversations_col = db["conversations"]
messages_col = db["messages"]
moments_col = db["moments"]
comments_col = db["comments"]
rooms_col = db["rooms"]
room_messages_col = db["room_messages"]
audio_col = db["audio_files"]
media_col = db["media_files"]
profile_visits_col = db["profile_visits"]
notifications_col = db["notifications"]
follows_col = db["follows"]
config_col = db["app_config"]
market_config_col = db["market_config"]
# --- Realtime audio (1-to-1 WebRTC call sessions / history) ---
calls_col = db["calls"]
# --- Paid Practice (coin-gated conversations with practice partners) ---
practice_unlocks_col = db["practice_unlocks"]
# --- Gift Gate (require a gift before a stranger can message you) ---
gift_unlocks_col = db["gift_unlocks"]

# --- Pro (1-on-1 video tutoring sub-app) collections ---
pro_profiles_col = db["pro_profiles"]
pro_sessions_col = db["pro_sessions"]
pro_transcripts_col = db["pro_transcripts"]
pro_wallets_col = db["pro_wallets"]
pro_availability_col = db["pro_availability"]

# --- Lessons (gamified language-learning sub-app) collections ---
lessons_profiles_col = db["lessons_profiles"]
lessons_progress_col = db["lessons_progress"]


async def ensure_indexes():
    """Idempotent index creation. Each index is attempted independently so a
    transient connection error (e.g. Atlas handshake EOF) never crashes startup —
    missing indexes are simply created on the next boot."""
    specs = [
        (users_col, "email", {"unique": True}),
        (users_col, "username", {"unique": True, "sparse": True}),
        (messages_col, [("conversation_id", 1), ("created_at", 1)], {}),
        (conversations_col, "participant_ids", {}),
        (moments_col, [("created_at", -1)], {}),
        (comments_col, [("moment_id", 1), ("created_at", 1)], {}),
        (rooms_col, [("is_live", 1), ("created_at", -1)], {}),
        (room_messages_col, [("room_id", 1), ("created_at", 1)], {}),
        (profile_visits_col, [("visitor_id", 1), ("visited_user_id", 1)], {"unique": True}),
        (profile_visits_col, [("visited_user_id", 1), ("visited_at", -1)], {}),
        (notifications_col, [("user_id", 1), ("created_at", -1)], {}),
        (notifications_col, [("user_id", 1), ("read", 1)], {}),
        (follows_col, [("follower_id", 1), ("following_id", 1)], {"unique": True}),
        (follows_col, [("following_id", 1)], {}),
        (calls_col, [("caller_id", 1), ("started_at", -1)], {}),
        (calls_col, [("receiver_id", 1), ("started_at", -1)], {}),
        (practice_unlocks_col, [("buyer_id", 1), ("partner_id", 1)], {"unique": True}),
        (gift_unlocks_col, [("buyer_id", 1), ("partner_id", 1)], {"unique": True}),
    ]
    for col, keys, opts in specs:
        try:
            await col.create_index(keys, **opts)
        except Exception as e:
            logger.warning("Index creation skipped for %s %s: %s", col.name, keys, e)
