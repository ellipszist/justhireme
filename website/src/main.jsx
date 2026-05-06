import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const repoUrl = "https://github.com/vasu-devs/JustHireMe";

const navItems = ["Workflow", "Why local", "Features", "Release"];

const pipeline = [
  { status: "Leads", count: 128, tone: "blue" },
  { status: "Ranked", count: 42, tone: "yellow" },
  { status: "Drafts", count: 16, tone: "purple" },
];

const features = [
  {
    title: "Find",
    copy: "Collect better job leads from multiple sources.",
    tone: "blue",
    icon: "layers",
  },
  {
    title: "Filter",
    copy: "Remove stale, thin, and low-signal roles.",
    tone: "yellow",
    icon: "filter",
  },
  {
    title: "Rank",
    copy: "Explain why a role is worth your time.",
    tone: "purple",
    icon: "graph",
  },
  {
    title: "Tailor",
    copy: "Draft resumes, cover letters, and outreach.",
    tone: "green",
    icon: "file",
  },
];

const story = [
  {
    title: "Noise out",
    copy: "Bad roles never make it into the system.",
    tone: "yellow",
  },
  {
    title: "Signal in",
    copy: "Every match is scored with visible reasons.",
    tone: "blue",
  },
  {
    title: "Draft ready",
    copy: "Application material is prepared for review.",
    tone: "green",
  },
];

const principles = [
  "Local-first data",
  "Explainable scoring",
  "Human review",
  "Open source",
];

function formatCount(value) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}

