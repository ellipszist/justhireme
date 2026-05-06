# JustHireMe Website

Vercel project root: `website/`

## View Counter

The live unique-view counter is implemented in `api/views.js`.

For persistent counting on Vercel, add these environment variables:

```txt
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
VIEW_COUNT_BASELINE=0
```

Each browser gets a local visitor id and the API counts it once with Redis `SET NX`. The frontend polls every 15 seconds so the displayed count updates while the page is open.
