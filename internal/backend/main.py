import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from config import POLL_INTERVAL_MINUTES, HOST, PORT, WHATSAPP_PHONE, WHATSAPP_API_KEY
from database import (
    init_db,
    get_posts,
    get_post,
    update_post,
    get_stats,
    set_config_override,
    get_all_config_overrides,
)
from reddit_bot import run_scan, scan_log
from notifier import notify_new_posts, send_reminder

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
logger = logging.getLogger("main")

scheduler = AsyncIOScheduler()


async def scheduled_scan():
    try:
        result = await run_scan()
        if result["new_posts"] > 0:
            posts = await get_posts(status="new", limit=result["new_posts"])
            for p in posts:
                p["matched_keywords"] = json.loads(p.get("matched_keywords", "[]"))
                p["matched_intents"] = json.loads(p.get("matched_intents", "[]"))
            await notify_new_posts(posts)
        logger.info(f"Scheduled scan: {result['new_posts']} new posts")
    except Exception as e:
        logger.error(f"Scheduled scan failed: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    scheduler.add_job(
        scheduled_scan,
        "interval",
        minutes=POLL_INTERVAL_MINUTES,
        id="reddit_scan",
        replace_existing=True,
    )
    scheduler.start()
    logger.info(f"Scheduler started — polling every {POLL_INTERVAL_MINUTES} minutes")
    yield
    scheduler.shutdown()


app = FastAPI(title="VBOG Reddit Monitor", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount(
    "/static",
    StaticFiles(directory="../frontend"),
    name="static",
)


@app.get("/")
async def serve_dashboard():
    return FileResponse("../frontend/index.html")


@app.get("/api/posts")
async def api_get_posts(
    status: str | None = None,
    subreddit: str | None = None,
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
):
    posts = await get_posts(status=status, subreddit=subreddit, limit=limit, offset=offset)
    for p in posts:
        p["matched_keywords"] = json.loads(p.get("matched_keywords", "[]"))
        p["matched_intents"] = json.loads(p.get("matched_intents", "[]"))
    return {"posts": posts, "count": len(posts)}


@app.get("/api/posts/{post_id}")
async def api_get_post(post_id: int):
    post = await get_post(post_id)
    if not post:
        raise HTTPException(404, "Post not found")
    post["matched_keywords"] = json.loads(post.get("matched_keywords", "[]"))
    post["matched_intents"] = json.loads(post.get("matched_intents", "[]"))
    return post


class PostUpdate(BaseModel):
    status: str | None = None
    notes: str | None = None
    assigned_to: str | None = None


@app.patch("/api/posts/{post_id}")
async def api_update_post(post_id: int, body: PostUpdate):
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(400, "No updates provided")
    ok = await update_post(post_id, updates)
    if not ok:
        raise HTTPException(404, "Post not found or no valid fields")
    return {"ok": True}


@app.get("/api/stats")
async def api_stats():
    return await get_stats()


@app.post("/api/scan")
async def api_trigger_scan():
    return await run_scan()


@app.get("/api/scan/log")
async def api_scan_log():
    return {"log": list(scan_log)}


@app.post("/api/remind/{post_id}")
async def api_send_reminder(post_id: int):
    post = await get_post(post_id)
    if not post:
        raise HTTPException(404, "Post not found")
    if not WHATSAPP_PHONE:
        raise HTTPException(400, "WhatsApp not configured")
    ok = await send_reminder(WHATSAPP_PHONE, WHATSAPP_API_KEY, post)
    return {"sent": ok}


@app.get("/api/config")
async def api_get_config():
    from config import (
        KEYWORDS,
        HIGH_INTENT_PHRASES,
        MIN_KEYWORD_MATCHES,
        REQUIRE_INTENT,
        MAX_POSTS_PER_POLL,
    )

    overrides = await get_all_config_overrides()
    defaults = {
        "keywords": ",".join(KEYWORDS),
        "high_intent_phrases": ",".join(HIGH_INTENT_PHRASES),
        "min_keyword_matches": str(MIN_KEYWORD_MATCHES),
        "require_intent": str(REQUIRE_INTENT),
        "max_posts_per_poll": str(MAX_POSTS_PER_POLL),
        "poll_interval_minutes": str(POLL_INTERVAL_MINUTES),
    }
    merged = {**defaults, **overrides}
    return {"config": merged, "overrides": overrides}


class ConfigUpdate(BaseModel):
    key: str
    value: str


@app.put("/api/config")
async def api_set_config(body: ConfigUpdate):
    allowed_keys = {
        "keywords",
        "high_intent_phrases",
        "min_keyword_matches",
        "require_intent",
        "max_posts_per_poll",
    }
    if body.key not in allowed_keys:
        raise HTTPException(400, f"Key must be one of: {allowed_keys}")
    await set_config_override(body.key, body.value)
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=HOST, port=PORT, reload=True)
