import asyncio
from unittest import mock

from discovery.service import DiscoveryService


def test_discovery_service_skips_disabled_free_sources():
    service = DiscoveryService()

    result = asyncio.run(service.scan_free_sources({"free_sources_enabled": "false"}))

    assert result.leads == []
    assert result.usage == {}
    assert result.errors == []


def test_discovery_service_runs_free_sources_with_profile_targets():
    service = DiscoveryService()
    fake_lead = {"title": "Junior Builder", "url": "https://example.com/job"}

    with mock.patch("automation.free_scout.run", return_value=[fake_lead]) as run, \
         mock.patch("automation.free_scout.LAST_USAGE", {"executed": 1}), \
         mock.patch("automation.free_scout.LAST_ERRORS", []):
        result = asyncio.run(service.scan_free_sources(
            {"free_sources_enabled": "true"},
            profile={"s": "Python developer", "skills": [{"n": "FastAPI"}]},
        ))

    assert result.leads == [fake_lead]
    assert result.usage == {"executed": 1}
    assert result.errors == []
    kwargs = run.call_args.kwargs
    assert kwargs["raw_targets"]
    assert kwargs["kind_filter"] == "job"


def test_discovery_service_skips_x_without_token():
    service = DiscoveryService()

    result = asyncio.run(service.scan_x({}))

    assert result.leads == []
    assert result.usage == {}
    assert result.errors == []


def test_discovery_service_runs_x_through_source_adapter():
    service = DiscoveryService()
    fake_lead = {"title": "X hiring post", "url": "https://x.com/i/web/status/1"}

    with mock.patch("discovery.sources.x_twitter.run_x_scan") as scan:
        scan.return_value.leads = [fake_lead]
        scan.return_value.usage = {"executed_queries": 1}
        scan.return_value.errors = []
        result = asyncio.run(service.scan_x({"x_bearer_token": "tok", "x_search_queries": "hiring"}))

    assert result.leads == [fake_lead]
    assert result.usage == {"executed_queries": 1}
    assert result.errors == []
    assert scan.call_args.kwargs["bearer_token"] == "tok"


def test_discovery_service_plans_board_targets():
    service = DiscoveryService()

    with mock.patch("discovery.query_gen.generate", return_value=["site:jobs.example Python"]) as generate:
        result = asyncio.run(service.plan_board_targets({"s": "Python"}, ["site:jobs.example"], "global"))

    assert result == ["site:jobs.example Python"]
    generate.assert_called_once_with({"s": "Python"}, ["site:jobs.example"], "global")


def test_discovery_service_scans_job_boards():
    service = DiscoveryService()
    fake_lead = {"title": "Backend Engineer", "url": "https://example.com/backend"}

    with mock.patch("discovery.sources.apify.run_board_scan") as scan:
        scan.return_value.leads = [fake_lead]
        scan.return_value.usage = {"targets": 1}
        scan.return_value.errors = []
        result = asyncio.run(service.scan_job_boards(["site:jobs.example Python"], {"apify_token": "tok"}))

    assert result.leads == [fake_lead]
    assert result.usage == {"targets": 1}
    scan.assert_called_once_with(["site:jobs.example Python"], {"apify_token": "tok"})
