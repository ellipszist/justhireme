from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from core.types import CandidateEvidence, CriterionScore


class Criterion(Protocol):
    name: str
    max_weight: int

    def evaluate(self, job: str, candidate: CandidateEvidence) -> CriterionScore: ...


@dataclass(frozen=True)
class CriterionSpec:
    key: str
    name: str
    max_weight: int
    description: str = ""
