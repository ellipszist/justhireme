from __future__ import annotations

from ranking.criteria.base import CriterionSpec
from ranking.criteria.evidence import SPEC as EVIDENCE
from ranking.criteria.learning_curve import SPEC as LEARNING_CURVE
from ranking.criteria.logistics import SPEC as LOGISTICS
from ranking.criteria.role_alignment import SPEC as ROLE_ALIGNMENT
from ranking.criteria.seniority_fit import SPEC as SENIORITY_FIT
from ranking.criteria.stack_coverage import SPEC as STACK_COVERAGE

DEFAULT_CRITERIA: tuple[CriterionSpec, ...] = (
    ROLE_ALIGNMENT,
    STACK_COVERAGE,
    EVIDENCE,
    SENIORITY_FIT,
    LOGISTICS,
    LEARNING_CURVE,
)


def criteria_by_key() -> dict[str, CriterionSpec]:
    return {criterion.key: criterion for criterion in DEFAULT_CRITERIA}


def criteria_by_name() -> dict[str, CriterionSpec]:
    return {criterion.name: criterion for criterion in DEFAULT_CRITERIA}
