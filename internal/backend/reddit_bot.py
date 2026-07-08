import re
import time
import logging
import urllib.parse
from datetime import datetime

import httpx

from config import (
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

SEARCH_URL = "https://www.reddit.com/search.json"


def _log(msg: str):
    ts = datetime.utcnow().strftime("%H:%M:%S")
    entry = f"[{ts}] {msg}"
    scan_log.append(entry)
    logger.info(msg)
    if len(scan_log) > 200:
        scan_log.pop(0)


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


def _search_reddit(query: str, limit: int) -> list[dict]:
    """Search Reddit using public JSON endpoint — no API key needed."""
    params = {
        "q": query,
        "sort": "new",
        "t": "week",
        "limit": min(limit, 100),
        "type": "link",
    }
    headers = {"User-Agent": REDDIT_USER_AGENT}

    try:
        with httpx.Client(timeout=30, follow_redirects=True) as client:
            resp = client.get(SEARCH_URL, params=params, headers=headers)

            if resp.status_code == 429:
                _log("  Rate limited by Reddit — waiting 10s before retry...")
                time.sleep(10)
                resp = client.get(SEARCH_URL, params=params, headers=headers)

            if resp.status_code != 200:
                _log(f"  Reddit returned HTTP {resp.status_code}")
                return []

            data = resp.json()
            children = data.get("data", {}).get("children", [])
            return [child["data"] for child in children if child.get("kind") == "t3"]

    except Exception as e:
        _log(f"  HTTP error: {e}")
        return []


def scan_reddit() -> list[dict]:
    """Search all of Reddit using public JSON endpoints. No API credentials needed."""
    cfg = _load_active_config()
    flagged = []
    seen_ids = set()

    _log(f"Starting scan with {len(cfg['keywords'])} keywords across all of Reddit...")
    _log(f"Using Reddit public JSON (no API key required)")
    _log(f"Keywords: {', '.join(cfg['keywords'][:10])}{'...' if len(cfg['keywords']) > 10 else ''}")
    _log(f"Intent matching: {'required' if cfg['require_intent'] else 'optional'}")

    for i, kw in enumerate(cfg["keywords"]):
        _log(f"[{i+1}/{len(cfg['keywords'])}] Searching for: \"{kw}\"")

        results = _search_reddit(kw, cfg["max_posts_per_poll"])

        kw_count = 0
        for post_data in results:
            post_id = post_data.get("id", "")
            if post_id in seen_ids:
                continue
            seen_ids.add(post_id)

            title = post_data.get("title", "")
            selftext = post_data.get("selftext", "")
            text = f"{title} {selftext}"
            matched_kw, matched_intent, score = _score_post(text, cfg)

            if len(matched_kw) < cfg["min_keyword_matches"]:
                continue
            if cfg["require_intent"] and not matched_intent:
                continue

            author = post_data.get("author", "[deleted]")
            subreddit = post_data.get("subreddit", "unknown")
            permalink = post_data.get("permalink", "")

            post = {
                "reddit_id": post_id,
                "subreddit": subreddit,
                "title": title,
                "body": selftext[:2000],
                "url": f"https://reddit.com{permalink}" if permalink else "",
                "author": author,
                "score": post_data.get("score", 0),
                "num_comments": post_data.get("num_comments", 0),
                "matched_keywords": matched_kw,
                "matched_intents": matched_intent,
                "relevance_score": score,
                "created_utc": post_data.get("created_utc", 0),
            }
            flagged.append(post)
            kw_count += 1

        _log(f"  Found {kw_count} matching posts for \"{kw}\"")

        # Respect Reddit rate limits — 1 request per 2 seconds for unauthenticated
        if i < len(cfg["keywords"]) - 1:
            time.sleep(2)

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
