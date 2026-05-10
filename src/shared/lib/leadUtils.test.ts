import { describe, expect, it } from "vitest";
import type { Lead } from "../../types";
import {
  getMark,
  leadDisplayHeading,
  normalizeSeniority,
  seniorityMatches,
  sortLeads,
  stripCompanyPrefix,
} from "./leadUtils";

const lead = (overrides: Partial<Lead> = {}): Lead => ({
  job_id: overrides.job_id || "lead",
  title: overrides.title || "Engineer",
  company: overrides.company || "Acme",
  url: overrides.url || "",
  platform: overrides.platform || "test",
  status: overrides.status || "discovered",
  asset: overrides.asset || "",
  score: overrides.score ?? 0,
  reason: overrides.reason || "",
  match_points: overrides.match_points || [],
  ...overrides,
});

describe("normalizeSeniority", () => {
  it("normalizes known seniority labels", () => {
    expect(normalizeSeniority("Senior")).toBe("senior");
    expect(normalizeSeniority("SENIOR")).toBe("senior");
    expect(normalizeSeniority("Entry Level")).toBe("junior");
  });

  it("returns unknown for empty or unrecognized values", () => {
    expect(normalizeSeniority(null)).toBe("unknown");
    expect(normalizeSeniority(undefined)).toBe("unknown");
    expect(normalizeSeniority("")).toBe("unknown");
    expect(normalizeSeniority("wizard")).toBe("unknown");
  });
});

describe("seniorityMatches", () => {
  it("matches all leads when the filter is all", () => {
    expect(seniorityMatches(lead({ seniority_level: "Senior" }), "all")).toBe(true);
    expect(seniorityMatches(lead({ seniority_level: "" }), "all")).toBe(true);
  });

  it("matches and rejects specific seniority filters", () => {
    const senior = lead({ seniority_level: "Senior" });
    expect(seniorityMatches(senior, "senior")).toBe(true);
    expect(seniorityMatches(senior, "junior")).toBe(false);
  });
});

describe("sortLeads", () => {
  it("keeps newest input first for newest sort", () => {
    const later = lead({ job_id: "later", source_meta: { created_at: "2026-05-02" } });
    const earlier = lead({ job_id: "earlier", source_meta: { created_at: "2026-05-01" } });
    expect(sortLeads([later, earlier], "newest").map(l => l.job_id)).toEqual(["later", "earlier"]);
  });

  it("sorts by signal and match score", () => {
    expect(sortLeads([
      lead({ job_id: "low", signal_score: 20 }),
      lead({ job_id: "high", signal_score: 80 }),
    ], "signal").map(l => l.job_id)).toEqual(["high", "low"]);

    expect(sortLeads([
      lead({ job_id: "low", score: 30 }),
      lead({ job_id: "high", score: 90 }),
    ], "match").map(l => l.job_id)).toEqual(["high", "low"]);
  });

  it("preserves order for ties", () => {
    expect(sortLeads([
      lead({ job_id: "first", signal_score: 50 }),
      lead({ job_id: "second", signal_score: 50 }),
    ], "signal").map(l => l.job_id)).toEqual(["first", "second"]);
  });
});

describe("leadDisplayHeading", () => {
  it("returns the title when company is absent", () => {
    expect(leadDisplayHeading(lead({ title: "Frontend Engineer", company: "" })).role).toBe("Frontend Engineer");
  });

  it("strips a company prefix from the title", () => {
    expect(leadDisplayHeading(lead({ title: "Acme | Engineer", company: "Acme" })).role).toBe("Engineer");
  });
});

describe("stripCompanyPrefix", () => {
  it("strips a leading company prefix", () => {
    expect(stripCompanyPrefix("Acme - Engineer", "Acme")).toBe("Engineer");
  });

  it("leaves non-prefix strings unchanged", () => {
    expect(stripCompanyPrefix("Engineer at Acme", "Acme")).toBe("Engineer at Acme");
  });
});

describe("getMark", () => {
  it("returns the first letter uppercased", () => {
    expect(getMark("anthropic")).toBe("A");
  });

  it("returns a fallback mark for empty company names", () => {
    expect(getMark("")).toBe("?");
  });
});
