from __future__ import annotations

import inspect
from collections import defaultdict
from collections.abc import Awaitable, Callable
from typing import Any, Protocol


EventHandler = Callable[[str, dict[str, Any]], None | Awaitable[None]]

SCAN_STARTED = "scan_started"
SCAN_PROGRESS = "scan_progress"
SCAN_DONE = "scan_done"
LEAD_SCORED = "lead_scored"
LEAD_UPDATED = "lead_updated"
GENERATION_STARTED = "generation_started"
GENERATION_DONE = "generation_done"


class EventBus(Protocol):
    async def publish(self, event_type: str, data: dict[str, Any]) -> None: ...
    def subscribe(self, event_type: str, handler: EventHandler) -> None: ...


class InProcessEventBus:
    def __init__(self) -> None:
        self._handlers: dict[str, list[EventHandler]] = defaultdict(list)

    def subscribe(self, event_type: str, handler: EventHandler) -> None:
        self._handlers[event_type].append(handler)

    async def publish(self, event_type: str, data: dict[str, Any]) -> None:
        handlers = [*self._handlers.get(event_type, ()), *self._handlers.get("*", ())]
        for handler in handlers:
            result = handler(event_type, data)
            if inspect.isawaitable(result):
                await result
