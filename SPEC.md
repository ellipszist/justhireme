1. Project Vision
A zero-dependency, local-first autonomous job-seeking engine that handles the end-to-end pipeline: Scouting -> Matching -> Tailoring -> Applying -> Tracking. It prioritizes user privacy (local data) and stealth (residential IPs) while leveraging SOTA GraphRAG and Vision-based browser actuation.

2. Technical Stack
Shell/OS Bridge: Tauri 2.0 (Rust)

Frontend: React (Vite), TypeScript, Tailwind CSS, Framer Motion

Orchestrator: Python 3.12+ (managed by uv)

State Machine: LangGraph

Backend API: FastAPI (Localhost, dynamic port)

Databases:

Graph: Kùzu (Embedded Property Graph)

Vector: LanceDB (Embedded Vector Store)

Relational/State: SQLite

Execution: Playwright (Python) + Vision-Language Model (VLM) fallbacks

3. System Architecture & IPC
The application runs as a dual-process system.

Tauri Process (The Parent): Manages window lifecycle, system tray, and encrypted storage of API keys. It spawns the Python process as a Sidecar.

Python Process (The Child): Houses the LangGraph engine, DBs, and Playwright.

Communication: Bi-directional via WebSockets for real-time log streaming and REST for command-and-control.

4. Data Ontology (The Knowledge Brain)
4.1 Kùzu Graph Schema
Nodes:

Candidate: {id, name, summary}

Experience: {role, company, period, description}

Project: {title, stack, repo_url, impact}

Skill: {name, category}

JobLead: {job_id, title, company, url, platform}

Edges:

Candidate -[WORKED_AS]-> Experience

Candidate -[BUILT]-> Project

Experience -[UTILIZES]-> Skill

Project -[UTILIZES]-> Skill

JobLead -[REQUIRES]-> Skill

4.2 SQLite CRM Schema
leads: Tracks status (discovered, evaluating, tailoring, approved, applied, rejected).

events: Audit log of every action (e.g., "Sent email to HR," "Filled Page 1/3").

5. Agent Modules (The DAG Nodes)
5.1 The Ingestor Agent
Inputs: PDF Resumes, GitHub Handles, LinkedIn Profile URLs.

Logic: Uses LLM to extract entities -> Maps to Graph Ontology -> Commits to Kùzu.

Output: A populated Graph Brain.

5.2 The Scout Agent
Inputs: Search queries, Target URL list, GitHub Gist (for OTA selectors).

Logic:

Path A: Apify API (LinkedIn/X).

Path B: Local Playwright (Niche boards/RSS).

Output: Raw Job JSON to leads table.

5.3 The Evaluator Agent (GraphRAG)
Inputs: JobLead text + Kùzu Subgraph.

Logic: Generates Cypher queries to find "Proof of Work" -> Scores 0-100 based on relational overlap.

Output: Score + Qualitative Reasoning.

5.4 The Actuator Agent (The Hands)
Inputs: PDF Path, Form URL, User Identity Data.

Logic:

Primary: DOM-based Playwright (using OTA selectors.json).

Fallback: Vision-based Actuation (Set-of-Mark + VLM Coordinates).

Output: Submission Confirmation.

6. Execution Modes
Ghost Mode: Fully autonomous. Runs every 6 hours, applies, and emails without asking.

Sniper Mode: "Human-in-the-loop." Pauses after evaluation; requires user click in Tauri UI to "Execute."

7. Security & Stealth
Key Storage: AES-256 encryption using Windows DPAPI or Machine_UUID.

Rate Limiting: Exponential backoff and "Playwright Jitter" (randomized delays between clicks).

User-Agent Spooling: Rotates realistic browser fingerprints.

8. Distribution Spec
Bundle Format: Portable .exe (Wix Toolset via Tauri).

Included Resources:

Pinned Python Runtime (3.12).

Playwright Chromium Binary.

node_modules and Python site-packages.

9. Implementation Roadmap (The Agent's To-Do List)
Phase 0: The Bridge (Milestone 1)
[ ] Initialize Tauri 2.0 with React/TS.

[ ] Setup Python Sidecar with uv.

[ ] Implement WebSocket Heartbeat and Port Discovery.

Phase 1: The Brain (Milestone 2)
[ ] Implement Kùzu Schema and SQLite CRM.

[ ] Build Ingestor Agent (PDF/Web -> Graph).

Phase 2: The Scout (Milestone 3)
[ ] Build Hybrid Scraper (Apify + Local).

[ ] Implement Deduplication Logic.

Phase 3: The Hands (Milestone 4)
[ ] Build PDF Generator (Tailored Markdown -> PDF).

[ ] Build DOM Actuator for Lever/Greenhouse/Ashby.

[ ] Implement VLM Vision Fallback.

Best Practices for AI Agents Reading this Spec:
Keep it Modular: Each agent node in backend/agents/ must be a standalone Python file.

Type Everything: Use Pydantic for Python and TypeScript interfaces for the UI.

Log Structurally: Use JSON logging so the Tauri UI can parse and display a "Live Feed" of agent thoughts.


Fail Safely: If an agent fails, the LangGraph state must be saved to SQLite so the user can resume manually.
