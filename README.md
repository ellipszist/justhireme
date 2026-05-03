# JustHireMe

Local-first autonomous job application engine for scouting, evaluating, preparing, applying, and tracking job leads.

## What it does

JustHireMe is a privacy-preserving desktop app that runs the job application workflow on your machine. It keeps profile data, generated documents, lead history, and application activity local by default. The system uses an agent pipeline to ingest a candidate profile, scout leads, evaluate fit, generate tailored documents, preview form filling, apply, and track progress in a local CRM.

## Agent pipeline

Ingest profile -> Scout leads -> Evaluate fit (GraphRAG) -> Generate tailored docs -> Preview & apply -> Track in CRM

## Tech stack

Tauri 2 (Rust) · React 19 + TypeScript · Python 3.13 · FastAPI · LangGraph · Kùzu (graph) · LanceDB (vector) · SQLite · Playwright

## Getting started

### Prerequisites

- Node 20+, Rust (stable), Python 3.13+, uv

### Install & run

```bash
git clone ...
npm install
cd backend && uv sync
npm run tauri dev
```

## Project structure

```text
JustHireMe/
├── src/        # Frontend
├── backend/    # Python agents + API
└── src-tauri/  # Rust shell
```

## Status

Early alpha — rapidly evolving. Expect breaking changes.
