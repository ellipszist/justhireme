import { describe, expect, it } from "vitest";
import { normalizeProfileResponse, profileDeletePath } from "./profileUtils";

describe("normalizeProfileResponse", () => {
  it("normalizes partial profile payloads instead of rejecting them", () => {
    const profile = normalizeProfileResponse({
      n: "Vasu",
      identity: { email: "vasu@example.com" },
      certs: ["AWS"],
      awards: ["Shipped"],
    });

    expect(profile.n).toBe("Vasu");
    expect(profile.skills).toEqual([]);
    expect(profile.projects).toEqual([]);
    expect(profile.exp).toEqual([]);
    expect(profile.certifications).toEqual(["AWS"]);
    expect(profile.achievements).toEqual(["Shipped"]);
    expect(profile.identity.email).toBe("vasu@example.com");
    expect(profile.identity.github_url).toBe("");
  });
});

describe("profileDeletePath", () => {
  it("encodes text profile entries so slashes and spaces survive routing", () => {
    expect(profileDeletePath("education", "B.Tech / MBA")).toBe("/api/v1/profile/education/B.Tech%20%2F%20MBA");
  });
});
