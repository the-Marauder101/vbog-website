import re
import time
import logging
import xml.etree.ElementTree as ET
from datetime import datetime
from collections.abc import Generator
from html import unescape

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
scan_running = False

ATOM_NS = {"atom": "http://www.w3.org/2005/Atom"}
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

TIME_FILTER_MAP = {
    "1h": "hour",
    "1d": "day",
    "7d": "week",
    "30d": "month",
    "all": "all",
}


def _log(msg: str):
    ts = datetime.utcnow().strftime("%H:%M:%S")
    entry = f"[{ts}] {msg}"
    scan_log.append(entry)
    logger.info(msg)
    if len(scan_log) > 500:
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
        "subreddits": _csv(overrides.get("subreddits", "")),
        "time_filter": overrides.get("time_filter", "7d"),
    }


def _score_post(text: str, cfg: dict) -> tuple[list[str], list[str], float]:
    text_lower = text.lower()
    matched_keywords = [kw for kw in cfg["keywords"]
                        if re.search(r"\b" + re.escape(kw.lower()) + r"\b", text_lower)]
    matched_intents = [p for p in cfg["high_intent_phrases"]
                       if p.lower() in text_lower]
    score = len(matched_keywords) * 2.0 + len(matched_intents) * 3.0
    return matched_keywords, matched_intents, score


def _extract_text_from_html(html: str) -> str:
    """Strip HTML tags to get plain text from RSS content."""
    clean = re.sub(r"<[^>]+>", " ", html)
    clean = unescape(clean)
    return re.sub(r"\s+", " ", clean).strip()


def _parse_reddit_link(href: str) -> tuple[str, str, str]:
    """Extract (subreddit, post_id, permalink) from a Reddit URL."""
    parts = href.rstrip("/").split("/")
    subreddit = ""
    post_id = ""
    for i, p in enumerate(parts):
        if p == "r" and i + 1 < len(parts):
            subreddit = parts[i + 1]
        if p == "comments" and i + 1 < len(parts):
            post_id = parts[i + 1]

    permalink = ""
    try:
        idx = href.index("/r/")
        permalink = href[idx:]
    except ValueError:
        pass

    return subreddit, post_id, permalink


def _search_rss(query: str, time_filter: str, subreddit: str | None = None) -> list[dict]:
    """Search Reddit via RSS feed (works without API key, even from cloud IPs)."""
    if subreddit:
        url = f"https://www.reddit.com/r/{subreddit}/search.rss"
        params = {"q": query, "sort": "new", "t": time_filter, "restrict_sr": "on"}
    else:
        url = "https://www.reddit.com/search.rss"
        params = {"q": query, "sort": "new", "t": time_filter}

    headers = {"User-Agent": UA}

    try:
        with httpx.Client(timeout=30, follow_redirects=True) as client:
            resp = client.get(url, params=params, headers=headers)

            if resp.status_code == 429:
                _log("  Rate limited, waiting 10s...")
                time.sleep(10)
                resp = client.get(url, params=params, headers=headers)

            if resp.status_code != 200:
                _log(f"  Reddit returned HTTP {resp.status_code}")
                return []

            root = ET.fromstring(resp.text)
            entries = root.findall("atom:entry", ATOM_NS)
            results = []

            for entry in entries:
                link_el = entry.find("atom:link", ATOM_NS)
                href = link_el.get("href", "") if link_el is not None else ""

                sub, post_id, permalink = _parse_reddit_link(href)
                if not post_id:
                    continue

                title_el = entry.find("atom:title", ATOM_NS)
                title = title_el.text if title_el is not None and title_el.text else ""

                content_el = entry.find("atom:content", ATOM_NS)
                body_html = content_el.text if content_el is not None and content_el.text else ""
                body = _extract_text_from_html(body_html)

                author_el = entry.find("atom:author/atom:name", ATOM_NS)
                author_raw = author_el.text if author_el is not None and author_el.text else "[deleted]"
                author = author_raw.replace("/u/", "")

                updated_el = entry.find("atom:updated", ATOM_NS)
                updated = updated_el.text if updated_el is not None else ""

                results.append({
                    "reddit_id": post_id,
                    "subreddit": sub,
                    "title": title,
                    "body": body[:2000],
                    "url": href,
                    "permalink": permalink,
                    "author": author,
                    "updated": updated,
                })

            return results

    except ET.ParseError as e:
        _log(f"  XML parse error: {e}")
        return []
    except Exception as e:
        _log(f"  HTTP error: {e}")
        return []


