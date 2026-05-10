# JustHireMe Website

Vercel project root: `website/`

## View Counter

The live unique-view counter is implemented in `api/views.js`.

For persistent counting on Vercel, add these environment variables:

```txt
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
VIEW_COUNT_BASELINE=0
DOWNLOAD_COUNT_BASELINE=0
```

Each browser gets a local visitor id and the API counts it once with Redis `SET NX`. Counter reads are cached by the API and CDN for five minutes, and the frontend refreshes visible counters every five minutes while the tab is active. This keeps the public page from burning through Upstash read commands.

## Download Counter

The download counter is implemented in `api/downloads.js`. It uses the same visitor id and Redis `SET NX` pattern so one browser is counted once per platform when a real installer asset is clicked. It tracks total downloads plus individual Windows, macOS, and Linux counts. Set `DOWNLOAD_COUNT_BASELINE=0` for a fresh public launch.

## Release Downloads

The platform download buttons are powered by `api/releases.js`, which reads the latest GitHub release from `vasu-devs/JustHireMe` and maps release assets to:

- Windows: `.exe`, `.msi`, `.msix`, or asset names containing `windows`, `win32`, `win64`
- macOS: `.dmg`, `.pkg`, or asset names containing `mac`, `darwin`, `apple`
- Linux: `.AppImage`, `.deb`, `.rpm`, or asset names containing `linux`

If an asset is missing, that platform button stays disabled and says `Available soon`.

## Feedback And Reviews

The feedback and review forms post to `api/feedback.js`.

To create GitHub issues from submissions, add:

```txt
GITHUB_FEEDBACK_TOKEN=...
GITHUB_FEEDBACK_REPO=vasu-devs/JustHireMe
```

The token needs permission to create issues on the target repository. `GITHUB_FEEDBACK_REPO` is optional and defaults to `vasu-devs/JustHireMe`.

Create these labels in the repository for a cleaner feedback inbox:

```txt
website-feedback
feedback
review
```

Then use filtered issue pages:

- Feedback inbox: `https://github.com/vasu-devs/JustHireMe/issues?q=is%3Aissue%20label%3Awebsite-feedback`
- Reviews only: `https://github.com/vasu-devs/JustHireMe/issues?q=is%3Aissue%20label%3Areview`

Feedback and review submissions are delivered through GitHub issues only. If GitHub issue delivery is not configured, the endpoint returns `202` and the page tells the visitor that delivery setup is still needed.
