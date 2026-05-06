const TOTAL_KEY = "justhireme:views:total";
const UNIQUE_PREFIX = "justhireme:views:visitor:";

function json(body, status = 200) {
  return { body, status };
}

async function redis(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return null;
  }

  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify([command]),
  });

  if (!response.ok) {
    throw new Error(`Redis request failed with ${response.status}`);
  }

  const [payload] = await response.json();
  if (payload?.error) {
    throw new Error(payload.error);
  }
  return payload?.result;
}

async function redisPipeline(commands) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return null;
  }

  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  if (!response.ok) {
    throw new Error(`Redis request failed with ${response.status}`);
  }

  const payload = await response.json();
  const error = payload.find((item) => item?.error);
  if (error) {
    throw new Error(error.error);
  }
  return payload.map((item) => item?.result);
}

function send(response, payload) {
  response.setHeader("cache-control", "no-store");
  response.status(payload.status).json(payload.body);
}

export default async function handler(request, response) {
  try {
    const configured = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
    const baseline = Number.parseInt(process.env.VIEW_COUNT_BASELINE || "0", 10);

    if (request.method === "GET") {
      const total = configured ? await redis(["GET", TOTAL_KEY]) : null;
      return send(response, json({
        configured,
        total: Number.parseInt(total || `${baseline}`, 10),
      }));
    }

    if (request.method !== "POST") {
      return send(response, json({ error: "Method not allowed" }, 405));
    }

    const body = typeof request.body === "object" && request.body ? request.body : {};
    const visitorId = String(body.visitorId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);

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

    const total = wasNew
      ? await redis(["INCR", TOTAL_KEY])
      : await redis(["GET", TOTAL_KEY]);

    return send(response, json({
      configured: true,
      counted: Boolean(wasNew),
      total: Number.parseInt(total || `${baseline}`, 10),
    }));
  } catch (error) {
    return send(response, json({
      error: "View counter unavailable",
      total: Number.parseInt(process.env.VIEW_COUNT_BASELINE || "0", 10),
    }, 500));
  }
}
