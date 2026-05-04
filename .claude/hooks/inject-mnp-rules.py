#!/usr/bin/env python
"""SessionStart hook: fetch MNP league + match rules and inject into context.

Outputs a JSON document on stdout that Claude Code reads as hook output.
The `hookSpecificOutput.additionalContext` string is appended to the model
context for the session, so Claude always has the current rules loaded.
"""
import hashlib
import json
import os
import pathlib
import re
import sys
import time
import urllib.request

URLS = [
    ("League Rules", "https://mondaynightpinball.com/leaguerules"),
    ("Match Rules", "https://mondaynightpinball.com/matchrules"),
]

CACHE_DIR = pathlib.Path(__file__).parent / ".cache"
CACHE_TTL_SECONDS = 7 * 24 * 60 * 60  # 7 days


def cache_path(url: str) -> pathlib.Path:
    h = hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]
    return CACHE_DIR / f"{h}.txt"


def fetch_url(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "claude-code-hook"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read().decode("utf-8", errors="replace")


def fetch(url: str) -> tuple[str, str]:
    """Return (html, source_label) using on-disk cache when fresh.

    source_label is "live", "cached", or "stale" so the injected context can
    note when rules are coming from a fallback.
    """
    p = cache_path(url)
    fresh = p.exists() and (time.time() - p.stat().st_mtime) < CACHE_TTL_SECONDS
    if fresh:
        return p.read_text(encoding="utf-8"), "cached"
    try:
        body = fetch_url(url)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        p.write_text(body, encoding="utf-8")
        return body, "live"
    except Exception:
        if p.exists():
            return p.read_text(encoding="utf-8"), "stale"
        raise


def html_to_text(html: str) -> str:
    # Drop scripts and styles wholesale.
    html = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.S | re.I)
    # Convert common block tags to newlines so structure survives.
    html = re.sub(r"</(p|div|li|h[1-6]|tr|br)>", "\n", html, flags=re.I)
    html = re.sub(r"<br\s*/?>", "\n", html, flags=re.I)
    # Strip remaining tags.
    text = re.sub(r"<[^>]+>", "", html)
    # Decode a handful of common entities.
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )
    # Collapse runs of blank lines.
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    parts = []
    for label, url in URLS:
        try:
            html, source = fetch(url)
            body = html_to_text(html)
            tag = "" if source == "cached" else f" [{source}]"
            parts.append(f"# Monday Night Pinball — {label}\nSource: {url}{tag}\n\n{body}")
        except Exception as e:
            parts.append(f"# Monday Night Pinball — {label}\nSource: {url}\n\n(fetch failed: {e})")

    context = (
        "Monday Night Pinball league/match rules — authoritative reference for "
        "scoring, format, and league mechanics. Consult these before answering "
        "rules-dependent questions or writing code that interprets game data.\n\n"
        + "\n\n---\n\n".join(parts)
    )

    out = {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": context,
        }
    }
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