function useViewCounter() {
  const [views, setViews] = React.useState(0);
  const [configured, setConfigured] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    const getVisitorId = () => {
      const key = "justhireme.visitorId";
      const existing = localStorage.getItem(key);
      if (existing) return existing;

      const next = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(key, next);
      return next;
    };

    const syncViews = async (method = "GET") => {
      const response = await fetch("/api/views", {
        method,
        headers: { "content-type": "application/json" },
        body: method === "POST" ? JSON.stringify({ visitorId: getVisitorId() }) : undefined,
      });
      const payload = await response.json();
      if (!cancelled && typeof payload.total === "number") {
        setViews(payload.total);
        setConfigured(Boolean(payload.configured));
      }
    };

    syncViews("POST").catch(() => {});
    const timer = window.setInterval(() => syncViews("GET").catch(() => {}), 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return { views, configured };
}

function useGitHubStars() {
  const [github, setGithub] = React.useState({ stars: null, pullRequests: null });

  React.useEffect(() => {
    let cancelled = false;

    const loadStars = async () => {
      const response = await fetch("/api/github");
      const payload = await response.json();
      if (!cancelled) {
        setGithub({
          stars: typeof payload.stars === "number" ? payload.stars : null,
          pullRequests: typeof payload.pullRequests === "number" ? payload.pullRequests : null,
        });
      }
    };

    loadStars().catch(() => {});
    const timer = window.setInterval(() => loadStars().catch(() => {}), 60000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return github;
}

function Icon({ name }) {
  if (name === "logo") {
    return (
      <svg className="logo-mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="1" y="1" width="30" height="30" rx="9" fill="#1F1A14" />
        <path d="M10 21 L10 11 M10 11 L16 11 Q22 11 22 16 Q22 21 16 21 L13 21" stroke="#F4EFE6" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        <circle cx="22" cy="11" r="2" fill="#C96442" />
      </svg>
    );
  }

  const paths = {
    download: "M12 3v12 M7 10l5 5 5-5 M5 21h14",
    spark: "M12 3v4 M12 17v4 M3 12h4 M17 12h4 M5.6 5.6l2.8 2.8 M15.6 15.6l2.8 2.8 M5.6 18.4l2.8-2.8 M15.6 8.4l2.8-2.8",
    graph: "M12 5a2 2 0 1 0 0 .1 M5 18a2 2 0 1 0 0 .1 M19 18a2 2 0 1 0 0 .1 M8.5 11a2 2 0 1 0 0 .1 M15.5 11a2 2 0 1 0 0 .1 M12 7v2 M10 12l-3 4 M14 12l3 4 M10 11h4",
    arrow: "M5 12h14 M13 6l6 6-6 6",
    check: "M5 12l5 5L20 7",
    layers: "M12 3 2 8l10 5 10-5-10-5Z M2 13l10 5 10-5 M2 18l10 5 10-5",
    filter: "M22 3H2l8 9.5V19l4 2v-8.5L22 3z",
    file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6",
    pulse: "M3 12h4l3-8 4 16 3-8h4",
    user: "M12 8a4 4 0 1 0 0 .1 M4 21c0-4 4-7 8-7s8 3 8 7",
    star: "M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2 2 9.3l6.9-1L12 2z",
    github: "M9 19c-5 1.5-5-2.5-7-3 M15 22v-3.9a3.4 3.4 0 0 0-.9-2.6c3-.3 6.1-1.5 6.1-6.6a5.2 5.2 0 0 0-1.4-3.6 4.8 4.8 0 0 0-.1-3.6s-1.1-.3-3.7 1.4a12.7 12.7 0 0 0-6.7 0C5.7.4 4.6.7 4.6.7a4.8 4.8 0 0 0-.1 3.6A5.2 5.2 0 0 0 3.1 8c0 5.1 3.1 6.3 6.1 6.6a3.4 3.4 0 0 0-.9 2.6V22",
    globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3 12h18 M12 3a14 14 0 0 1 0 18 M12 3a14 14 0 0 0 0 18",
    xlogo: "M4 4l16 16 M20 4L4 20",
  };

  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name].split(" M").map((d, index) => <path key={index} d={index === 0 ? d : `M${d}`} />)}
    </svg>
  );
}

function WorkflowAsset() {
  const steps = [
    ["Profile", "user", "green"],
    ["Leads", "layers", "blue"],
    ["Score", "graph", "purple"],
    ["Draft", "file", "orange"],
  ];

  return (
    <div className="workflow-asset" aria-label="Animated JustHireMe workflow">
      {steps.map(([label, icon, tone], index) => (
        <React.Fragment key={label}>
          <div className={`flow-chip tone-${tone}`}>
            <Icon name={icon} />
            <span>{label}</span>
          </div>
          {index < steps.length - 1 && <span className="flow-arrow" />}
        </React.Fragment>
      ))}
    </div>
  );
}

function MiniApp() {
  return (
    <div className="app-preview" aria-label="JustHireMe product preview">
      <aside className="preview-sidebar">
        <div className="brand-mini"><Icon name="logo" /><span>JustHireMe</span></div>
        {["Customize", "Dashboard", "Leads", "Job Pipeline", "Knowledge"].map((item, index) => (
          <div className={`preview-nav ${index === 3 ? "active" : ""}`} key={item}>
            <span className={`nav-dot tone-${["green", "blue", "orange", "purple", "teal"][index]}`} />
            {item}
          </div>
        ))}
        <div className="preview-status">
          <span className="live-dot" />
          Local agent ready
          <small>release waiting</small>
        </div>
      </aside>
      <main className="preview-main">
        <div className="preview-top">
          <div>
            <span className="eyebrow">Pipeline</span>
            <h3>Signal-first job hunt</h3>
          </div>
          <button className="tiny-button"><Icon name="spark" /> Scan</button>
        </div>
        <div className="score-card">
          <div>
            <span className="eyebrow">Today</span>
            <strong>3 high-fit roles</strong>
            <small>2 drafts ready for review</small>
          </div>
          <span className="score-ring">94</span>
        </div>
        <div className="preview-grid">
          {pipeline.map((item) => (
            <div className={`metric tone-${item.tone}`} key={item.status}>
              <strong>{item.count}</strong>
              <span>{item.status}</span>
            </div>
          ))}
        </div>
        <div className="job-list">
          {[
            ["Founding Engineer", "Remote - Product infra - 94%"],
            ["AI Tools Engineer", "Hybrid - TypeScript - 88%"],
            ["Full-stack Builder", "Remote - OSS-friendly - 82%"],
          ].map(([title, meta], index) => (
            <div className="job-row" key={title}>
              <span className={`job-mark tone-${["green", "purple", "orange"][index]}`}>{title[0]}</span>
              <div>
                <strong>{title}</strong>
                <small>{meta}</small>
              </div>
              <span className="review-pill">review</span>
            </div>
          ))}
        </div>
        <div className="preview-docs">
          <div className="doc-card resume-doc">
            <span className="doc-icon"><Icon name="file" /></span>
            <strong>Tailored resume</strong>
            <small>Projects matched to role evidence</small>
            <div className="doc-lines"><i /><i /><i /></div>
          </div>
          <div className="doc-card outreach-doc">
            <span className="doc-icon"><Icon name="pulse" /></span>
            <strong>Outreach draft</strong>
            <small>Founder note + LinkedIn variant</small>
            <div className="doc-lines"><i /><i /><i /></div>
          </div>
        </div>
      </main>
    </div>
  );
}

function App() {
  const { views, configured } = useViewCounter();
  const github = useGitHubStars();

  return (
    <>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="JustHireMe home"><Icon name="logo" /><span>JustHireMe</span></a>
        <nav aria-label="Primary navigation">
          {navItems.map((item) => <a key={item} href={`#${item.toLowerCase().replace(" ", "-")}`}>{item}</a>)}
        </nav>
        <div className="header-actions">
          <a className="header-link hide-mobile" href="https://vasudev.live"><Icon name="globe" /> <span>Portfolio</span></a>
          <a className="header-link hide-mobile" href="https://x.com/vasu_devs"><Icon name="xlogo" /> <span>X</span></a>
          <a className="header-link" href={repoUrl}><Icon name="github" /> <span>GitHub</span></a>
        </div>
      </header>

      <main id="top">
        <section className="hero band">
          <div className="hero-copy">
            <span className="eyebrow">Local-first AI job intelligence workbench</span>
            <h1>JustHireMe</h1>
            <p>
              A local-first workbench that turns noisy job hunting into a clear, reviewable pipeline.
            </p>
            <div className="proof-line">
              <span>Built in public</span>
              <span>Open source</span>
              <span>Desktop-first</span>
            </div>
            <div className="hero-actions">
              <button className="button primary" disabled title="Public installer is being prepared">
                <Icon name="download" />
                Download soon
              </button>
              <a className="button secondary" href={repoUrl}>
                <Icon name="star" />
                {github.stars == null ? "GitHub stars" : `${formatCount(github.stars)} stars`}
              </a>
            </div>
            <div className="wait-note">
              <span className="spinner" />
              Installer coming soon. Source is live.
            </div>
            <div className="live-counter" title={configured ? "Backed by the deployed view counter" : "Connect Upstash Redis on Vercel to persist this counter"}>
              <span className="live-dot" />
              <strong>{formatCount(views)}</strong>
              <span>unique launch views tracked live</span>
            </div>
            <div className="metric-strip">
              {[
                [github.stars == null ? "-" : formatCount(github.stars), "GitHub stars"],
                [github.pullRequests == null ? "-" : formatCount(github.pullRequests), "pull requests"],
                [formatCount(views), "unique views"],
              ].map(([value, label]) => (
                <div key={label}>
                  <strong>{value}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
          <MiniApp />
        </section>

        <section id="workflow" className="section band paper-2">
          <div className="section-head">
            <span className="eyebrow">Workflow</span>
            <h2>Find the role. Understand the fit. Ship the application.</h2>
          </div>
          <WorkflowAsset />
          <div className="story-grid">
            {story.map((item) => (
              <article className={`story-card tone-${item.tone}`} key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
              </article>
            ))}
          </div>
          <div className="workflow">
            {["Import profile", "Collect leads", "Quality gate", "Rank fit", "Tailor drafts"].map((step, index) => (
              <div className="workflow-step" key={step}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{step}</strong>
              </div>
            ))}
          </div>
        </section>

        <section id="features" className="section band">
          <div className="section-head">
            <span className="eyebrow">What it does</span>
            <h2>Built for applicants who want signal, control, and speed.</h2>
          </div>
          <div className="feature-grid">
            {features.map((feature) => (
              <article className={`feature tone-${feature.tone}`} key={feature.title}>
                <span className="feature-icon"><Icon name={feature.icon} /></span>
                <h3>{feature.title}</h3>
                <p>{feature.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="why-local" className="section split band paper-3">
          <div>
            <span className="eyebrow">Why local-first</span>
            <h2>Your job search should feel private, legible, and yours.</h2>
          </div>
          <div className="principle-list">
            {principles.map((item) => (
              <div className="principle" key={item}>
                <Icon name="check" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </section>

        <section id="release" className="section final-cta band">
          <span className="eyebrow">Release status</span>
          <h2>Alpha is public. One-click download is next.</h2>
          <p>
            Open source today. One-click desktop installer next.
          </p>
          <div className="hero-actions centered">
            <button className="button primary" disabled><Icon name="download" /> Installer waiting</button>
            <a className="button secondary" href={repoUrl}><Icon name="github" /> View source</a>
          </div>
          <div className="creator-links" aria-label="Creator links">
            <a href="https://vasudev.live">vasudev.live</a>
            <a href="https://x.com/vasu_devs">@vasu_devs</a>
          </div>
        </section>
      </main>

      <footer>
        <span>JustHireMe</span>
        <span>By Vasudev - vasudev.live - @vasu_devs</span>
      </footer>
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
