import { cacheableJson, cleanId, createMemoryCache, json, redisConfigured, redisPipeline, send } from "./_counter.js";

const TOTAL_KEY = "justhireme:downloads:total";
const UNIQUE_PREFIX = "justhireme:downloads:visitor:";
const PLATFORM_KEYS = {
  windows: "justhireme:downloads:windows",
  mac: "justhireme:downloads:mac",
  linux: "justhireme:downloads:linux",
};
const COUNT_CACHE = createMemoryCache(5 * 60 * 1000);

function cleanPlatform(value) {
  const platform = String(value || "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(PLATFORM_KEYS, platform) ? platform : null;
}

function countsFromResults(results, baseline) {
  return {
    total: Number.parseInt(results?.[0] || `${baseline}`, 10),
    windows: Number.parseInt(results?.[1] || "0", 10),
    mac: Number.parseInt(results?.[2] || "0", 10),
    linux: Number.parseInt(results?.[3] || "0", 10),
  };
}

async function getDownloadCounts(configured, baseline) {
  if (!configured) {
    return { configured: false, total: baseline, windows: 0, mac: 0, linux: 0 };
  }

  const cached = COUNT_CACHE.get();
  if (cached) return cached;

  const counts = countsFromResults(await redisPipeline([
    ["GET", TOTAL_KEY],
    ["GET", PLATFORM_KEYS.windows],
    ["GET", PLATFORM_KEYS.mac],
    ["GET", PLATFORM_KEYS.linux],
  ]), baseline);
  return COUNT_CACHE.set({ configured: true, ...counts });
}

export default async function handler(request, response) {
  try {
    const configured = redisConfigured();
    const baseline = Number.parseInt(process.env.DOWNLOAD_COUNT_BASELINE || "0", 10);

    if (request.method === "GET") {
      return send(response, cacheableJson(await getDownloadCounts(configured, baseline)));
    }

    if (request.method !== "POST") {
      return send(response, json({ error: "Method not allowed" }, 405));
    }

    const body = typeof request.body === "object" && request.body ? request.body : {};
    const visitorId = cleanId(body.visitorId);
    const platform = cleanPlatform(body.platform);

    if (!visitorId) {
      return send(response, json({ error: "Missing visitorId" }, 400));
    }

    if (!platform) {
      return send(response, json({ error: "Missing platform" }, 400));
    }

    if (!configured) {
      return send(response, json({ configured: false, counted: false, total: baseline, windows: 0, mac: 0, linux: 0 }));
    }

    const visitorKey = `${UNIQUE_PREFIX}${platform}:${visitorId}`;
    const [wasNew] = await redisPipeline([
      ["SET", visitorKey, "1", "NX"],
      ["SET", TOTAL_KEY, baseline, "NX"],
    ]);

    let counts;
    if (wasNew) {
      const [total, platformTotal] = await redisPipeline([
        ["INCR", TOTAL_KEY],
        ["INCR", PLATFORM_KEYS[platform]],
      ]);
      const cached = COUNT_CACHE.get();
      counts = COUNT_CACHE.set({
        configured: true,
        total: Number.parseInt(total || `${cached?.total || baseline}`, 10),
        windows: cached?.windows || 0,
        mac: cached?.mac || 0,
        linux: cached?.linux || 0,
        [platform]: Number.parseInt(platformTotal || `${cached?.[platform] || 0}`, 10),
      });
    } else {
      counts = await getDownloadCounts(configured, baseline);
    }

    return send(response, json({
      configured: true,
      counted: Boolean(wasNew),
      platform,
      ...counts,
    }));
  } catch (error) {
    return send(response, json({
      error: "Download counter unavailable",
      total: Number.parseInt(process.env.DOWNLOAD_COUNT_BASELINE || "0", 10),
      windows: 0,
      mac: 0,
      linux: 0,
    }, 500));
  }
}
