import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronRight, ChevronLeft, CheckCircle2, AlertCircle,
  BookOpen, Play, GraduationCap, BarChart3, X, Lightbulb,
  MousePointer, Type, ChevronDown, Navigation, Eye
} from "lucide-react";
import type { SimulationConfig, SimulationStep, PlayerMode } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const ACTION_ICONS: Record<string, React.ElementType> = {
  click: MousePointer,
  type: Type,
  select: ChevronDown,
  hover: Eye,
  navigate: Navigation,
  verify: Eye,
};

export default function SimulationPlayer() {
  const router = useRouter();
  const { id } = router.query;

  const [sim, setSim] = useState<SimulationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<PlayerMode>("guided");
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [wrongClicks, setWrongClicks] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const [finished, setFinished] = useState(false);
  const [startTime] = useState(Date.now());

  useEffect(() => {
    if (!id) return;
    fetch(`${API_URL}/api/simulations/${id}`)
      .then(r => r.json())
      .then(data => { setSim(data); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [id]);

  if (loading) return <LoadingScreen />;
  if (error || !sim) return <ErrorScreen error={error} />;
  if (finished) return <FinishedScreen sim={sim} completedSteps={completedSteps} wrongClicks={wrongClicks} startTime={startTime} />;

  const step = sim.steps[currentStep];
  const progress = ((currentStep) / sim.steps.length) * 100;
  const ActionIcon = ACTION_ICONS[step.action] || MousePointer;

  const handleNext = () => {
    setCompletedSteps(prev => new Set([...prev, currentStep]));
    setShowHint(false);
    if (currentStep < sim.steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      setFinished(true);
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
      setShowHint(false);
    }
  };

  return (
    <>
      <Head><title>{sim.title} | Training Simulation</title></Head>

      <div className="min-h-screen bg-[#0f0f1a] flex flex-col">
        {/* Top bar */}
        <header className="border-b border-[#2d2d44] px-6 py-3 flex items-center justify-between">
          <button onClick={() => router.push("/")} className="text-slate-400 hover:text-slate-200 transition-colors text-sm flex items-center gap-1">
            <X size={14} /> Exit
          </button>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-400 hidden sm:block truncate max-w-xs">{sim.title}</span>
            {/* Mode selector */}
            <div className="flex gap-1 bg-[#1a1a2e] border border-[#2d2d44] rounded-lg p-1">
              {(["guided", "practice"] as PlayerMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                    mode === m ? "bg-indigo-500 text-white" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {m === "guided" ? <><BookOpen size={11} className="inline mr-1" />Guided</> 
                               : <><GraduationCap size={11} className="inline mr-1" />Practice</>}
                </button>
              ))}
            </div>
          </div>
          <span className="text-sm text-slate-400 font-mono">{currentStep + 1}/{sim.steps.length}</span>
        </header>

        {/* Progress bar */}
        <div className="h-1 bg-[#2d2d44]">
          <motion.div
            className="h-full bg-gradient-to-r from-indigo-500 to-violet-500"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col md:flex-row max-w-5xl mx-auto w-full px-4 py-8 gap-6">
          
          {/* Step Panel */}
          <div className="md:w-80 shrink-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="bg-[#1a1a2e] border border-[#2d2d44] rounded-2xl p-5"
              >
                {/* Step badge */}
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-7 h-7 bg-indigo-500/20 border border-indigo-500/30 rounded-lg flex items-center justify-center">
                    <ActionIcon size={14} className="text-indigo-400" />
                  </div>
                  <span className="text-xs text-indigo-300 font-mono uppercase tracking-wider">
                    Step {step.stepNumber} — {step.action}
                  </span>
                </div>

                {/* Instruction */}
                <h2 className="text-white font-semibold text-lg mb-3 leading-snug">
                  {step.instruction}
                </h2>

                {/* Target chip */}
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#0f0f1a] border border-[#2d2d44] rounded-lg text-xs text-slate-300 mb-4">
                  <MousePointer size={10} className="text-slate-500" />
                  <code className="font-mono">{step.meta?.target || step.selector}</code>
                </div>

                {/* Hint (guided mode) */}
                {mode === "guided" && (
                  <div className="mt-3">
                    <button
                      onClick={() => setShowHint(!showHint)}
                      className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-amber-400 transition-colors"
                    >
                      <Lightbulb size={12} />
                      {showHint ? "Hide hint" : "Show hint"}
                    </button>
                    <AnimatePresence>
                      {showHint && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mt-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2"
                        >
                          {step.hint}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {/* Selector info (debug) */}
                <div className="mt-4 pt-4 border-t border-[#2d2d44]">
                  <p className="text-xs text-slate-600">Selector</p>
                  <code className="text-xs text-slate-500 font-mono break-all">{step.selector}</code>
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Navigation buttons */}
            <div className="flex gap-2 mt-4">
              <button
                onClick={handlePrev}
                disabled={currentStep === 0}
                className="flex-1 flex items-center justify-center gap-1.5 bg-[#1a1a2e] border border-[#2d2d44] hover:border-[#4a4a66] disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 rounded-xl py-3 text-sm transition-all"
              >
                <ChevronLeft size={16} /> Back
              </button>
              <button
                onClick={handleNext}
                className="flex-1 flex items-center justify-center gap-1.5 bg-indigo-500 hover:bg-indigo-400 text-white rounded-xl py-3 text-sm font-medium transition-all"
              >
                {currentStep === sim.steps.length - 1 ? (
                  <><CheckCircle2 size={16} /> Finish</>
                ) : (
                  <>Next <ChevronRight size={16} /></>
                )}
              </button>
            </div>
          </div>

          {/* Step List sidebar */}
          <div className="flex-1">
            <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-3">All Steps</h3>
            <div className="space-y-1.5">
              {sim.steps.map((s, i) => {
                const isActive = i === currentStep;
                const isDone = completedSteps.has(i);
                const StepIcon = ACTION_ICONS[s.action] || MousePointer;
                
                return (
                  <motion.button
                    key={s.stepNumber}
                    onClick={() => setCurrentStep(i)}
                    whileHover={{ x: 2 }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${
                      isActive
                        ? "bg-indigo-500/20 border border-indigo-500/30"
                        : isDone
                        ? "bg-[#1a1a2e] border border-[#2d2d44] opacity-60"
                        : "bg-[#1a1a2e] border border-[#2d2d44] hover:border-[#4a4a66]"
                    }`}
                  >
                    <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${
                      isActive ? "bg-indigo-500" : isDone ? "bg-green-500/20" : "bg-[#0f0f1a]"
                    }`}>
                      {isDone ? (
                        <CheckCircle2 size={12} className="text-green-400" />
                      ) : (
                        <StepIcon size={11} className={isActive ? "text-white" : "text-slate-500"} />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className={`text-sm truncate ${isActive ? "text-white font-medium" : "text-slate-400"}`}>
                        {s.instruction}
                      </p>
                      <p className="text-xs text-slate-600 font-mono truncate">{s.meta?.target}</p>
                    </div>
                    <span className="text-xs text-slate-600 ml-auto font-mono">{s.stepNumber}</span>
                  </motion.button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}


function LoadingScreen() {
  return (
    <div className="min-h-screen bg-[#0f0f1a] flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-400">Loading simulation...</p>
      </div>
    </div>
  );
}

function ErrorScreen({ error }: { error: string }) {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-[#0f0f1a] flex items-center justify-center">
      <div className="text-center max-w-sm">
        <AlertCircle size={40} className="text-red-400 mx-auto mb-4" />
        <h2 className="text-white font-semibold mb-2">Simulation not found</h2>
        <p className="text-slate-400 text-sm mb-4">{error || "Could not load this simulation"}</p>
        <button
          onClick={() => router.push("/")}
          className="bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm"
        >
          Go home
        </button>
      </div>
    </div>
  );
}

function FinishedScreen({
  sim, completedSteps, wrongClicks, startTime
}: {
  sim: SimulationConfig;
  completedSteps: Set<number>;
  wrongClicks: number;
  startTime: number;
}) {
  const router = useRouter();
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const score = Math.max(0, 100 - wrongClicks * 10);

  return (
    <div className="min-h-screen bg-[#0f0f1a] flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#1a1a2e] border border-[#2d2d44] rounded-2xl p-8 max-w-sm w-full text-center"
      >
        <div className="w-16 h-16 bg-green-500/20 border border-green-500/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={32} className="text-green-400" />
        </div>
        <h2 className="text-white text-2xl font-bold mb-1">Simulation Complete!</h2>
        <p className="text-slate-400 text-sm mb-6">{sim.title}</p>

        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-[#0f0f1a] rounded-xl p-3">
            <p className="text-2xl font-bold text-white font-mono">{score}%</p>
            <p className="text-xs text-slate-500 mt-1">Score</p>
          </div>
          <div className="bg-[#0f0f1a] rounded-xl p-3">
            <p className="text-2xl font-bold text-white font-mono">{mins}:{String(secs).padStart(2, "0")}</p>
            <p className="text-xs text-slate-500 mt-1">Time</p>
          </div>
          <div className="bg-[#0f0f1a] rounded-xl p-3">
            <p className="text-2xl font-bold text-white font-mono">{sim.steps.length}</p>
            <p className="text-xs text-slate-500 mt-1">Steps</p>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => { router.reload(); }}
            className="flex-1 bg-[#0f0f1a] border border-[#2d2d44] text-slate-300 rounded-xl py-2.5 text-sm hover:border-[#4a4a66] transition-all"
          >
            Retry
          </button>
          <button
            onClick={() => router.push("/")}
            className="flex-1 bg-indigo-500 hover:bg-indigo-400 text-white rounded-xl py-2.5 text-sm transition-all"
          >
            New Simulation
          </button>
        </div>
      </motion.div>
    </div>
  );
}
