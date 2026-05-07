const REPO = "vasu-devs/JustHireMe";

function classifyAsset(asset) {
  const name = asset.name.toLowerCase();
  const url = asset.browser_download_url;
  const size = asset.size || 0;

  if (/\.(exe|msi|msix)$/.test(name) || name.includes("windows") || name.includes("win32") || name.includes("win64")) {
    return ["windows", { name: asset.name, url, size }];
  }

  if (/\.(dmg|pkg)$/.test(name) || name.includes("mac") || name.includes("darwin") || name.includes("aarch64-apple") || name.includes("x64-apple")) {
    return ["mac", { name: asset.name, url, size }];
  }

  if (/\.(appimage|deb|rpm)$/.test(name) || name.includes("linux") || name.includes("x86_64-unknown-linux")) {
    return ["linux", { name: asset.name, url, size }];
  }

  return [null, null];
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const releaseRes = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "justhireme-website",
      },
    });

    if (releaseRes.status === 404) {
      response.setHeader("cache-control", "s-maxage=60, stale-while-revalidate=300");
      response.status(200).json({
        available: false,
        tag: null,
        url: `https://github.com/${REPO}/releases`,
        assets: { windows: null, mac: null, linux: null },
      });
      return;
    }

    if (!releaseRes.ok) {
      throw new Error(`GitHub Releases API responded with ${releaseRes.status}`);
    }

    const release = await releaseRes.json();
    const assets = { windows: null, mac: null, linux: null };

    for (const asset of release.assets || []) {
      const [platform, payload] = classifyAsset(asset);
      if (platform && !assets[platform]) {
        assets[platform] = payload;
      }
    }

    response.setHeader("cache-control", "s-maxage=60, stale-while-revalidate=300");
    response.status(200).json({
      available: Boolean(release.tag_name),
      tag: release.tag_name,
      name: release.name || release.tag_name,
      publishedAt: release.published_at,
      url: release.html_url,
      assets,
    });
  } catch (error) {
    response.setHeader("cache-control", "s-maxage=30");
    response.status(200).json({
      available: false,
      tag: null,
      url: `https://github.com/${REPO}/releases`,
      assets: { windows: null, mac: null, linux: null },
    });
  }
}
