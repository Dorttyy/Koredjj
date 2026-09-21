import logging
import asyncio
import os
from contextlib import asynccontextmanager
from contextlib import suppress

from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from fastapi import FastAPI, WebSocket, WebSocketDisconnect  # noqa: E402
from jwt import PyJWTError  # noqa: E402
from starlette.middleware.cors import CORSMiddleware  # noqa: E402

from auth_utils import decode_token  # noqa: E402
from db import client, ensure_indexes  # noqa: E402
from routes.ai import router as ai_router  # noqa: E402
from routes.audio import router as audio_router  # noqa: E402
from routes.auth import router as auth_router  # noqa: E402
from routes.chats import router as chats_router  # noqa: E402
from routes.leaderboard import router as leaderboard_router  # noqa: E402
from routes.learn import router as learn_router  # noqa: E402
from routes.media import router as media_router  # noqa: E402
from routes.market import router as market_router  # noqa: E402
from routes.moments import router as moments_router  # noqa: E402
from routes.notifications import router as notifications_router  # noqa: E402
from routes.phrases import router as phrases_router  # noqa: E402
from routes.admin import router as admin_router  # noqa: E402
from routes.push import router as push_router  # noqa: E402
from routes.rooms import router as rooms_router  # noqa: E402
from routes.rtc import router as rtc_router  # noqa: E402
from routes.call_practice import router as call_practice_router  # noqa: E402
from routes.room_stage import router as room_stage_router  # noqa: E402
from routes.room_moderators import router as room_moderators_router  # noqa: E402
import rtc_core  # noqa: E402
import room_time  # noqa: E402
import translation_service  # noqa: E402
from routes.pro import router as pro_router, seed_pro_tutors  # noqa: E402
from routes.lessons import router as lessons_router  # noqa: E402
from routes.users import router as users_router  # noqa: E402
from routes.vocab import router as vocab_router, seed_vocab_content  # noqa: E402
from routes.wotd import router as wotd_router  # noqa: E402
from routes.practice import router as practice_router  # noqa: E402
from ws_manager import manager  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await ensure_indexes()
    await seed_admin()
    await backfill_usernames()
    # Fresh previews can opt out of synthetic profiles without disabling Pro.
    if os.environ.get("SEED_DEMO_TUTORS", "true").lower() == "true":
        await seed_pro_tutors()
    await seed_vocab_content()
    await room_time.initialize()
    await translation_service.initialize()
    quota_task = asyncio.create_task(room_time.watchdog())
    try:
        yield
    finally:
        quota_task.cancel()
        with suppress(asyncio.CancelledError):
            await quota_task
        await translation_service.shutdown()
        client.close()


async def backfill_usernames():
    """Assign auto usernames to existing users missing one (idempotent)."""
    from db import users_col
    from routes.auth import generate_username

    async for doc in users_col.find({"username": {"$exists": False}}):
        uname = await generate_username(doc.get("name"))
        await users_col.update_one(
            {"_id": doc["_id"]},
            {"$set": {"username": uname, "username_changed_at": None}},
        )


async def seed_admin():
    """Idempotent admin account seeding (upsert keyed on email)."""
    import uuid
    from datetime import datetime, timezone

    from auth_utils import hash_password
    from db import users_col

    email = "admin@lingua.app"
    existing = await users_col.find_one({"email": email})
    if existing:
        if not existing.get("is_admin"):
            await users_col.update_one({"_id": existing["_id"]}, {"$set": {"is_admin": True}})
        return
    now = datetime.now(timezone.utc).isoformat()
    await users_col.insert_one(
        {
            "_id": str(uuid.uuid4()),
            "email": email,
            "password_hash": hash_password(os.environ.get("ADMIN_PASSWORD", "Admin1234!")),
            "name": "Admin",
            "is_admin": True,
            "banned": False,
            "coins": 0,
            "created_at": now,
        }
    )
    logger.info("Seeded admin account %s", email)


app = FastAPI(title="Mello API", lifespan=lifespan)


@app.get("/api/")
async def root():
    return {"message": "Mello API"}


# 1-to-1 call signaling (bound to an authenticated call session) and voice-room
# mesh signaling (bound to live room membership).
CALL_EVENT_TYPES = {
    "call_offer",
    "call_answer",
    "call_ice",
    "call_end",
    "call_decline",
    "call_media_ready",
    "call_ringing",
}
ROOM_EVENT_TYPES = {
    "rtc_offer",
    "rtc_answer",
    "rtc_ice",
    "rtc_restart",
    "rtc_state",
}


