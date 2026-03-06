#!/bin/bash
# ================================================================
# slides-to-sim — Full Setup Script
# Run this once on a fresh machine to get everything running.
# ================================================================

set -e

echo ""
echo "🚀 slides-to-sim Setup"
echo "======================"

# ── Check prerequisites ─────────────────────────────────────────
echo ""
echo "📦 Checking prerequisites..."
command -v python3 >/dev/null 2>&1 || { echo "❌ Python 3 required. Install from python.org"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "❌ Node.js required. Install from nodejs.org"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "❌ Git required"; exit 1; }
echo "✅ Python $(python3 --version)"
echo "✅ Node $(node --version)"

# ── Backend Setup ───────────────────────────────────────────────
echo ""
echo "🐍 Setting up Python backend..."
cd backend

python3 -m venv venv
source venv/bin/activate || source venv/Scripts/activate  # Windows fallback

pip install --upgrade pip -q
pip install -r requirements.txt

# Copy env
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "⚠️  IMPORTANT: Edit backend/.env and add your API keys:"
  echo "    GEMINI_API_KEY=..."
  echo "    GOOGLE_API_KEY=..."
fi

# Install Playwright browsers
python -m playwright install chromium 2>/dev/null || echo "⚠️  Playwright chromium install skipped"

echo "✅ Backend ready"
cd ..

# ── Frontend Setup ──────────────────────────────────────────────
echo ""
echo "⚛️  Setting up Next.js frontend..."
cd frontend/training-player

npm install

if [ ! -f .env.local ]; then
  cp .env.local.example .env.local
fi

echo "✅ Frontend ready"
cd ../..

# ── Done ────────────────────────────────────────────────────────
echo ""
echo "✅ Setup complete!"
echo ""
echo "To start development:"
echo ""
echo "  Terminal 1 (backend):"
echo "    cd backend && source venv/bin/activate && python main.py"
echo ""
echo "  Terminal 2 (frontend):"
echo "    cd frontend/training-player && npm run dev"
echo ""
echo "  Then open: http://localhost:3000"
echo ""
