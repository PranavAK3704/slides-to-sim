import { useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Link2, ArrowRight, Zap, Eye, Layers, Play } from "lucide-react";


const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type JobStatus = {
  job_id: string;
  status: string;
  progress: number;
  current_phase: string;
  simulation_id?: string;
  error?: string;
};

export default function Home() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [error, setError] = useState("");

  const handleGenerate = async () => {
    if (!url.trim()) return;
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slides_url: url }),
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data: JobStatus = await res.json();
      setJob(data);

      // Poll for completion
      pollJob(data.job_id);
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  };

  const pollJob = async (jobId: string) => {
    const poll = async () => {
      try {
        const res = await fetch(`${API_URL}/api/jobs/${jobId}`);
        const data: JobStatus = await res.json();
        setJob(data);

        if (data.status === "complete" && data.simulation_id) {
          setLoading(false);
          router.push(`/sim/${data.simulation_id}`);
        } else if (data.status === "error") {
          setError(data.error || "Generation failed");
          setLoading(false);
        } else {
          setTimeout(poll, 1500);
        }
      } catch (e: any) {
        setError(e.message);
        setLoading(false);
      }
    };
    poll();
  };

  const features = [
    { icon: Eye, label: "Gemini Vision AI", desc: "Reads annotations directly from slide images" },
    { icon: Layers, label: "Auto Step Ordering", desc: "Numbered boxes → reading order → text" },
    { icon: Zap, label: "Spotlight Hotspots", desc: "Click-accurate overlays on slide backgrounds" },
    { icon: Play, label: "Guided + Practice", desc: "Two modes with Hindi narration support" },
  ];

  return (
    <>
      <Head>
        <title>Slides → Sim | AI-Powered Training Simulations</title>
        <meta name="description" content="Convert Google Slides training decks into interactive product simulations automatically" />
      </Head>

      <div className="min-h-screen bg-[#0f0f1a] text-slate-200">
        {/* Header */}
        <header className="border-b border-[#2d2d44] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center">
              <Sparkles size={16} />
            </div>
            <span className="font-semibold text-white font-display">slides-to-sim</span>
          </div>
          <a
            href="https://github.com"
            className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            GitHub →
          </a>
        </header>

        {/* Hero */}
        <main className="max-w-3xl mx-auto px-6 py-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center mb-12"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs mb-6">
              <Sparkles size={12} />
              Powered by Gemini Vision AI
            </div>
            <h1 className="text-5xl font-bold text-white font-display leading-tight mb-4">
              Training slides →<br />
              <span className="text-indigo-400">Interactive simulation</span>
            </h1>
            <p className="text-slate-400 text-lg max-w-xl mx-auto">
              Paste any Google Slides training deck. We analyze it with AI and generate
              a Storylane-style interactive walkthrough automatically.
            </p>
          </motion.div>

          {/* Input Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="bg-[#1a1a2e] border border-[#2d2d44] rounded-2xl p-6 mb-8"
          >
            <label className="block text-sm text-slate-400 mb-2">Google Slides URL</label>
            <div className="flex gap-2 mb-4">
              <div className="flex-1 flex items-center gap-2 bg-[#0f0f1a] border border-[#2d2d44] rounded-xl px-3 py-2">
                <Link2 size={16} className="text-slate-500 shrink-0" />
                <input
                  type="url"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleGenerate()}
                  placeholder="https://docs.google.com/presentation/d/..."
                  className="flex-1 bg-transparent text-sm text-slate-200 placeholder:text-slate-600 outline-none"
                />
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={loading || !url.trim()}
              className="w-full flex items-center justify-center gap-2 bg-indigo-500 hover:bg-indigo-400 disabled:bg-indigo-500/30 disabled:cursor-not-allowed text-white font-medium rounded-xl py-3 px-4 transition-all"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Generating simulation...
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  Generate Simulation
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </motion.div>

          {/* Progress */}
          <AnimatePresence>
            {job && loading && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-[#1a1a2e] border border-[#2d2d44] rounded-xl p-4 mb-6"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-slate-300">{job.current_phase}</span>
                  <span className="text-sm text-indigo-400 font-mono">{job.progress}%</span>
                </div>
                <div className="h-1.5 bg-[#0f0f1a] rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${job.progress}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-xl p-4 mb-6 text-sm">
              {error}
            </div>
          )}

          {/* Features */}
          <div className="grid grid-cols-2 gap-3">
            {features.map((f, i) => (
              <motion.div
                key={f.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.05 }}
                className="bg-[#1a1a2e] border border-[#2d2d44] rounded-xl p-4"
              >
                <div className="flex items-center gap-2 mb-1">
                  <f.icon size={15} className="text-indigo-400" />
                  <span className="text-sm font-medium text-white">{f.label}</span>
                </div>
                <p className="text-xs text-slate-500">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </main>
      </div>
    </>
  );
}