@app.websocket("/api/ws")
async def websocket_endpoint(websocket: WebSocket, token: str):
    import json as _json

    from db import users_col
    from models import user_card

    try:
        user_id = decode_token(token)
    except PyJWTError:
        await websocket.close(code=4001)
        return
    await manager.connect(user_id, websocket)
    try:
        while True:
            raw = await websocket.receive_text()
            if len(raw) > 65536:
                continue
            try:
                data = _json.loads(raw)
            except ValueError:
                continue
            if not isinstance(data, dict):
                continue
            event_type = data.get("type")
            target = data.get("to")
            if not isinstance(target, str) or not isinstance(event_type, str) or event_type not in (CALL_EVENT_TYPES | ROOM_EVENT_TYPES):
                continue
            # Signaling flood protection (per authenticated user).
            if not rtc_core.limiter.allow(f"sig:{user_id}", *rtc_core.SIGNAL_LIMIT):
                continue
            data["from"] = user_id

            if event_type in CALL_EVENT_TYPES:
                call_id = data.get("call_id")
                # Every frame must belong to a live session the sender is part
                # of — client-supplied caller/receiver ids are never trusted.
                if not call_id or not rtc_core.is_participant(
                    call_id, user_id, target
                ):
                    await manager.send_to_user(
                        user_id, {"type": "call_invalid", "call_id": call_id}
                    )
                    continue
                if event_type == "call_offer":
                    sess = rtc_core.session(call_id)
                    if user_id != sess["caller"] and not sess.get("accepted"):
                        continue
                    if not manager.is_online(target):
                        await manager.send_to_user(
                            user_id,
                            {
                                "type": "call_unavailable",
                                "from": target,
                                "call_id": call_id,
                            },
                        )
                        continue
                    caller = await users_col.find_one({"_id": user_id})
                    if caller:
                        data["caller"] = user_card(caller)
                    data["expires_at"] = rtc_core.session(call_id)["expires_at"]
                    data["practice"] = bool(rtc_core.session(call_id).get("practice"))
                    if user_id == sess["caller"] and not sess.get("accepted"):
                        sess["offer"] = {**data, "from": user_id, "from_user_id": user_id}
                        if not sess.get("push_attempted"):
                            asyncio.create_task(rtc_core.push_call_once(call_id))
                elif event_type == "call_ringing":
                    if user_id != rtc_core.session(call_id)["receiver"]:
                        continue
                    rtc_core.session(call_id)["delivered"] = True
                elif event_type == "call_answer":
                    if user_id != rtc_core.session(call_id)["receiver"] and not rtc_core.session(call_id).get("accepted"):
                        continue
                    if not rtc_core.session(call_id).get("accepted"):
                        rtc_core.schedule_expiry(call_id, connecting=True)
                    rtc_core.session(call_id)["accepted"] = True
                elif event_type == "call_media_ready":
                    await rtc_core.media_ready(call_id, user_id)
                elif event_type == "call_ice":
                    sess = rtc_core.session(call_id)
                    if user_id == sess["caller"] and not sess.get("accepted") and data.get("candidate"):
                        candidates = sess.setdefault("early_ice", [])
                        if len(candidates) < 80:
                            candidates.append(data["candidate"])
                elif event_type == "call_decline":
                    await rtc_core.finish(call_id, rtc_core.REJECTED)
                elif event_type == "call_end":
                    sess = rtc_core.session(call_id)
                    caller_cancelled = (
                        sess
                        and sess["status"] == rtc_core.RINGING
                        and user_id == sess["caller"]
                    )
                    await rtc_core.finish(
                        call_id, rtc_core.CANCELLED if caller_cancelled else None
                    )
            else:
                room_id = data.get("room_id")
                if not room_id or not await rtc_core.both_in_room(
                    room_id, user_id, target
                ):
                    continue

            await manager.send_to_user(target, data)
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(user_id, websocket)


# --------------------------------------------------------------------------- #
# Pro classroom — room-based WebRTC signaling relay (free: peers only need the
# room token). Relays offer/answer/ICE + real in-call chat + join/leave
# presence between the (max 2) participants of a Pro lesson room. No API keys.
# --------------------------------------------------------------------------- #
pro_rtc_rooms: dict[str, dict[str, WebSocket]] = {}


@app.websocket("/api/pro/rtc/{room}")
async def pro_rtc_endpoint(websocket: WebSocket, room: str, token: str):
    import json as _json

    try:
        user_id = decode_token(token)
    except PyJWTError:
        await websocket.close(code=4001)
        return
    await websocket.accept()
    peers = pro_rtc_rooms.setdefault(room, {})
    # Unique connection key so the same user opening twice doesn't clash.
    conn_key = f"{user_id}:{id(websocket)}"
    peers[conn_key] = websocket

    async def relay(payload: dict, exclude: str | None = None):
        for k, ws in list(peers.items()):
            if k == exclude:
                continue
            try:
                await ws.send_json(payload)
            except Exception:
                peers.pop(k, None)

    # Tell the newcomer how many peers are already here, and notify others.
    try:
        await websocket.send_json(
            {"type": "rtc_welcome", "peers": len(peers) - 1, "self": user_id}
        )
        await relay({"type": "rtc_peer_join", "from": user_id}, exclude=conn_key)
        while True:
            raw = await websocket.receive_text()
            try:
                data = _json.loads(raw)
            except ValueError:
                continue
            data["from"] = user_id
            # Relay everything (offer/answer/ice/chat) to the other peer(s).
            await relay(data, exclude=conn_key)
    except WebSocketDisconnect:
        pass
    finally:
        peers.pop(conn_key, None)
        if peers:
            await relay({"type": "rtc_peer_leave", "from": user_id})
        else:
            pro_rtc_rooms.pop(room, None)


for router in (
    auth_router,
    users_router,
    chats_router,
    moments_router,
    ai_router,
    rooms_router,
    rtc_router,
    call_practice_router,
    room_stage_router,
    room_moderators_router,
    audio_router,
    media_router,
    notifications_router,
    phrases_router,
    market_router,
    admin_router,
    push_router,
    learn_router,
    pro_router,
    lessons_router,
    vocab_router,
    wotd_router,
    leaderboard_router,
    practice_router,
):
    app.include_router(router, prefix="/api")

_cors_origins = os.environ.get("CORS_ORIGINS", "*").strip()
# When allowing any origin together with credentials, the CORS spec forbids the
# literal "*" in Access-Control-Allow-Origin — the server MUST echo the exact
# request Origin. Starlette does this correctly via allow_origin_regex, but NOT
# via allow_origins=["*"] (which emits "*" + Allow-Credentials:true on actual
# responses and gets blocked by browsers on cross-origin/deployed setups).
if _cors_origins == "*":
    _cors_origin_kwargs = {"allow_origin_regex": ".*"}
else:
    _cors_origin_kwargs = {
        "allow_origins": [o.strip() for o in _cors_origins.split(",") if o.strip()]
    }

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    **_cors_origin_kwargs,
)
