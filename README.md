# slides-to-sim

> Automatically convert Google Slides training decks into interactive product simulations powered by Gemini Vision AI.

## What it does

Paste a Google Slides link → AI analyzes slides → Extracts workflow steps → Generates an interactive simulation (like Storylane/WalkMe, but automated).

## Pipeline

```
Google Slides URL
  → Slide Ingestion (Google Slides API)
  → Vision Analysis (Gemini Vision)
  → Instruction Parsing (Gemini)
  → Step Ordering (red boxes → description → slide order)
  → DOM Matching (Playwright)
  → Simulation Generation (JSON config)
  → Training Player (Next.js)
```

## Stack

- **Backend**: Python (FastAPI) — vision, parsing, DOM matching
- **Frontend**: Next.js + React + TailwindCSS
- **AI**: Gemini API (free tier)
- **Storage**: SQLite (local) / Supabase (free tier, optional)
- **Deployment**: Vercel (frontend) + Render (backend)

## Phases

| Phase | Module | Status |
|-------|--------|--------|
| 0 | Project Init | ✅ |
| 1 | Slide Ingestion | 🚧 |
| 2 | Vision Analysis | ⬜ |
| 3 | Instruction Parser | ⬜ |
| 4 | Step Ordering | ⬜ |
| 5 | DOM Matching | ⬜ |
| 6 | Simulation Generator | ⬜ |
| 7 | Training Player | ⬜ |
| 8 | Storage | ⬜ |
| 9 | Deployment | ⬜ |

## Setup

```bash
# Backend
cd backend/slide-ingestion
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # fill in your keys

# Frontend
cd frontend/training-player
npm install
npm run dev
```

## Required API Keys

- `GEMINI_API_KEY` — [Get free at Google AI Studio](https://aistudio.google.com)
- `GOOGLE_SLIDES_API_KEY` — [Google Cloud Console](https://console.cloud.google.com) (free)
