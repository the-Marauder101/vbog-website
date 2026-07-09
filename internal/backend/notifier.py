import httpx
import logging
import urllib.parse

from config import (
    WHATSAPP_ENABLED,
    WHATSAPP_PHONE,
    WHATSAPP_API_KEY,
    WHATSAPP_TEAM_PHONES,
    WHATSAPP_TEAM_API_KEYS,
)

logger = logging.getLogger("notifier")

CALLMEBOT_URL = "https://api.callmebot.com/whatsapp.php"


async def send_whatsapp(phone: str, api_key: str, message: str) -> bool:
    if not phone or not api_key:
        return False
    try:
        encoded_msg = urllib.parse.quote_plus(message)
        url = f"{CALLMEBOT_URL}?phone={phone}&text={encoded_msg}&apikey={api_key}"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                logger.info(f"WhatsApp sent to {phone[-4:]}")
                return True
            logger.warning(f"WhatsApp API returned {resp.status_code} for {phone[-4:]}")
            return False
    except Exception as e:
        logger.error(f"WhatsApp send failed for {phone[-4:]}: {e}")
        return False


async def notify_new_posts(posts: list[dict]):
    if not WHATSAPP_ENABLED:
        return

    if not posts:
        return

    lines = [f"VBOG Reddit Alert: {len(posts)} new high-intent post(s) found!\n"]
    for p in posts[:5]:
        lines.append(f"r/{p['subreddit']}: {p['title'][:80]}")
        lines.append(f"  Keywords: {', '.join(p.get('matched_keywords', []))}")
        lines.append(f"  {p['url']}\n")
    if len(posts) > 5:
        lines.append(f"...and {len(posts) - 5} more. Check the dashboard.")

    message = "\n".join(lines)

    recipients = [(WHATSAPP_PHONE, WHATSAPP_API_KEY)]
    for phone, key in zip(WHATSAPP_TEAM_PHONES, WHATSAPP_TEAM_API_KEYS):
        recipients.append((phone, key))

    for phone, key in recipients:
        await send_whatsapp(phone, key, message)


async def send_reminder(phone: str, api_key: str, post: dict) -> bool:
    message = (
        f"VBOG Reminder: Review this Reddit post\n\n"
        f"r/{post['subreddit']}: {post['title'][:80]}\n"
        f"Score: {post.get('relevance_score', 0)}\n"
        f"{post['url']}"
    )
    return await send_whatsapp(phone, api_key, message)
