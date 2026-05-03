import type { Cfg } from "./shared";
import { SectionLabel, STEPS, StepCard } from "./shared";

export function StepSettings({ cfg, onChange }: { cfg: Cfg; onChange: (k: keyof Cfg, v: string) => void }) {
  return (
    <>
{/* 2. Per-step */}
          <div>
            <SectionLabel label="Per-Step Configuration" sub="reuse the global key, or give any step its own provider, key & model" />
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {STEPS.map(step => <StepCard key={step.id} step={step} cfg={cfg} onChange={onChange} />)}
            </div>
          </div>
    </>
  );
}
