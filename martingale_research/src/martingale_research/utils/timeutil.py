from __future__ import annotations

from datetime import datetime, timezone


def parse_utc_iso8601(s: str) -> datetime:
    # Minimal helper: expects e.g. 2026-05-01T00:00:00Z
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)
