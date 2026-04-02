import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { supabase } from "@/lib/supabase";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronRight, ChevronLeft, CheckCircle2, AlertCircle,
  BookOpen, GraduationCap, X, Lightbulb, MousePointer,
  Type, ChevronDown, Navigation, Eye, Volume2, VolumeX,
} from "lucide-react";
import type { SimulationConfig, SimulationStep, PlayerMode } from "@/types";

// ─── Hindi TTS via Web Speech API ────────────────────────────────────────────

function narrateHindi(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "hi-IN";
  u.rate = 0.9;
  u.pitch = 1;
  window.speechSynthesis.speak(u);
}

function stopNarration() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const ACTION_ICONS: Record<string, React.ElementType> = {
  click: MousePointer,
  type: Type,
  select: ChevronDown,
  hover: Eye,
  navigate: Navigation,
  verify: Eye,
};

// ─── Main Player ─────────────────────────────────────────────────────────────

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
  const [showWrong, setShowWrong] = useState(false);
  const [showCorrect, setShowCorrect] = useState(false);
  const [finished, setFinished] = useState(false);
  const [narrating, setNarrating] = useState(false);
  const [startTime] = useState(Date.now());

  // Email: from query param → localStorage → anonymous
  const email = (router.query.email as string) || (typeof window !== 'undefined' ? localStorage.getItem('valmo_user_email') || '' : '');

  useEffect(() => {
    if (!id) return;
    fetch(`${API_URL}/api/simulations/${id}`)
      .then(r => r.json())
      .then(data => { setSim(data); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [id]);

  const advance = useCallback(() => {
    if (!sim) return;
    stopNarration();
    setNarrating(false);
    setCompletedSteps(prev => new Set([...prev, currentStep]));
    setShowHint(false);
    setShowCorrect(false);
    if (currentStep < sim.steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      setFinished(true);
    }
  }, [sim, currentStep]);

  if (loading) return <LoadingScreen />;
  if (error || !sim) return <ErrorScreen error={error} />;
  if (finished) return (
    <FinishedScreen sim={sim} wrongClicks={wrongClicks} startTime={startTime} email={email} />
  );

  const step = sim.steps[currentStep];
  const progress = (currentStep / sim.steps.length) * 100;

  return (
    <>
      <Head><title>{sim.title} | Simulation</title></Head>
      <div className="min-h-screen bg-[#0a0a14] flex flex-col select-none">

        {/* Top bar */}
        <header className="border-b border-[#2d2d44] px-4 py-2.5 flex items-center justify-between shrink-0 z-20">
          <button
            onClick={() => router.push("/")}
            className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 text-sm transition-colors"
          >
            <X size={14} /> Exit
          </button>

          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-400 hidden md:block truncate max-w-xs">{sim.title}</span>
            <div className="flex gap-1 bg-[#1a1a2e] border border-[#2d2d44] rounded-lg p-0.5">
              {(["guided", "practice"] as PlayerMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setShowHint(false); }}
                  className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                    mode === m ? "bg-indigo-500 text-white" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {m === "guided"
                    ? <><BookOpen size={10} className="inline mr-1" />Guided</>
                    : <><GraduationCap size={10} className="inline mr-1" />Practice</>}
                </button>
              ))}
            </div>
          </div>

          <span className="text-sm text-slate-400 font-mono tabular-nums">
            {currentStep + 1}/{sim.steps.length}
          </span>
        </header>

        {/* Progress bar */}
        <div className="h-0.5 bg-[#2d2d44] shrink-0">
          <motion.div
            className="h-full bg-gradient-to-r from-indigo-500 to-violet-500"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>

        {/* Body */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex-1 flex flex-col md:flex-row overflow-hidden"
            >
              {/* Main visual area */}
              <div className="flex-1 flex items-center justify-center bg-[#0a0a14] overflow-hidden p-4">
                <VisualArea
                  step={step}
                  mode={mode}
                  showHint={showHint}
                  showWrong={showWrong}
                  showCorrect={showCorrect}
                  onHotspotClick={() => {
                    if (mode === "guided") {
                      advance();
                    } else {
                      setShowCorrect(true);
                      setTimeout(advance, 600);
                    }
                  }}
                  onMissClick={() => {
                    setWrongClicks(w => w + 1);
                    setShowWrong(true);
                    setTimeout(() => setShowWrong(false), 700);
                  }}
                />
              </div>

              {/* Side panel */}
              <div className="md:w-72 shrink-0 border-t md:border-t-0 md:border-l border-[#2d2d44] flex flex-col bg-[#0f0f1a] overflow-y-auto">
                <StepPanel
                  step={step}
                  mode={mode}
                  showHint={showHint}
                  narrating={narrating}
                  onToggleHint={() => setShowHint(h => !h)}
                  onToggleNarrate={() => {
                    if (narrating) {
                      stopNarration();
                      setNarrating(false);
                    } else if (step.hindiInstruction) {
                      setNarrating(true);
                      narrateHindi(step.hindiInstruction);
                      // Reset button state when speech ends
                      const u = window.speechSynthesis;
                      const check = setInterval(() => {
                        if (!u.speaking) { setNarrating(false); clearInterval(check); }
                      }, 300);
                    }
                  }}
                  onPrev={() => { if (currentStep > 0) { stopNarration(); setNarrating(false); setCurrentStep(p => p - 1); setShowHint(false); } }}
                  onNext={advance}
                  isFirst={currentStep === 0}
                  isLast={currentStep === sim.steps.length - 1}
                />

                {/* Step list */}
                <div className="flex-1 overflow-y-auto p-3 border-t border-[#2d2d44]">
                  <p className="text-xs text-slate-600 uppercase tracking-wider mb-2">All Steps</p>
                  <div className="space-y-1">
                    {sim.steps.map((s, i) => {
                      const active = i === currentStep;
                      const done = completedSteps.has(i);
                      const Icon = ACTION_ICONS[s.action] || MousePointer;
                      return (
                        <button
                          key={s.stepNumber}
                          onClick={() => { setCurrentStep(i); setShowHint(false); }}
                          className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-all ${
                            active ? "bg-indigo-500/20 border border-indigo-500/30"
                            : done  ? "bg-[#1a1a2e] border border-[#2d2d44] opacity-50"
                                    : "bg-[#1a1a2e] border border-[#2d2d44] hover:border-[#4a4a66]"
                          }`}
                        >
                          <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${
                            active ? "bg-indigo-500" : done ? "bg-green-500/20" : "bg-[#0f0f1a]"
                          }`}>
                            {done
                              ? <CheckCircle2 size={10} className="text-green-400" />
                              : <Icon size={9} className={active ? "text-white" : "text-slate-500"} />}
                          </div>
                          <p className={`text-xs truncate ${active ? "text-white font-medium" : "text-slate-400"}`}>
                            {s.instruction}
                          </p>
                          <span className="text-xs text-slate-600 ml-auto font-mono shrink-0">{s.stepNumber}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}


// ─── Visual Area ─────────────────────────────────────────────────────────────

function VisualArea({
  step, mode, showHint, showWrong, showCorrect, onHotspotClick, onMissClick,
}: {
  step: SimulationStep;
  mode: PlayerMode;
  showHint: boolean;
  showWrong: boolean;
  showCorrect: boolean;
  onHotspotClick: () => void;
  onMissClick: () => void;
}) {
  // Primary image: DOM-matched screenshot first, then slide image
  const imageUrl = step.screenshot || step.slideImage;

  // If we have an image + hotspot → full Storylane-style spotlight view
  if (imageUrl && step.hotspot) {
    return (
      <ScreenshotView
        imageUrl={imageUrl.startsWith("http") ? imageUrl : `${API_URL}${imageUrl}`}
        step={step}
        mode={mode}
        showHint={showHint}
        showWrong={showWrong}
        showCorrect={showCorrect}
        onHotspotClick={onHotspotClick}
        onMissClick={onMissClick}
      />
    );
  }
  // Image without hotspot → informational slide (just show image + caption)
  if (imageUrl) {
    return <SlideView imageUrl={imageUrl.startsWith("http") ? imageUrl : `${API_URL}${imageUrl}`} step={step} />;
  }
  return <TextFallbackView step={step} />;
}


// ─── Screenshot View (Storylane-style) ───────────────────────────────────────

function ScreenshotView({
  imageUrl, step, mode, showHint, showWrong, showCorrect, onHotspotClick, onMissClick,
}: {
  imageUrl: string;
  step: SimulationStep;
  mode: PlayerMode;
  showHint: boolean;
  showWrong: boolean;
  showCorrect: boolean;
  onHotspotClick: () => void;
  onMissClick: () => void;
}) {
  const { hotspot } = step;

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!hotspot || mode !== "practice") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    const tol = 3;
    const hit =
      xPct >= hotspot.xPct - tol && xPct <= hotspot.xPct + hotspot.widthPct + tol &&
      yPct >= hotspot.yPct - tol && yPct <= hotspot.yPct + hotspot.heightPct + tol;
    if (hit) onHotspotClick();
    else onMissClick();
  };

  const tooltipBelow = hotspot ? hotspot.yPct + hotspot.heightPct < 75 : true;

  return (
    <div className="relative w-full max-w-5xl" style={{ aspectRatio: "16/9" }}>
      <div
        className="absolute inset-0 rounded-xl border border-[#2d2d44] overflow-hidden"
        onClick={handleContainerClick}
        style={{ cursor: mode === "practice" ? "crosshair" : "default" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="App screenshot" className="w-full h-full object-cover" draggable={false} />

        {/* Spotlight: dim everything outside hotspot */}
        {hotspot && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute bg-black/50" style={{ top: 0, left: 0, right: 0, height: `${hotspot.yPct}%` }} />
            <div className="absolute bg-black/50" style={{ top: `${hotspot.yPct + hotspot.heightPct}%`, left: 0, right: 0, bottom: 0 }} />
            <div className="absolute bg-black/50" style={{ top: `${hotspot.yPct}%`, left: 0, width: `${hotspot.xPct}%`, height: `${hotspot.heightPct}%` }} />
            <div className="absolute bg-black/50" style={{ top: `${hotspot.yPct}%`, left: `${hotspot.xPct + hotspot.widthPct}%`, right: 0, height: `${hotspot.heightPct}%` }} />
          </div>
        )}

        {/* Hotspot ring */}
        {hotspot && (
          <div
            onClick={e => { e.stopPropagation(); onHotspotClick(); }}
            className="absolute rounded-sm"
            style={{
              left: `${hotspot.xPct}%`,
              top: `${hotspot.yPct}%`,
              width: `${hotspot.widthPct}%`,
              height: `${hotspot.heightPct}%`,
              cursor: "pointer",
              boxShadow: showCorrect
                ? "0 0 0 3px rgba(34,197,94,0.9), 0 0 20px rgba(34,197,94,0.4)"
                : showWrong
                ? "0 0 0 3px rgba(239,68,68,0.9)"
                : "0 0 0 3px rgba(99,102,241,0.9), 0 0 0 6px rgba(99,102,241,0.3)",
            }}
          >
            {!showWrong && !showCorrect && (
              <span className="absolute inset-0 rounded-sm animate-ping opacity-25 bg-indigo-500" />
            )}
          </div>
        )}

        {/* Instruction tooltip */}
        {hotspot && (mode === "guided" || showHint) && (
          <div
            className="absolute pointer-events-none z-10"
            style={{
              left: `${hotspot.xPct + hotspot.widthPct / 2}%`,
              ...(tooltipBelow
                ? { top: `${hotspot.yPct + hotspot.heightPct + 1.5}%` }
                : { bottom: `${100 - hotspot.yPct + 1.5}%` }),
              transform: "translateX(-50%)",
            }}
          >
            {tooltipBelow && (
              <div className="w-0 h-0 mx-auto" style={{
                borderLeft: "6px solid transparent", borderRight: "6px solid transparent",
                borderBottom: "6px solid #6366f1",
              }} />
            )}
            <div className="bg-indigo-600 text-white text-xs font-medium px-3 py-2 rounded-lg shadow-xl whitespace-nowrap max-w-[200px] text-center leading-snug">
              {step.instruction}
            </div>
            {!tooltipBelow && (
              <div className="w-0 h-0 mx-auto" style={{
                borderLeft: "6px solid transparent", borderRight: "6px solid transparent",
                borderTop: "6px solid #6366f1",
              }} />
            )}
          </div>
        )}

        {/* Feedback overlays */}
        <AnimatePresence>
          {showWrong && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-red-500/90 text-white px-4 py-2 rounded-xl font-medium text-sm shadow-xl">
                Click the highlighted area
              </div>
            </motion.div>
          )}
          {showCorrect && (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-green-500/90 text-white px-4 py-2 rounded-xl font-medium text-sm shadow-xl flex items-center gap-2">
                <CheckCircle2 size={16} /> Correct!
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {mode === "practice" && !showHint && (
        <p className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs text-slate-600">
          Click the highlighted element to continue
        </p>
      )}
    </div>
  );
}


// ─── Slide View ───────────────────────────────────────────────────────────────

function SlideView({ imageUrl, step }: { imageUrl: string; step: SimulationStep }) {
  return (
    <div className="relative w-full max-w-4xl" style={{ aspectRatio: "16/9" }}>
      <div className="absolute inset-0 rounded-xl border border-[#2d2d44] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="Slide" className="w-full h-full object-cover" draggable={false} />
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-6 py-4">
          <p className="text-white font-semibold text-lg drop-shadow">{step.instruction}</p>
          {step.meta?.target && (
            <p className="text-indigo-300 text-sm mt-1 font-mono">{step.meta.target}</p>
          )}
        </div>
      </div>
    </div>
  );
}


// ─── Text Fallback ────────────────────────────────────────────────────────────

function TextFallbackView({ step }: { step: SimulationStep }) {
  const Icon = ACTION_ICONS[step.action] || MousePointer;
  return (
    <div className="flex flex-col items-center justify-center gap-5 max-w-md text-center p-8">
      <div className="w-20 h-20 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl flex items-center justify-center">
        <Icon size={36} className="text-indigo-400" />
      </div>
      <div>
        <p className="text-xs text-indigo-400 font-mono uppercase tracking-wider mb-2">
          {step.action} · Step {step.stepNumber}
        </p>
        <h2 className="text-white text-2xl font-bold leading-tight">{step.instruction}</h2>
        {step.meta?.target && (
          <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1a1a2e] border border-[#2d2d44] rounded-lg">
            <MousePointer size={11} className="text-slate-500" />
            <code className="text-slate-300 text-xs font-mono">{step.meta.target}</code>
          </div>
        )}
      </div>
      <p className="text-slate-500 text-sm">
        Add a Target App URL when generating to get an interactive simulation with screenshots.
      </p>
    </div>
  );
}


// ─── Step Side Panel ──────────────────────────────────────────────────────────

function StepPanel({
  step, mode, showHint, narrating, onToggleHint, onToggleNarrate, onPrev, onNext, isFirst, isLast,
}: {
  step: SimulationStep;
  mode: PlayerMode;
  showHint: boolean;
  narrating: boolean;
  onToggleHint: () => void;
  onToggleNarrate: () => void;
  onPrev: () => void;
  onNext: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const Icon = ACTION_ICONS[step.action] || MousePointer;
  return (
    <div className="p-4 shrink-0">
      <div className="bg-[#1a1a2e] border border-[#2d2d44] rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-indigo-500/20 border border-indigo-500/30 rounded flex items-center justify-center">
              <Icon size={12} className="text-indigo-400" />
            </div>
            <span className="text-xs text-indigo-300 font-mono uppercase tracking-wider">
              Step {step.stepNumber} · {step.action}
            </span>
          </div>
          {/* Hindi narration button */}
          {step.hindiInstruction && (
            <button
              onClick={onToggleNarrate}
              title={narrating ? "Stop narration" : "Listen in Hindi"}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all border ${
                narrating
                  ? "bg-orange-500/20 border-orange-500/30 text-orange-300"
                  : "bg-[#0f0f1a] border-[#2d2d44] text-slate-500 hover:text-orange-300 hover:border-orange-500/30"
              }`}
            >
              {narrating ? <VolumeX size={11} /> : <Volume2 size={11} />}
              <span>हिं</span>
            </button>
          )}
        </div>
        <h2 className="text-white font-semibold text-sm leading-snug mb-1">{step.instruction}</h2>
        {step.hindiInstruction && (
          <p className="text-slate-500 text-xs leading-snug mb-3">{step.hindiInstruction}</p>
        )}
        {step.meta?.target && (
          <div className="flex items-center gap-1.5 bg-[#0f0f1a] border border-[#2d2d44] rounded-lg px-2 py-1 mb-3">
            <MousePointer size={9} className="text-slate-500 shrink-0" />
            <code className="text-xs text-slate-400 font-mono truncate">{step.meta.target}</code>
          </div>
        )}
        {mode === "guided" && step.hint && (
          <div>
            <button
              onClick={onToggleHint}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-amber-400 transition-colors"
            >
              <Lightbulb size={11} />
              {showHint ? "Hide hint" : "Show hint"}
            </button>
            <AnimatePresence>
              {showHint && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-2"
                >
                  {step.hint}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={onPrev} disabled={isFirst}
          className="flex-1 flex items-center justify-center gap-1 bg-[#1a1a2e] border border-[#2d2d44] hover:border-[#4a4a66] disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 rounded-xl py-2.5 text-xs transition-all">
          <ChevronLeft size={14} /> Back
        </button>
        <button onClick={onNext}
          className="flex-1 flex items-center justify-center gap-1 bg-indigo-500 hover:bg-indigo-400 text-white rounded-xl py-2.5 text-xs font-medium transition-all">
          {isLast ? <><CheckCircle2 size={14} /> Finish</> : <>Next <ChevronRight size={14} /></>}
        </button>
      </div>
    </div>
  );
}


// ─── Loading / Error / Finished ───────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-[#0a0a14] flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-400 text-sm">Loading simulation...</p>
      </div>
    </div>
  );
}

function ErrorScreen({ error }: { error: string }) {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-[#0a0a14] flex items-center justify-center">
      <div className="text-center max-w-sm">
        <AlertCircle size={40} className="text-red-400 mx-auto mb-4" />
        <h2 className="text-white font-semibold mb-2">Simulation not found</h2>
        <p className="text-slate-400 text-sm mb-4">{error || "Could not load this simulation"}</p>
        <button onClick={() => router.push("/")} className="bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm">
          Go home
        </button>
      </div>
    </div>
  );
}

function FinishedScreen({
  sim, wrongClicks, startTime, email,
}: {
  sim: SimulationConfig;
  wrongClicks: number;
  startTime: number;
  email: string;
}) {
  const router = useRouter();
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const score = Math.max(0, 100 - wrongClicks * 10);

  // Write completion to Supabase once on mount
  useEffect(() => {
    if (!email || !sim.id) return;
    const xp = score >= 90 ? 100 : score >= 70 ? 60 : 30;
    Promise.all([
      supabase.from('sim_completions').upsert({
        email,
        sim_id:       sim.id,
        process_name: sim.title,
        score,
        mode:         'practice',
        time_seconds: elapsed,
        completed_at: new Date().toISOString(),
      }, { onConflict: 'email,sim_id', ignoreDuplicates: false }),
      supabase.from('gamification_events').insert({
        email,
        event_type:   'xp_earned',
        xp_amount:    xp,
        reason:       `Completed sim: ${sim.title}`,
        process_name: sim.title,
        created_at:   new Date().toISOString(),
      }),
    ]).catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a14] flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#1a1a2e] border border-[#2d2d44] rounded-2xl p-8 max-w-sm w-full text-center"
      >
        <div className="w-16 h-16 bg-green-500/20 border border-green-500/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={32} className="text-green-400" />
        </div>
        <h2 className="text-white text-2xl font-bold mb-1">Complete!</h2>
        <p className="text-slate-400 text-sm mb-6">{sim.title}</p>
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: "Score", value: `${score}%` },
            { label: "Time", value: `${mins}:${String(secs).padStart(2, "0")}` },
            { label: "Steps", value: String(sim.steps.length) },
          ].map(({ label, value }) => (
            <div key={label} className="bg-[#0a0a14] rounded-xl p-3">
              <p className="text-xl font-bold text-white font-mono">{value}</p>
              <p className="text-xs text-slate-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={() => router.reload()}
            className="flex-1 bg-[#0a0a14] border border-[#2d2d44] text-slate-300 rounded-xl py-2.5 text-sm hover:border-[#4a4a66] transition-all">
            Retry
          </button>
          <button onClick={() => router.push("/")}
            className="flex-1 bg-indigo-500 hover:bg-indigo-400 text-white rounded-xl py-2.5 text-sm transition-all">
            New Simulation
          </button>
        </div>
      </motion.div>
    </div>
  );
}
