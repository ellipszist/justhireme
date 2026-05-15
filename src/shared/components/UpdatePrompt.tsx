import { useEffect, useMemo, useState } from "react";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type UpdateState = "checking" | "available" | "downloading" | "installing" | "ready" | "error";

function formatBytes(value: number) {
  if (!value) return "0 MB";
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "a moment";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  return `${Math.round(seconds / 60)} min`;
}

export function UpdatePrompt() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [state, setState] = useState<UpdateState>("checking");
  const [error, setError] = useState("");
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [dismissedVersion, setDismissedVersion] = useState(() => localStorage.getItem("jhm.dismissedUpdate") || "");

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      check({ timeout: 12000 })
        .then(next => {
          if (!alive) return;
          if (!next || next.version === dismissedVersion) {
            setUpdate(null);
            return;
          }
          setUpdate(next);
          setState("available");
        })
        .catch(() => {
          if (alive) setUpdate(null);
        });
    }, 4500);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [dismissedVersion]);

  const progress = useMemo(() => {
    if (!total) return null;
    return Math.min(100, Math.round((downloaded / total) * 100));
  }, [downloaded, total]);

  useEffect(() => {
    if (state !== "downloading" && state !== "installing") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state]);

  const elapsedSeconds = startedAt ? Math.max(1, (now - startedAt) / 1000) : 0;
  const bytesPerSecond = state === "downloading" && elapsedSeconds > 0 ? downloaded / elapsedSeconds : 0;
  const etaSeconds = total && bytesPerSecond > 0 ? Math.max(0, (total - downloaded) / bytesPerSecond) : null;
  const updateMessage = (() => {
    if (state === "ready") return "The update is installed. Restart to finish.";
    if (state === "installing") return "Download complete. Windows is applying the update; this can take a few minutes.";
    if (state === "downloading") return "Downloading the signed update. You can keep using JustHireMe while this runs.";
    return `You are running ${update?.currentVersion}. Install the latest signed build now.`;
  })();
  const progressLabel = (() => {
    if (state === "installing") return `Applying update, elapsed ${formatDuration(elapsedSeconds)}.`;
    if (progress !== null && total) {
      const eta = etaSeconds !== null ? `, about ${formatDuration(etaSeconds)} left` : "";
      return `${progress}% - ${formatBytes(downloaded)} of ${formatBytes(total)}${eta}`;
    }
    if (downloaded > 0) return `${formatBytes(downloaded)} downloaded - estimating time remaining`;
    return "Preparing download - usually a few minutes on a normal connection";
  })();

  if (!update) return null;

  const dismiss = () => {
    localStorage.setItem("jhm.dismissedUpdate", update.version);
    setDismissedVersion(update.version);
    setUpdate(null);
  };

  const install = async () => {
    setState("downloading");
    setError("");
    setDownloaded(0);
    setTotal(null);
    setStartedAt(Date.now());
    setNow(Date.now());
    try {
      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          setTotal(event.data.contentLength ?? null);
          setDownloaded(0);
        } else if (event.event === "Progress") {
          setDownloaded(prev => prev + event.data.chunkLength);
        } else if (event.event === "Finished") {
          setState("installing");
        }
      });
      setState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  };

  return (
    <aside className="update-toast" role="status" aria-live="polite">
      <div>
        <div className="eyebrow">Update available</div>
        <strong>JustHireMe {update.version}</strong>
        <p>{updateMessage}</p>
        {(state === "downloading" || state === "installing") && (
          <div className={`update-progress ${progress === null || state === "installing" ? "is-indeterminate" : ""}`}>
            <div style={progress !== null && state === "downloading" ? { width: `${progress}%` } : undefined} />
            <span>{progressLabel}</span>
          </div>
        )}
        {state === "error" && <p className="update-error">{error || "Update failed. Try again from GitHub Releases."}</p>}
      </div>
      <div className="update-actions">
        {state === "ready" ? (
          <button className="btn btn-accent" onClick={() => relaunch()}>Restart</button>
        ) : (
          <button className="btn btn-accent" onClick={install} disabled={state === "downloading" || state === "installing"}>
            {state === "downloading" ? "Downloading..." : state === "installing" ? "Installing..." : "Update"}
          </button>
        )}
        <button className="btn btn-ghost" onClick={dismiss} disabled={state === "downloading" || state === "installing"}>Later</button>
      </div>
    </aside>
  );
}
