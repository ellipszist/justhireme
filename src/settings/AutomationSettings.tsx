import type { Cfg } from "./shared";
import { BigToggle, SectionLabel } from "./shared";

export function AutomationSettings({ cfg, onChange }: { cfg: Cfg; onChange: (k: keyof Cfg, v: string) => void }) {
  return (
    <>
{/* 4. Automation */}
          <div style={{ borderTop: "1px dashed var(--line)", paddingTop: 18 }}>
            <SectionLabel label="Automation" />
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <BigToggle active={cfg.ghost_mode === "true"} onToggle={() => onChange("ghost_mode", cfg.ghost_mode === "true" ? "false" : "true")}
                icon="ghost" tone="purple" label="Ghost Mode" badge={cfg.ghost_mode === "true" ? "autonomous" : "manual"}
                sub="Runs the full pipeline every 6 hours in the background" />
              <BigToggle active={cfg.auto_apply === "true"} onToggle={() => onChange("auto_apply", cfg.auto_apply === "true" ? "false" : "true")}
                icon="fire" tone="orange" label="Auto Apply" badge={cfg.auto_apply === "true" ? "on" : "off"}
                sub="Submits approved applications automatically — skips Sniper review" />
              <BigToggle active={cfg.headed_browser === "true"} onToggle={() => onChange("headed_browser", cfg.headed_browser === "true" ? "false" : "true")}
                icon="globe" tone="blue" label="Headed Browser" badge={cfg.headed_browser === "true" ? "visible" : "headless"}
                sub="Show the browser window during actuation — useful for debugging" />
            </div>
          </div>
    </>
  );
}
