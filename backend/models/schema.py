from pydantic import BaseModel, Field
from typing import List, Optional


class S(BaseModel):
    n:   str
    cat: str = "general"


class E(BaseModel):
    role:   str
    co:     str
    period: str
    d:      str
    s:      List[str] = Field(default_factory=list)


class P(BaseModel):
    title:  str
    stack:  List[str]       = Field(default_factory=list)
    repo:   Optional[str]   = None
    impact: str             = ""
    s:      List[str]       = Field(default_factory=list)


class C(BaseModel):
    n:        str
    s:        str      = ""
    skills:   List[S]  = Field(default_factory=list)
    exp:      List[E]  = Field(default_factory=list)
    projects: List[P]  = Field(default_factory=list)
