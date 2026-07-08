import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))


def _csv(key: str, default: str = "") -> list[str]:
    raw = os.getenv(key, default)
    return [s.strip() for s in raw.split(",") if s.strip()]


REDDIT_USER_AGENT = os.getenv("REDDIT_USER_AGENT", "VBOG-Monitor/1.0")

KEYWORDS = _csv(
    "KEYWORDS",
    "bookkeeping,accounting,virtual cfo,cfo services,financial reporting,tax filing,gst,payroll,outsource accounting,offshore accounting,back office,business operations,vbog,v-bog",
)
HIGH_INTENT_PHRASES = _csv(
    "HIGH_INTENT_PHRASES",
    "looking for,need help with,recommend,suggestion,anyone use,best service,how to find,where can i,searching for,can someone suggest,affordable,cost of,pricing,hire,outsource",
)
MIN_KEYWORD_MATCHES = int(os.getenv("MIN_KEYWORD_MATCHES", "1"))
REQUIRE_INTENT = os.getenv("REQUIRE_INTENT", "true").lower() == "true"
POLL_INTERVAL_MINUTES = int(os.getenv("POLL_INTERVAL_MINUTES", "10"))
MAX_POSTS_PER_POLL = int(os.getenv("MAX_POSTS_PER_POLL", "25"))

WHATSAPP_ENABLED = os.getenv("WHATSAPP_ENABLED", "false").lower() == "true"
WHATSAPP_PHONE = os.getenv("WHATSAPP_PHONE", "")
WHATSAPP_API_KEY = os.getenv("WHATSAPP_API_KEY", "")
WHATSAPP_TEAM_PHONES = _csv("WHATSAPP_TEAM_PHONES")
WHATSAPP_TEAM_API_KEYS = _csv("WHATSAPP_TEAM_API_KEYS")

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))
