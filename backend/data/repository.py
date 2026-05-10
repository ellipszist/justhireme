from __future__ import annotations

from dataclasses import dataclass

from data import feedback
from data.graph import profile
from data.graph import connection as graph
from data.sqlite import events, leads, settings
from data.vector import connection as vector


@dataclass(frozen=True)
class Repository:
    events = events
    feedback = feedback
    graph = graph
    leads = leads
    profile = profile
    settings = settings
    vector = vector


def create_repository() -> Repository:
    return Repository()
