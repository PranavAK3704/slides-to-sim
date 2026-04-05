import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL  || 'https://wfnmltorfvaokqbzggkn.supabase.co';
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON || 'sb_publishable_kVRokdcfNT-egywk-KbQ3g_mEs5QVGW';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── Types matching Supabase tables ──────────────────────────────

export interface AgentProfile {
  email:              string;
  role:               string;
  hub:                string | null;
  level:              number;
  total_xp:           number;
  streak_current:     number;
  streak_longest:     number;
  videos_watched:     number;
  assessments_passed: number;
  avg_score:          number;
  last_active:        string;
  created_at:         string;
  updated_at:         string;
}

export interface CaptainSession {
  id:           string;
  session_id:   string;
  email:        string;
  process_name: string;
  pct:          number;
  total_pkrt:   number;
  pause_count:  number;
  query_count:  number;
  error_count:  number;
  started_at:   string;
  completed_at: string;
}

export interface GamificationEvent {
  id:             string;
  email:          string;
  event_type:     string;
  xp_amount:      number;
  reason:         string | null;
  process_name:   string | null;
  new_level:      number | null;
  achievement_id: string | null;
  created_at:     string;
}

export interface ARTMetric {
  id:           string;
  email:        string;
  date:         string;
  queue:        string;
  art_hours:    number;
  ticket_count: number;
  reopen_count: number;
}

export interface Simulation {
  id:           string;
  title:        string;
  process_name: string | null;
  hub:          string | null;
  step_count:   number;
  steps_json:   unknown;
  created_by:   string | null;
  created_at:   string;
  published:    boolean | null;
}

export interface HubSummary {
  hub:      string;
  captains: number;
  avg_pct:  number;   // minutes
  avg_xp:   number;
  sessions_today: number;
  avg_level: number;
}
