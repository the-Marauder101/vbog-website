import praw
import re
import json
import logging
from datetime import datetime, timedelta

from config import (
    REDDIT_CLIENT_ID,
    REDDIT_CLIENT_SECRET,
    REDDIT_USER_AGENT,
    SUBREDDITS,
    KEYWORDS,
    HIGH_INTENT_PHRASES,
    MIN_KEYWORD_MATCHES,
    REQUIRE_INTENT,
    MAX_POSTS_PER_POLL,
)
from database import insert_post, get_all_config_overrides

logger = logging.getLogger("reddit_bot")


def _get_reddit() -> praw.Reddit:
    return praw.Reddit(
        client_id=REDDIT_CLIENT_ID,
        client_secret=REDDIT_CLIENT_SECRET,
        user_agent=REDDIT_USER_AGENT,
    )


def _load_active_config() -> dict:
    """Merge env defaults with any UI-set overrides."""
    import asyncio

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures

            with concurrent.futures.ThreadPoolExecutor() as pool:
                overrides = pool.submit(
                    asyncio.run, get_all_config_overrides()
                ).result()
        else:
            overrides = loop.run_until_complete(get_all_config_overrides())
    except RuntimeError:
        overrides = asyncio.run(get_all_config_overrides())

    def _csv(val: str) -> list[str]:
        return [s.strip() for s in val.split(",") if s.strip()]

    return {
        "subreddits": _csv(overrides["subreddits"])
        if "subreddits" in overrides
        else SUBREDDITS,
        "keywords": _csv(overrides["keywords"])
        if "keywords" in overrides
        else KEYWORDS,
        "high_intent_phrases": _csv(overrides["high_intent_phrases"])
        if "high_intent_phrases" in overrides
        else HIGH_INTENT_PHRASES,
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


def scan_subreddits() -> list[dict]:
    """Scan configured subreddits and return newly flagged posts."""
    if not REDDIT_CLIENT_ID or REDDIT_CLIENT_ID == "your_client_id":
        logger.warning("Reddit credentials not configured — skipping scan")
        return []

    cfg = _load_active_config()
    reddit = _get_reddit()
    flagged = []

    for sub_name in cfg["subreddits"]:
        try:
            subreddit = reddit.subreddit(sub_name)
            for submission in subreddit.new(limit=cfg["max_posts_per_poll"]):
                text = f"{submission.title} {submission.selftext}"
                matched_kw, matched_intent, score = _score_post(text, cfg)

                if len(matched_kw) < cfg["min_keyword_matches"]:
                    continue
                if cfg["require_intent"] and not matched_intent:
                    continue

                post = {
                    "reddit_id": submission.id,
                    "subreddit": sub_name,
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

        except Exception as e:
            logger.error(f"Error scanning r/{sub_name}: {e}")

    logger.info(f"Scan complete — {len(flagged)} posts matched across {len(cfg['subreddits'])} subreddits")
    return flagged


async def run_scan() -> int:
    """Run a scan and persist results. Returns count of newly inserted posts."""
    posts = scan_subreddits()
    new_count = 0
    for post in posts:
        was_new = await insert_post(post)
        if was_new:
            new_count += 1
    logger.info(f"Inserted {new_count} new posts out of {len(posts)} matched")
    return new_count
