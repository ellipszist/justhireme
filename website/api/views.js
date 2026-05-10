import { cacheableJson, cleanId, createMemoryCache, json, redis, redisConfigured, redisPipeline, send } from "./_counter.js";

const TOTAL_KEY = "justhireme:views:total";
const UNIQUE_PREFIX = "justhireme:views:visitor:";
const COUNT_CACHE = createMemoryCache(5 * 60 * 1000);

async function getViewCount(configured, baseline) {
  if (!configured) {
    return { configured: false, total: baseline };
  }

  const cached = COUNT_CACHE.get();
  if (cached) return cached;

  const total = await redis(["GET", TOTAL_KEY]);
  return COUNT_CACHE.set({
    configured: true,
    total: Number.parseInt(total || `${baseline}`, 10),
  });
}

export default async function handler(request, response) {
  try {
    const configured = redisConfigured();
    const baseline = Number.parseInt(process.env.VIEW_COUNT_BASELINE || "0", 10);

    if (request.method === "GET") {
      return send(response, cacheableJson(await getViewCount(configured, baseline)));
    }

    if (request.method !== "POST") {
      return send(response, json({ error: "Method not allowed" }, 405));
    }

    const body = typeof request.body === "object" && request.body ? request.body : {};
    const visitorId = cleanId(body.visitorId);

    if (!visitorId) {
      return send(response, json({ error: "Missing visitorId" }, 400));
    }

    if (!configured) {
      return send(response, json({ configured: false, counted: false, total: baseline }));
    }

    const visitorKey = `${UNIQUE_PREFIX}${visitorId}`;
    const [wasNew] = await redisPipeline([
      ["SET", visitorKey, "1", "NX"],
      ["SET", TOTAL_KEY, baseline, "NX"],
    ]);

    let total;
    if (wasNew) {
      total = Number.parseInt(await redis(["INCR", TOTAL_KEY]) || `${baseline}`, 10);
      COUNT_CACHE.set({ configured: true, total });
    } else {
      total = (await getViewCount(configured, baseline)).total;
    }

    return send(response, json({
      configured: true,
      counted: Boolean(wasNew),
      total,
    }));
  } catch (error) {
    return send(response, json({
      error: "View counter unavailable",
      total: Number.parseInt(process.env.VIEW_COUNT_BASELINE || "0", 10),
    }, 500));
  }
}
