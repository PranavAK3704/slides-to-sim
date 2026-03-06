// Shared TypeScript types — used by Training Player

export type ActionType = "click" | "type" | "select" | "hover" | "navigate" | "verify";

export type ElementType = "tab" | "button" | "dropdown" | "input" | "link" | "menu" | "icon" | "text";

export interface UIElement {
  label: string;
  type: ElementType;
  bbox?: { x: number; y: number; width: number; height: number };
  confidence: number;
  isHighlighted: boolean;
  highlightNumber?: number;
}

export interface SimulationStep {
  stepNumber: number;
  instruction: string;
  selector: string;
  action: ActionType;
  value?: string;
  hint?: string;
  slideImage?: string;
  validation?: {
    type: "click_target" | "url_change" | "element_visible";
    expected: string;
  };
}

export interface SimulationConfig {
  id: string;
  title: string;
  description?: string;
  targetUrl: string;
  createdAt: string;
  steps: SimulationStep[];
}

export type PlayerMode = "guided" | "practice" | "assessment";

export interface PlayerState {
  currentStep: number;
  totalSteps: number;
  mode: PlayerMode;
  completed: boolean;
  errors: number;
  startedAt: string;
}

export interface IngestionJob {
  jobId: string;
  slidesUrl: string;
  status: "pending" | "processing" | "complete" | "error";
  progress: number;      // 0-100
  currentPhase: string;
  simulationId?: string;
  error?: string;
  createdAt: string;
}
