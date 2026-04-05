export type ActionType = "click" | "type" | "select" | "hover" | "navigate" | "scroll" | "verify";
export type PlayerMode = "guided" | "practice";

export interface Hotspot {
  /** Left edge as % of image width (0–100) */
  xPct: number;
  /** Top edge as % of image height (0–100) */
  yPct: number;
  widthPct: number;
  heightPct: number;
}

export interface SimulationStep {
  stepNumber: number;
  instruction: string;
  hindiInstruction?: string;
  action: ActionType;
  value?: string | null;
  hint?: string;
  /** Hotspot overlay position as % of slide/screenshot dimensions */
  hotspot?: Hotspot | null;
  /** Slide image URL served from /static/slides/... */
  slideImage?: string;
  /** App screenshot URL (DOM-matched sims — legacy) */
  screenshot?: string;
  /** Whether this step was flagged for human review (low Gemini confidence) */
  needsReview?: boolean;
  /** Exact visible text of DOM element to click (for live overlay) */
  elementText?: string;
  /** URL fragment that must appear in window.location.href for this step */
  urlPattern?: string;
  /** false = intercept click in dry-run mode before advancing */
  isSafeAction?: boolean;
  meta?: {
    target?: string;
    confidence?: number;
    orderingMethod?: string;
    annotationType?: string;
    sourceSlideId?: number;
    fallbackUsed?: boolean;
  };
}

export interface SimulationConfig {
  id: string;
  title: string;
  description?: string;
  createdAt: string;
  stepCount: number;
  estimatedMinutes?: number;
  /** True if any step still needs human review */
  reviewRequired?: boolean;
  reviewCount?: number;
  steps: SimulationStep[];
}
