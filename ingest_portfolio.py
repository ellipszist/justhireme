"""
Bulk-ingest Vasu DevS portfolio content into the JustHireMe Identity Graph.

Usage:
    python ingest_portfolio.py <PORT>

Example:
    python ingest_portfolio.py 54321

The port is printed by the backend on startup as "PORT:<number>".
"""

import sys
import requests
import time

if len(sys.argv) < 2:
    print("Usage: python ingest_portfolio.py <PORT>")
    sys.exit(1)

PORT = int(sys.argv[1])
BASE = f"http://127.0.0.1:{PORT}/api/v1"

def put(path, data):
    r = requests.put(f"{BASE}{path}", json=data)
    r.raise_for_status()
    return r.json()

def post(path, data):
    r = requests.post(f"{BASE}{path}", json=data)
    r.raise_for_status()
    return r.json()

# ─── 1. Candidate Profile ────────────────────────────────────────────

print("\n══ Updating candidate profile ══")
put("/profile/candidate", {
    "n": "Vasu DevS",
    "s": "A 21-year-old self-taught Full Stack AI Engineer based in India. Building AI Agents and Intelligent Systems. Specializing in AI Agents & Automation, Voice AI Systems, and Full Stack MVPs with fast turnaround."
})
print("  ✓ Candidate profile updated")

# ─── 2. Skills ───────────────────────────────────────────────────────

SKILLS = [
    # Languages
    ("Python", "language"),
    ("TypeScript", "language"),
    ("JavaScript", "language"),
    ("C++", "language"),
    ("Java", "language"),
    # Frontend
    ("Next.js", "frontend"),
    ("React", "frontend"),
    ("Vite", "frontend"),
    ("Tailwind CSS", "frontend"),
    ("Framer Motion", "frontend"),
    ("Three.js", "frontend"),
    ("D3.js", "frontend"),
    # Backend
    ("Node.js", "backend"),
    ("Express", "backend"),
    ("FastAPI", "backend"),
    ("Prisma", "backend"),
    ("Drizzle ORM", "backend"),
    # Data & Vector
    ("PostgreSQL", "database"),
    ("MongoDB", "database"),
    ("Supabase", "database"),
    ("Neon", "database"),
    ("SQLite", "database"),
    ("Qdrant", "database"),
    ("ChromaDB", "database"),
    # AI / LLM
    ("OpenAI", "ai"),
    ("Claude", "ai"),
    ("Gemini", "ai"),
    ("Groq", "ai"),
    ("DeepSeek", "ai"),
    ("LangChain", "ai"),
    ("LangGraph", "ai"),
    ("Ollama", "ai"),
    ("Hugging Face", "ai"),
    ("PyTorch", "ai"),
    ("RAG Systems", "ai"),
    # Voice & Realtime
    ("LiveKit", "voice"),
    ("Deepgram", "voice"),
    ("WebRTC", "voice"),
    # DevOps
    ("Git", "devops"),
    ("Docker", "devops"),
    ("Linux", "devops"),
    ("Vercel", "devops"),
    ("Cloudflare", "devops"),
    ("Postman", "devops"),
]

print(f"\n══ Ingesting {len(SKILLS)} skills ══")
for name, cat in SKILLS:
    try:
        post("/profile/skill", {"n": name, "cat": cat})
        print(f"  ✓ {name}")
    except Exception as e:
        print(f"  ✗ {name}: {e}")

# ─── 3. Experience ───────────────────────────────────────────────────

EXPERIENCE = [
    {
        "role": "Full-Stack Engineer",
        "co": "Freelance (Internal Finance & P&L Platform)",
        "period": "Mar 2026 → Apr 2026",
        "d": (
            "End-to-end build of a production-grade financial reporting platform as sole engineer. "
            "Unified transaction ingestion across 5 live platforms (Shopify, payment processors, ad platform, fulfilment provider). "
            "Built accurate multi-currency P&L with full processor-level deduplication and a live dashboard loading in sub-second.\n\n"
            "Headline metrics: 18 days solo, 5 integrations, 10x faster sync, 85 tests, 40+ DB indexes.\n\n"
            "Key achievements:\n"
            "- 10x faster Shopify ingestion via parallel upserts with bounded concurrency\n"
            "- ~100x faster historical currency backfill (bulk SQL UPDATE vs row-by-row Prisma)\n"
            "- >95% dashboard load-time reduction via composite indexes, Postgres RPC functions, pre-aggregated rollup table\n"
            "- Tri-format currency storage using decimal.js arbitrary-precision math end-to-end\n"
            "- Three-phase sync pipeline (fetch → enrich → attribute) with signed continuation tokens\n"
            "- 85-test suite covering P&L math, deduplication, attribution, partner splits, exchange-rate caching\n"
            "- Three-tier RBAC (OWNER/MANAGER/MEMBER), AES-256-GCM credential encryption, Zod validation, per-IP rate limiting\n\n"
            "Stack: Next.js 15, TypeScript, PostgreSQL, Prisma 7, NextAuth v5, Tailwind 4, Zustand, Recharts, decimal.js, Supabase, Vercel"
        ),
    },
]

