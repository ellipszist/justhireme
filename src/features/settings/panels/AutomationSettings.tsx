import type { Cfg } from "./shared";
import { BigToggle, SectionLabel } from "./shared";

export function AutomationSettings({ cfg, onChange }: { cfg: Cfg; onChange: (k: keyof Cfg, v: string) => void }) {
  return (
    <div style={{ borderTop: "1px dashed var(--line)", paddingTop: 18 }}>
      <SectionLabel label="Experimental Automation" sub="unsupported lab" />
      <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5, marginBottom: 10 }}>
        Browser automation is retained for contributors, but the OSS core is scraper, ranker, vector matching, and customization.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <BigToggle active={cfg.ghost_mode === "true"} onToggle={() => onChange("ghost_mode", cfg.ghost_mode === "true" ? "false" : "true")}
          icon="ghost" tone="purple" label="Experimental Ghost Mode" badge={cfg.ghost_mode === "true" ? "lab on" : "off"}
          sub="Contributor lab for background runs; not part of the main OSS workflow" />
        <BigToggle active={cfg.auto_apply === "true"} onToggle={() => onChange("auto_apply", cfg.auto_apply === "true" ? "false" : "true")}
          icon="fire" tone="orange" label="Experimental Auto Apply" badge={cfg.auto_apply === "true" ? "lab on" : "off"}
          sub="Unsupported browser submission path; scraper/ranker/customizer do not require it" />
        <BigToggle active={cfg.headed_browser === "true"} onToggle={() => onChange("headed_browser", cfg.headed_browser === "true" ? "false" : "true")}
          icon="globe" tone="blue" label="Headed Browser" badge={cfg.headed_browser === "true" ? "visible" : "headless"}
          sub="Show the browser window while debugging experimental automation" />
      </div>
    </div>
  );
}
