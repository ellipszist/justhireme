export function json(body, status = 200) {
  return { body, status };
}

export function send(response, payload) {
  response.setHeader("cache-control", payload.cacheControl || "no-store");
  response.status(payload.status).json(payload.body);
}

export function cacheableJson(body, seconds = 300, status = 200) {
  return {
    body,
    status,
    cacheControl: `public, max-age=30, s-maxage=${seconds}, stale-while-revalidate=${seconds * 6}`,
  };
}

export function redisConfigured() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

export async function redis(command) {
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

export async function redisPipeline(commands) {
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

export function cleanId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

export function createMemoryCache(ttlMs) {
  let value = null;
  let expiresAt = 0;

  return {
    get() {
      return Date.now() < expiresAt ? value : null;
    },
    set(nextValue) {
      value = nextValue;
      expiresAt = Date.now() + ttlMs;
      return value;
    },
    update(updater) {
      const current = this.get();
      if (!current) return null;
      return this.set(updater(current));
    },
  };
}
