from __future__ import annotations

import time
import threading
from collections import defaultdict

from fastapi import HTTPException


class RateLimiter:
    def __init__(self, max_calls: int, window_seconds: int):
        self.max_calls = max_calls
        self.window = window_seconds
        self._calls: dict[str, list[float]] = defaultdict(list)
        self._lock = threading.Lock()

    def allow(self, key: str = "global") -> bool:
        with self._lock:
            now = time.monotonic()
            self._calls[key] = [t for t in self._calls[key] if now - t < self.window]
            if len(self._calls[key]) >= self.max_calls:
                return False
            self._calls[key].append(now)
            return True


def require_rate_limit(limiter: RateLimiter, key: str = "global") -> None:
    if not limiter.allow(key):
        raise HTTPException(status_code=429, detail="Too many requests. Please wait.")
