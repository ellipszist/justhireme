const IDENTITY_KEYS = ["email", "phone", "linkedin_url", "github_url", "website_url", "city"] as const;

export type ProfileTextType = "education" | "certification" | "achievement";

const asArray = (value: unknown): any[] => Array.isArray(value) ? value : [];

export const entryTitle = (item: unknown): string =>
  typeof item === "string" ? item : String((item as any)?.title || "");

export function normalizeProfileResponse(data: unknown) {
  const source = data && typeof data === "object" ? data as Record<string, any> : {};
  const identitySource = source.identity && typeof source.identity === "object" ? source.identity as Record<string, any> : {};
  const identity = Object.fromEntries(
    IDENTITY_KEYS.map(key => [key, String(identitySource[key] || source[key] || "")]),
  );

  return {
    ...source,
    n: String(source.n || ""),
    s: String(source.s || ""),
    skills: asArray(source.skills),
    projects: asArray(source.projects),
    exp: asArray(source.exp),
    education: asArray(source.education),
    certifications: asArray(source.certifications || source.certs),
    achievements: asArray(source.achievements || source.awards),
    identity,
  };
}

export function profileDeletePath(type: string, idOrTitle: string) {
  return `/api/v1/profile/${type}/${encodeURIComponent(idOrTitle)}`;
}