print(f"\n══ Ingesting {len(EXPERIENCE)} experience entries ══")
for exp in EXPERIENCE:
    try:
        post("/profile/experience", exp)
        print(f"  ✓ {exp['role']} @ {exp['co']}")
    except Exception as e:
        print(f"  ✗ {exp['role']}: {e}")

# ─── 4. Projects ─────────────────────────────────────────────────────

PROJECTS = [
    {
        "title": "BranchGPT",
        "stack": "Next.js 16, TypeScript, Drizzle ORM, Neon Postgres, Vercel AI SDK, Groq, Tailwind 4",
        "repo": "https://branchgpt.vasudev.live/",
        "impact": (
            "Git-like chat interface treating conversations as a DAG for context garbage collection. "
            "Fork any message into a parallel branch, explore tangents without polluting the main thread, "
            "and smart-merge branches back as LLM-generated summaries (Llama 3.3). "
            "Tree sidebar for instant branch navigation. Merge logic filters out shared history, "
            "appending only new insight. Full Markdown + LaTeX support."
        ),
    },
    {
        "title": "Vaani",
        "stack": "Python, FastAPI, LiveKit Agents, Groq, Deepgram, React 18, Vite, Tailwind, SIP, Docker",
        "repo": "https://www.youtube.com/watch?v=VsEfOfwh8XM",
        "impact": (
            "Voice-native debt-recovery command center with sub-500ms latency and full-duplex interruption handling. "
            "Two tuned personas — empathetic Rachel and firm Orion — dispatched by debtor archetype. "
            "Sherlock risk engine analyzes every second of every call for FDCPA compliance, performs matrix profiling "
            "(Hardship Case vs Strategic Defaulter), and auto-tags outcomes as Promise to Pay, Refusal, or Dispute. "
            "Dark-mode React command center streams live transcripts with risk badges."
        ),
    },
    {
        "title": "Odeon",
        "stack": "Python, FastAPI, WebSockets, Groq, LangChain, SQLite, React 19, Vite, TypeScript, Tailwind 4",
        "repo": "https://youtu.be/GFdSe4-c_xQ",
        "impact": (
            "AI agent optimization platform — self-improving loop for voice agents. "
            "Generates adversarial personas for synthetic stress testing, runs high-fidelity simulations, "
            "scores each conversation against strict KPIs (Empathy, Negotiation, Repetition 1-10), "
            "and a meta-agent auto-rewrites the system prompt when thresholds fail. "
            "Git-style red/green diff view shows exactly which words changed. "
            "Bi-directional WebSocket streams every simulation character-by-character."
        ),
    },
    {
        "title": "MapMyRepo",
        "stack": "React 19, TypeScript, Vite 6, D3.js 7, Google Gemini, Tailwind",
        "repo": "https://mapmyrepo.vasudev.live",
        "impact": (
            "Transforms any codebase into an interactive D3.js force-directed node graph. "
            "Every file and folder is a node, Gemini summarizes each one, and a per-node chat panel "
            "lets you ask architectural questions directly. Load any public GitHub repo by URL — no auth required. "
            "Scroll to zoom, drag to pan, double-click folders to expand/collapse, hover highlights connected nodes."
        ),
    },
    {
        "title": "PolySEE",
        "stack": "React, Tailwind, FastAPI, Python, Gemini Flash 2.0, Ollama, ChromaDB",
        "repo": "https://youtu.be/6weynv_rblI",
        "impact": (
            "Multilingual campus FAQ chatbot supporting Hindi, English and 3+ regional languages via RAG. "
            "Query embedded via local Ollama models, semantic search over institutional documents in ChromaDB, "
            "response generated by Gemini Flash 2.0 with confidence scores. "
            "Admin-approval workflow — only validated answers reach production. "
            "Deployable across web, WhatsApp and Telegram with confidence-based human fallback."
        ),
    },
    {
        "title": "Socratis",
        "stack": "Next.js 14, Python, LiveKit, Deepgram, Groq, MongoDB, TypeScript, Express",
        "repo": "",
        "impact": (
            "Real-time AI interviewer running live coding interviews over WebRTC voice. "
            "Candidates code in Monaco while a Python agent watches every keystroke via chat-context injection, "
            "asks Socratic hints only when detecting bugs/approach changes/stalls. "
            "Post-interview forensics: strict Big-O analysis, line-by-line bug fixes, "
            "communication analysis with exact transcript quotes, hallucination cross-checks against actual code. "
            "Radar-chart result page."
        ),
    },
    {
        "title": "Waldo",
        "stack": "Python, FastAPI, React, Vite, Qdrant, LangGraph, Gemini, Groq, Docling",
        "repo": "",
        "impact": (
            "Production-grade agentic RAG pipeline ingesting complex PDFs with text, tables, charts and diagrams. "
            "IBM Docling for structure extraction, RapidOCR for scanned pages, Gemini VLM transcribes figures to searchable text. "
            "LangGraph agent routes between direct response and retrieval with relevance grading and query rewriting (max 2 retries). "
            "Refuses out-of-scope questions instead of hallucinating. Graceful fallback when Gemini quota runs out."
        ),
    },
    {
        "title": "SSS - Screen Shot Sorter",
        "stack": "Python, PyTorch, Qwen2-VL, Transformers",
        "repo": "",
        "impact": (
            "Local AI-powered screenshot organizer. Qwen2-VL-2B runs on GPU, classifying images into nine semantic buckets, "
            "extracting URLs, cleaning text and generating per-image markdown logs. "
            "Fully local inference — no cloud API calls. GPU cache clears every 5 images, bfloat16 for reduced VRAM footprint. "
            "~5-10 sec per image on RTX 4060 (8 GB VRAM)."
        ),
    },
    {
        "title": "DryRunVisualised",
        "stack": "Next.js 16, React 19, Three.js, TypeScript, Pyodide, Monaco Editor, Zustand, Tailwind",
        "repo": "https://visualdsa.vasudev.live",
        "impact": (
            "Real-time algorithm visualizer rendering data-structure operations in both 2D (SVG) and 3D (WebGL via Three.js). "
            "Write Python or C++ in Monaco, hit Run, watch each line execute with full variable inspection. "
            "50+ pre-built algorithms across searching, sorting, graphs, DP, backtracking. "
            "Per-line trace replay with step forward/backward and speed slider. "
            "Python runs client-side in Pyodide (WebAssembly), C++ compiles via Godbolt."
        ),
    },
    {
        "title": "A18-INFINION",
        "stack": "Python, Gemini, OpenAI, DeepSeek, FastMCP",
        "repo": "",
        "impact": (
            "Multi-agent static bug detector for specialized C++ (Infineon RDI API). "
            "Central Orchestrator dispatches Code Parser, MCP Lookup, Bug Detector and Bug Describer agents. "
            "Two-layer detection strategy (pattern matching + LLM reasoning) with consensus-based confidence. "
            "Context-first design: MCP Lookup Agent queries API docs before any LLM sees the code. "
            "Detections below 70% confidence are dropped. Multi-provider: Gemini 2.0, DeepSeek V3, GPT-4o."
        ),
    },
    {
        "title": "Portfolio (vasudev.live)",
        "stack": "Vite, React, TypeScript, Tailwind, Framer Motion, Lenis, Vercel",
        "repo": "https://www.vasudev.live/",
        "impact": (
            "Personal portfolio with radial theme transition tied to click coordinates, "
            "context-aware custom cursor with paint trails, magnetic buttons, live GitHub stats. "
            "Film-grain SVG overlay, sticky-hero stacked-section scroll pattern powered by Lenis. "
            "Lazy-loaded sections via React.lazy + Suspense. TypeScript strict mode."
        ),
    },
    {
        "title": "RupeeRoast",
        "stack": "Next.js 15, React 19, Tailwind, Framer Motion, Recharts, FastAPI, Python, Groq, Gemini",
        "repo": "",
        "impact": (
            "AI financial forensic tool that parses messy Indian bank PDFs (including UPI), "
            "categorizes every transaction via LLM, and produces a dashboard plus a Groq-powered "
            "'Indian Dad / Gen-Z' roast of impulsive purchases. "
            "PyMuPDF4LLM primary parser with PyPDF fallback, Pydantic-validated schemas."
        ),
    },
    {
        "title": "EmailDrafter",
        "stack": "React, Vite, Tailwind, Python, FastAPI",
        "repo": "https://email-drafter-three.vercel.app",
        "impact": (
            "AI-assisted email drafting app with separate /draft and /refine endpoints. "
            "Users enter context and tone/length preferences; backend calls LLM to draft or refine; "
            "UI shows live previews. Swappable backend."
        ),
    },
    {
        "title": "Korosuke",
        "stack": "Python, PyQt5, Ollama, LLaMA",
        "repo": "",
        "impact": (
            "PyQt5 sliding-sidebar desktop assistant. Chat with local LLaMA via Ollama, "
            "toggle with a hotkey, runs inference on a background thread so the UI never blocks. "
            "PID-based hotkey toggle, ESC to hide."
        ),
    },
    {
        "title": "ASCIIRealTime",
        "stack": "JavaScript, Tailwind, MediaPipe",
        "repo": "https://ascii-real-time.vercel.app",
        "impact": (
            "Browser demo turning webcam feed into real-time ASCII or emoji art. "
            "MediaPipe Selfie Segmentation for optional background removal. "
            "Zero build — vanilla JS + Tailwind via CDN. All processing in-browser, video never leaves device."
        ),
    },
    {
        "title": "GitArt",
        "stack": "Next.js 16, React 19, TypeScript, Tailwind, isomorphic-git, memfs, JSZip",
        "repo": "https://git-art-iota.vercel.app",
        "impact": (
            "Browser-based tool to paint your GitHub contribution graph like a canvas. "
            "Design a 52x7 heatmap, the app builds a real Git repo in-browser using isomorphic-git on memfs. "
            "30+ built-in templates (Pac-Man, QR code, Christmas tree). "
            "Image drop-in with 5-band quantization + text-to-pixels bitmap font. Target any year 2022-2027."
        ),
    },
    {
        "title": "Kyoka",
        "stack": "React, Vite, Tailwind, Framer Motion, FastAPI, Python, LangChain, Gemini, DeepSeek, Tavily",
        "repo": "",
        "impact": (
            "OSINT-driven behavioral intelligence app. Tri-agent LangChain pipeline reads a target's "
            "digital footprint, synthesizes DISC and Big-Five traits, produces actionable Battle Cards "
            "with DOs, DON'Ts and opening lines. 'Charcoal & Gold' luxury-concierge aesthetic with "
            "radar charts, magnetic hovers, and a chat simulator to rehearse conversations."
        ),
    },
    {
        "title": "BranchGPT Chrome Extension",
        "stack": "Vite, React, TypeScript, Tailwind, Dexie.js, CRXJS",
        "repo": "",
        "impact": (
            "Chrome extension that turns ChatGPT into a DAG-based chat tool. "
            "Fork any message into a parallel branch, visualize the conversation tree in a side panel. "
            "Manifest V3 native build. All data stored locally via IndexedDB — no external servers."
        ),
    },
    {
        "title": "Maze Pathfinder Visualizer",
        "stack": "Python, Pygame",
        "repo": "",
        "impact": (
            "Pygame-based pathfinding visualizer comparing BFS, DFS, Dijkstra and A* side-by-side "
            "on procedurally generated mazes (recursive backtracking). "
            "Per-algorithm color coding, 60 FPS step-by-step exploration, A* uses Manhattan distance."
        ),
    },
]

print(f"\n══ Ingesting {len(PROJECTS)} projects ══")
for proj in PROJECTS:
    try:
        post("/profile/project", proj)
        print(f"  ✓ {proj['title']}")
    except Exception as e:
        print(f"  ✗ {proj['title']}: {e}")

# ─── 5. Verify ───────────────────────────────────────────────────────

print("\n══ Verification ══")
time.sleep(0.5)
r = requests.get(f"{BASE}/profile")
profile = r.json()
print(f"  Name:       {profile.get('n', '?')}")
print(f"  Skills:     {len(profile.get('skills', []))}")
print(f"  Experience: {len(profile.get('exp', []))}")
print(f"  Projects:   {len(profile.get('projects', []))}")
print(f"\n══ Done! ══")
