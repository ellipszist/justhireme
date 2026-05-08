import { useEffect, useMemo, useState } from "react";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type UpdateState = "checking" | "available" | "downloading" | "ready" | "error";

function formatBytes(value: number) {
  if (!value) return "0 MB";
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function UpdatePrompt() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [state, setState] = useState<UpdateState>("checking");
  const [error, setError] = useState("");
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
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
    try {
      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          setTotal(event.data.contentLength ?? null);
          setDownloaded(0);
        } else if (event.event === "Progress") {
          setDownloaded(prev => prev + event.data.chunkLength);
        } else if (event.event === "Finished") {
          setState("ready");
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
        <p>
          {state === "ready"
            ? "The update is installed. Restart to finish."
            : `You are running ${update.currentVersion}. Install the latest signed build now.`}
        </p>
        {state === "downloading" && (
          <div className="update-progress">
            <div style={{ width: `${progress ?? 12}%` }} />
            <span>{progress !== null ? `${progress}%` : formatBytes(downloaded)}</span>
          </div>
        )}
        {state === "error" && <p className="update-error">{error || "Update failed. Try again from GitHub Releases."}</p>}
      </div>
      <div className="update-actions">
        {state === "ready" ? (
          <button className="btn btn-accent" onClick={() => relaunch()}>Restart</button>
        ) : (
          <button className="btn btn-accent" onClick={install} disabled={state === "downloading"}>
            {state === "downloading" ? "Installing..." : "Update"}
          </button>
        )}
        <button className="btn btn-ghost" onClick={dismiss} disabled={state === "downloading"}>Later</button>
      </div>
    </aside>
  );
}
