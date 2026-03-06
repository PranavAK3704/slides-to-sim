import { useState, useEffect } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { motion } from "framer-motion";
import { Play, Sparkles, Clock, Layers, ArrowRight, Trash2 } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type SimSummary = {
  id: string;
  title: string;
  stepCount: number;
  createdAt: string;
};

export default function Library() {
  const [sims, setSims] = useState<SimSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/api/simulations`)
      .then(r => r.json())
      .then(data => { setSims(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const deleteSim = async (id: string) => {
    await fetch(`${API_URL}/api/simulations/${id}`, { method: "DELETE" });
    setSims(prev => prev.filter(s => s.id !== id));
  };

  return (
    <>
      <Head><title>Simulation Library | slides-to-sim</title></Head>
      <div className="min-h-screen bg-[#0f0f1a] text-slate-200">
        <header className="border-b border-[#2d2d44] px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center">
              <Sparkles size={16} />
            </div>
            <span className="font-semibold text-white">slides-to-sim</span>
          </Link>
          <Link href="/" className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1">
            <Sparkles size={12} /> New Simulation
          </Link>
        </header>

        <main className="max-w-3xl mx-auto px-6 py-12">
          <h1 className="text-2xl font-bold text-white mb-8">Simulation Library</h1>

          {loading ? (
            <div className="text-slate-500 text-sm">Loading...</div>
          ) : sims.length === 0 ? (
            <div className="text-center py-16">
              <Layers size={40} className="text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400 mb-2">No simulations yet</p>
              <Link href="/" className="text-indigo-400 text-sm hover:text-indigo-300">
                Generate your first one →
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {sims.map((sim, i) => (
                <motion.div
                  key={sim.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="bg-[#1a1a2e] border border-[#2d2d44] hover:border-[#4a4a66] rounded-xl p-4 flex items-center gap-4 group transition-all"
                >
                  <div className="w-10 h-10 bg-indigo-500/10 border border-indigo-500/20 rounded-lg flex items-center justify-center shrink-0">
                    <Play size={16} className="text-indigo-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-white font-medium truncate">{sim.title}</h3>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-slate-500 flex items-center gap-1">
                        <Layers size={11} /> {sim.stepCount} steps
                      </span>
                      <span className="text-xs text-slate-500 flex items-center gap-1">
                        <Clock size={11} /> {new Date(sim.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => deleteSim(sim.id)}
                      className="p-1.5 text-slate-600 hover:text-red-400 transition-colors rounded"
                    >
                      <Trash2 size={14} />
                    </button>
                    <Link
                      href={`/sim/${sim.id}`}
                      className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 px-3 py-1.5 bg-indigo-500/10 rounded-lg transition-all"
                    >
                      Launch <ArrowRight size={12} />
                    </Link>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
