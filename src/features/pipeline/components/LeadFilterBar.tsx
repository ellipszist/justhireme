import Icon from "../../../shared/components/Icon";
import type { LeadSort, SeniorityFilter } from "../../../types";

export function LeadFilterBar({
  search, setSearch, platform, setPlatform, minSignal, setMinSignal,
  minMatch, setMinMatch, sort, setSort, budgetOnly, setBudgetOnly,
  learningOnly, setLearningOnly, seniority, setSeniority, platforms, total, shown, label,
}: {
  search: string; setSearch: (v: string) => void;
  platform: string; setPlatform: (v: string) => void;
  minSignal: number; setMinSignal: (v: number) => void;
  minMatch: number; setMinMatch: (v: number) => void;
  sort: LeadSort; setSort: (v: LeadSort) => void;
  budgetOnly: boolean; setBudgetOnly: (v: boolean) => void;
  learningOnly: boolean; setLearningOnly: (v: boolean) => void;
  seniority: SeniorityFilter; setSeniority: (v: SeniorityFilter) => void;
  platforms: string[]; total: number; shown: number; label: string;
}) {
  const hasFilters = Boolean(search || platform || minSignal || minMatch || budgetOnly || learningOnly || seniority !== "all");
  const resetFilters = () => {
    setSearch("");
    setPlatform("");
    setMinSignal(0);
    setMinMatch(0);
    setBudgetOnly(false);
    setLearningOnly(false);
    setSeniority("all");
    setSort("recommended");
  };
  const toggleClass = (active: boolean) => `pipeline-toggle ${active ? "active" : ""}`;

  return (
    <div className="pipeline-filterbar">
      <label className="pipeline-searchbox">
        <Icon name="search" size={14} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={`Search ${label}`}
        />
      </label>

      <div className="pipeline-filter-fields">
        <label className="pipeline-field">
          <span>Source</span>
          <select value={platform} onChange={e => setPlatform(e.target.value)}>
            <option value="">All sources</option>
            {platforms.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="pipeline-field">
          <span>Level</span>
          <select value={seniority} onChange={e => setSeniority(e.target.value as SeniorityFilter)}>
            <option value="all">All levels</option>
            <option value="beginner">Beginner</option>
            <option value="fresher">Fresher</option>
            <option value="junior">Junior</option>
            <option value="mid">Mid</option>
            <option value="senior">Senior</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label className="pipeline-field">
          <span>Sort</span>
          <select value={sort} onChange={e => setSort(e.target.value as LeadSort)}>
            <option value="recommended">Recommended</option>
            <option value="newest">Newest</option>
            <option value="signal">Signal score</option>
            <option value="match">Match score</option>
            <option value="company">Company</option>
          </select>
        </label>
        <label className="pipeline-field compact">
          <span>Signal</span>
          <input
            type="number"
            min={0}
            max={100}
            value={minSignal}
            onChange={e => setMinSignal(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
            title="Minimum signal score"
          />
        </label>
        <label className="pipeline-field compact">
          <span>Fit</span>
          <input
            type="number"
            min={0}
            max={100}
            value={minMatch}
            onChange={e => setMinMatch(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
            title="Minimum fit score"
          />
        </label>
      </div>

      <div className="pipeline-filter-actions">
        <button className={toggleClass(budgetOnly)} onClick={() => setBudgetOnly(!budgetOnly)}>Budget</button>
        <button className={toggleClass(learningOnly)} onClick={() => setLearningOnly(!learningOnly)}>Learned</button>
        <button className="pipeline-clear" onClick={resetFilters} disabled={!hasFilters}>Clear</button>
        <span className="pipeline-count mono">{shown}/{total}</span>
      </div>
    </div>
  );
}
