import praw
import re
import logging
from datetime import datetime

from config import (
    REDDIT_CLIENT_ID,
    REDDIT_CLIENT_SECRET,
    REDDIT_USER_AGENT,
    KEYWORDS,
    HIGH_INTENT_PHRASES,
    MIN_KEYWORD_MATCHES,
    REQUIRE_INTENT,
    MAX_POSTS_PER_POLL,
)
from database import insert_post, get_all_config_overrides

logger = logging.getLogger("reddit_bot")

scan_log: list[str] = []


def _log(msg: str):
    ts = datetime.utcnow().strftime("%H:%M:%S")
    entry = f"[{ts}] {msg}"
    scan_log.append(entry)
    logger.info(msg)
    if len(scan_log) > 200:
        scan_log.pop(0)


def _get_reddit() -> praw.Reddit:
    return praw.Reddit(
        client_id=REDDIT_CLIENT_ID,
        client_secret=REDDIT_CLIENT_SECRET,
        user_agent=REDDIT_USER_AGENT,
    )


def _load_active_config() -> dict:
    import asyncio

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                overrides = pool.submit(asyncio.run, get_all_config_overrides()).result()
        else:
            overrides = loop.run_until_complete(get_all_config_overrides())
    except RuntimeError:
        overrides = asyncio.run(get_all_config_overrides())

    def _csv(val: str) -> list[str]:
        return [s.strip() for s in val.split(",") if s.strip()]

    return {
        "keywords": _csv(overrides["keywords"]) if "keywords" in overrides else KEYWORDS,
        "high_intent_phrases": _csv(overrides["high_intent_phrases"]) if "high_intent_phrases" in overrides else HIGH_INTENT_PHRASES,
        "min_keyword_matches": int(overrides.get("min_keyword_matches", MIN_KEYWORD_MATCHES)),
        "require_intent": overrides.get("require_intent", str(REQUIRE_INTENT)).lower() == "true",
        "max_posts_per_poll": int(overrides.get("max_posts_per_poll", MAX_POSTS_PER_POLL)),
    }


def _score_post(text: str, cfg: dict) -> tuple[list[str], list[str], float]:
    text_lower = text.lower()
    matched_keywords = []
    for kw in cfg["keywords"]:
        if re.search(r"\b" + re.escape(kw.lower()) + r"\b", text_lower):
            matched_keywords.append(kw)

    matched_intents = []
    for phrase in cfg["high_intent_phrases"]:
        if phrase.lower() in text_lower:
            matched_intents.append(phrase)

    score = len(matched_keywords) * 2.0 + len(matched_intents) * 3.0
    return matched_keywords, matched_intents, score


def scan_reddit() -> list[dict]:
    """Search all of Reddit using keywords. No subreddit config needed."""
    if not REDDIT_CLIENT_ID or REDDIT_CLIENT_ID == "your_client_id":
        _log("Reddit credentials not configured. Add REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET to your .env file.")
        _log("Get free credentials at: https://www.reddit.com/prefs/apps (create a 'script' type app)")
        return []

    cfg = _load_active_config()
    reddit = _get_reddit()
    flagged = []
    seen_ids = set()

    _log(f"Starting scan with {len(cfg['keywords'])} keywords across all of Reddit...")
    _log(f"Keywords: {', '.join(cfg['keywords'][:10])}{'...' if len(cfg['keywords']) > 10 else ''}")
    _log(f"Intent matching: {'required' if cfg['require_intent'] else 'optional'}")

    for kw in cfg["keywords"]:
        try:
            _log(f"Searching Reddit for: \"{kw}\"")
            results = reddit.subreddit("all").search(
                kw,
                sort="new",
                time_filter="week",
                limit=cfg["max_posts_per_poll"],
            )

            kw_count = 0
            for submission in results:
                if submission.id in seen_ids:
                    continue
                seen_ids.add(submission.id)

                text = f"{submission.title} {submission.selftext}"
                matched_kw, matched_intent, score = _score_post(text, cfg)

                if len(matched_kw) < cfg["min_keyword_matches"]:
                    continue
                if cfg["require_intent"] and not matched_intent:
                    continue

                post = {
                    "reddit_id": submission.id,
                    "subreddit": str(submission.subreddit),
                    "title": submission.title,
                    "body": submission.selftext[:2000],
                    "url": f"https://reddit.com{submission.permalink}",
                    "author": str(submission.author) if submission.author else "[deleted]",
                    "score": submission.score,
                    "num_comments": submission.num_comments,
                    "matched_keywords": matched_kw,
                    "matched_intents": matched_intent,
                    "relevance_score": score,
                    "created_utc": submission.created_utc,
                }
                flagged.append(post)
                kw_count += 1

            _log(f"  Found {kw_count} matching posts for \"{kw}\"")

        except Exception as e:
            _log(f"  Error searching for \"{kw}\": {e}")

    _log(f"Scan complete: {len(flagged)} total posts matched (deduplicated)")
    return flagged


async def run_scan() -> dict:
    """Run a scan and persist results. Returns scan summary."""
    scan_log.clear()
    _log("Scan triggered")
    posts = scan_reddit()
    new_count = 0
    duplicate_count = 0
    for post in posts:
        was_new = await insert_post(post)
        if was_new:
            new_count += 1
        else:
            duplicate_count += 1

    _log(f"Results: {new_count} new posts saved, {duplicate_count} duplicates skipped")
    if new_count == 0 and not posts:
        _log("No posts found. Try broadening your keywords or disabling intent matching.")

    return {
        "new_posts": new_count,
        "total_matched": len(posts),
        "duplicates_skipped": duplicate_count,
        "log": list(scan_log),
    }
