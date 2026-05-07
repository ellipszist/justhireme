import { cleanId, json, redis, redisConfigured, redisPipeline, send } from "./_counter.js";

const TOTAL_KEY = "justhireme:downloads:total";
const UNIQUE_PREFIX = "justhireme:downloads:visitor:";
const PLATFORM_KEYS = {
  windows: "justhireme:downloads:windows",
  mac: "justhireme:downloads:mac",
  linux: "justhireme:downloads:linux",
};

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

export default async function handler(request, response) {
  try {
    const configured = redisConfigured();
    const baseline = Number.parseInt(process.env.DOWNLOAD_COUNT_BASELINE || "0", 10);

    if (request.method === "GET") {
      const counts = configured
        ? countsFromResults(await redisPipeline([
          ["GET", TOTAL_KEY],
          ["GET", PLATFORM_KEYS.windows],
          ["GET", PLATFORM_KEYS.mac],
          ["GET", PLATFORM_KEYS.linux],
        ]), baseline)
        : { total: baseline, windows: 0, mac: 0, linux: 0 };
      return send(response, json({
        configured,
        ...counts,
      }));
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
      ["SET", PLATFORM_KEYS.windows, 0, "NX"],
      ["SET", PLATFORM_KEYS.mac, 0, "NX"],
      ["SET", PLATFORM_KEYS.linux, 0, "NX"],
    ]);

    if (wasNew) {
      await redisPipeline([
        ["INCR", TOTAL_KEY],
        ["INCR", PLATFORM_KEYS[platform]],
      ]);
    }

    const counts = countsFromResults(await redisPipeline([
      ["GET", TOTAL_KEY],
      ["GET", PLATFORM_KEYS.windows],
      ["GET", PLATFORM_KEYS.mac],
      ["GET", PLATFORM_KEYS.linux],
    ]), baseline);

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
