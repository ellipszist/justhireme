from __future__ import annotations

from typing import Protocol, TypedDict


class RawLead(TypedDict, total=False):
    title: str
    company: str
    url: str
    platform: str
    description: str
    posted_date: str
    source_meta: dict


class Source(Protocol):
    name: str

    async def fetch(self, queries: list[str], config: dict) -> list[RawLead]: ...

