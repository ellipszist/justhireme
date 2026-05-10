"""Pluggable scoring criteria for the ranking domain."""

from ranking.criteria.base import Criterion, CriterionSpec
from ranking.criteria.registry import DEFAULT_CRITERIA, criteria_by_key, criteria_by_name

__all__ = [
    "Criterion",
    "CriterionSpec",
    "DEFAULT_CRITERIA",
    "criteria_by_key",
    "criteria_by_name",
]
