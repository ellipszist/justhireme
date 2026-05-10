"""Discovery source adapters."""

from discovery.sources.ats import (
    scrape_ashby,
    scrape_direct_ats_url,
    scrape_target as scrape_ats_target,
    scrape_greenhouse,
    is_ats_target,
    scrape_lever,
    scrape_workable,
)
from discovery.sources.apify import run_actor as run_apify_actor
from discovery.sources.apify import run_board_scan
from discovery.sources.custom import scrape_custom_connector
from discovery.sources.github_jobs import scrape_github
from discovery.sources.hackernews import scrape_hn, scrape_hn_hiring
from discovery.sources.reddit import scrape_reddit
from discovery.sources.rss import (
    scrape_jobicy_api,
    scrape_remoteok,
    scrape_remotive,
    scrape_rss,
)
from discovery.sources.x_twitter import run_x_scan
from discovery.sources.web import scrape as scrape_web
from discovery.sources.web import scrape_github_jobs_target, scrape_wellfound_target

__all__ = [
    "scrape_ashby",
    "scrape_direct_ats_url",
    "scrape_ats_target",
    "run_board_scan",
    "run_apify_actor",
    "scrape_greenhouse",
    "is_ats_target",
    "scrape_lever",
    "scrape_workable",
    "scrape_custom_connector",
    "scrape_github",
    "scrape_hn",
    "scrape_hn_hiring",
    "scrape_reddit",
    "scrape_jobicy_api",
    "scrape_remoteok",
    "scrape_remotive",
    "scrape_rss",
    "run_x_scan",
    "scrape_web",
    "scrape_github_jobs_target",
    "scrape_wellfound_target",
]
