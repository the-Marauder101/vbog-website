import aiosqlite
import os
import json
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "vbog_reddit.db")


async def get_db() -> aiosqlite.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    return db


async def init_db():
    db = await get_db()
    try:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS flagged_posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reddit_id TEXT UNIQUE NOT NULL,
                subreddit TEXT NOT NULL,
                title TEXT NOT NULL,
                body TEXT,
                url TEXT NOT NULL,
                author TEXT,
                score INTEGER DEFAULT 0,
                num_comments INTEGER DEFAULT 0,
                matched_keywords TEXT,
                matched_intents TEXT,
                relevance_score REAL DEFAULT 0,
                status TEXT DEFAULT 'new',
                notes TEXT DEFAULT '',
                assigned_to TEXT DEFAULT '',
                created_utc REAL,
                flagged_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS config_overrides (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_status ON flagged_posts(status);
            CREATE INDEX IF NOT EXISTS idx_subreddit ON flagged_posts(subreddit);
            CREATE INDEX IF NOT EXISTS idx_flagged_at ON flagged_posts(flagged_at);
        """)
        await db.commit()
    finally:
        await db.close()


async def insert_post(post: dict) -> bool:
    db = await get_db()
    try:
        now = datetime.utcnow().isoformat()
        await db.execute(
            """INSERT OR IGNORE INTO flagged_posts
            (reddit_id, subreddit, title, body, url, author, score,
             num_comments, matched_keywords, matched_intents,
             relevance_score, status, flagged_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)""",
            (
                post["reddit_id"],
                post["subreddit"],
                post["title"],
                post.get("body", ""),
                post["url"],
                post.get("author", "[deleted]"),
                post.get("score", 0),
                post.get("num_comments", 0),
                json.dumps(post.get("matched_keywords", [])),
                json.dumps(post.get("matched_intents", [])),
                post.get("relevance_score", 0),
                now,
                now,
            ),
        )
        await db.commit()
        return db.total_changes > 0
    finally:
        await db.close()


async def get_posts(
    status: str | None = None,
    subreddit: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    db = await get_db()
    try:
        query = "SELECT * FROM flagged_posts WHERE 1=1"
        params: list = []
        if status:
            query += " AND status = ?"
            params.append(status)
        if subreddit:
            query += " AND subreddit = ?"
            params.append(subreddit)
        query += " ORDER BY flagged_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        cursor = await db.execute(query, params)
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        await db.close()


async def get_post(post_id: int) -> dict | None:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM flagged_posts WHERE id = ?", (post_id,)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def update_post(post_id: int, updates: dict) -> bool:
    db = await get_db()
    try:
        allowed = {"status", "notes", "assigned_to"}
        filtered = {k: v for k, v in updates.items() if k in allowed}
        if not filtered:
            return False
        filtered["updated_at"] = datetime.utcnow().isoformat()
        set_clause = ", ".join(f"{k} = ?" for k in filtered)
        values = list(filtered.values()) + [post_id]
        await db.execute(
            f"UPDATE flagged_posts SET {set_clause} WHERE id = ?", values
        )
        await db.commit()
        return db.total_changes > 0
    finally:
        await db.close()


async def get_stats() -> dict:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT status, COUNT(*) as count FROM flagged_posts GROUP BY status"
        )
        status_counts = {row["status"]: row["count"] for row in await cursor.fetchall()}

        cursor = await db.execute(
            "SELECT subreddit, COUNT(*) as count FROM flagged_posts GROUP BY subreddit ORDER BY count DESC"
        )
        subreddit_counts = {
            row["subreddit"]: row["count"] for row in await cursor.fetchall()
        }

        cursor = await db.execute("SELECT COUNT(*) as total FROM flagged_posts")
        total = (await cursor.fetchone())["total"]

        return {
            "total": total,
            "by_status": status_counts,
            "by_subreddit": subreddit_counts,
        }
    finally:
        await db.close()


async def get_config_override(key: str) -> str | None:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT value FROM config_overrides WHERE key = ?", (key,)
        )
        row = await cursor.fetchone()
        return row["value"] if row else None
    finally:
        await db.close()


async def set_config_override(key: str, value: str):
    db = await get_db()
    try:
        now = datetime.utcnow().isoformat()
        await db.execute(
            """INSERT INTO config_overrides (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?""",
            (key, value, now, value, now),
        )
        await db.commit()
    finally:
        await db.close()


async def get_all_config_overrides() -> dict:
    db = await get_db()
    try:
        cursor = await db.execute("SELECT key, value FROM config_overrides")
        return {row["key"]: row["value"] for row in await cursor.fetchall()}
    finally:
        await db.close()
