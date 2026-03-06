export type ActionType = "click" | "type" | "select" | "hover" | "navigate" | "scroll" | "verify";
export type PlayerMode = "guided" | "practice" | "assessment";

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
  createdAt: string;
  stepCount: number;
  estimatedMinutes?: number;
  steps: SimulationStep[];
}