def _fetch_post_details(permalink: str) -> dict | None:
    """Fetch score and comment count for a single post via JSON."""
    if not permalink:
        return None
    url = f"https://www.reddit.com{permalink}.json"
    headers = {"User-Agent": UA}

    try:
        with httpx.Client(timeout=15, follow_redirects=True) as client:
            resp = client.get(url, headers=headers)
            if resp.status_code != 200:
                return None
            data = resp.json()
            if isinstance(data, list) and data:
                post = data[0].get("data", {}).get("children", [{}])[0].get("data", {})
                return {
                    "score": post.get("score", 0),
                    "num_comments": post.get("num_comments", 0),
                    "selftext": post.get("selftext", ""),
                    "created_utc": post.get("created_utc", 0),
                }
    except Exception:
        pass
    return None


def scan_reddit_streaming() -> Generator[dict, None, None]:
    """Search Reddit and yield events as posts are found."""
    global scan_running
    scan_running = True
    scan_log.clear()

    try:
        cfg = _load_active_config()
        seen_ids: set[str] = set()
        total_found = 0
        reddit_time = TIME_FILTER_MAP.get(cfg["time_filter"], "week")
        subreddits = cfg["subreddits"]

        _log(f"Starting scan: {len(cfg['keywords'])} keywords, freshness={cfg['time_filter']}")
        if subreddits:
            _log(f"Searching in: r/{', r/'.join(subreddits)}")
        else:
            _log("Searching all of Reddit")

        yield {"type": "status", "message": f"Scanning {len(cfg['keywords'])} keywords..."}

        search_targets = subreddits if subreddits else [None]

        for kw_idx, kw in enumerate(cfg["keywords"]):
            for target in search_targets:
                target_label = f"r/{target}" if target else "r/all"
                _log(f"[{kw_idx+1}/{len(cfg['keywords'])}] \"{kw}\" in {target_label}")

                yield {
                    "type": "progress",
                    "keyword": kw,
                    "target": target_label,
                    "current": kw_idx + 1,
                    "total": len(cfg["keywords"]),
                }

                results = _search_rss(kw, reddit_time, target)

                kw_count = 0
                for item in results:
                    pid = item["reddit_id"]
                    if pid in seen_ids:
                        continue
                    seen_ids.add(pid)

                    text = f"{item['title']} {item['body']}"
                    matched_kw, matched_intent, score = _score_post(text, cfg)

                    if len(matched_kw) < cfg["min_keyword_matches"]:
                        continue
                    if cfg["require_intent"] and not matched_intent:
                        continue

                    post = {
                        "reddit_id": pid,
                        "subreddit": item["subreddit"],
                        "title": item["title"],
                        "body": item["body"],
                        "url": item["url"],
                        "author": item["author"],
                        "score": 0,
                        "num_comments": 0,
                        "matched_keywords": matched_kw,
                        "matched_intents": matched_intent,
                        "relevance_score": score,
                        "created_utc": 0,
                    }

                    # Try to get score/comments (best-effort, don't fail scan)
                    details = _fetch_post_details(item.get("permalink", ""))
                    if details:
                        post["score"] = details["score"]
                        post["num_comments"] = details["num_comments"]
                        post["created_utc"] = details["created_utc"]
                        if details["selftext"] and len(details["selftext"]) > len(post["body"]):
                            post["body"] = details["selftext"][:2000]
                        time.sleep(1)

                    total_found += 1
                    kw_count += 1

                    yield {"type": "post_found", "post": post, "total_so_far": total_found}

                _log(f"  {kw_count} matches for \"{kw}\" in {target_label}")

                time.sleep(2)

        _log(f"Scan complete: {total_found} posts found")
        yield {"type": "done", "total_found": total_found}

    except Exception as e:
        _log(f"Scan error: {e}")
        yield {"type": "error", "message": str(e)}
    finally:
        scan_running = False


async def run_scan() -> dict:
    """Non-streaming scan for scheduled runs."""
    scan_log.clear()
    _log("Scheduled scan triggered")
    new_count = 0
    total = 0
    for event in scan_reddit_streaming():
        if event["type"] == "post_found":
            total += 1
            was_new = await insert_post(event["post"])
            if was_new:
                new_count += 1
    _log(f"Results: {new_count} new, {total - new_count} duplicates")
    return {"new_posts": new_count, "total_matched": total, "duplicates_skipped": total - new_count}
