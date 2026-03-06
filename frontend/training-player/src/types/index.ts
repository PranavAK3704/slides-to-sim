export type ActionType = "click" | "type" | "select" | "hover" | "navigate" | "scroll" | "verify";
export type PlayerMode = "guided" | "practice";

export interface Hotspot {
  /** Left edge as % of screenshot width (0–100) */
  xPct: number;
  /** Top edge as % of screenshot height (0–100) */
  yPct: number;
  widthPct: number;
  heightPct: number;
}

export interface SimulationStep {
  stepNumber: number;
  instruction: string;
  hindiInstruction?: string;
  selector: string;
  action: ActionType;
  value?: string;
  hint?: string;
  /** App screenshot URL served from /static/screenshots/... (DOM-matched sims) */
  screenshot?: string;
  /** Hotspot overlay position as % of screenshot dimensions */
  hotspot?: Hotspot;
  /** Slide image URL served from /static/slides/... (fallback) */
  slideImage?: string;
  validation?: {
    type: "click_target" | "url_change" | "element_visible";
    expected: string;
  };
  meta?: {
    target?: string;
    confidence?: number;
    orderingMethod?: string;
    fallbackUsed?: boolean;
  };
}

export interface SimulationConfig {
  id: string;
  title: string;
  description?: string;
  targetUrl?: string;
  domMatched?: boolean;
  createdAt: string;
  stepCount: number;
  estimatedMinutes?: number;
  steps: SimulationStep[];
}
