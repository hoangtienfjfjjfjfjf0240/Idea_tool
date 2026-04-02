export interface AppProject {
  id: string;
  name: string;
  category: string;
  icon_url: string;
  store_link: string | null;
  features_count: number;
  last_synced_at: string | null;
  app_knowledge: string | null;
  created_at: string;
  updated_at: string;
}

export interface Feature {
  id: string;
  app_id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface Hook {
  id: string;
  app_id: string | null;
  title: string;
  subtitle: string | null;
  thumb: string | null;
  description: string | null;
  hook_concept: string | null;
  visual_detail: string | null;
  image_url: string | null;
  video_url: string | null;
  created_at: string;
}

export interface GeneratedIdea {
  id: string;
  app_id: string;
  title: string | null;
  duration: string | null;
  content: IdeaContent;
  created_at: string;
}

export interface IdeaContent {
  explanation: string;
  hook: {
    visual: string;
    text: string;
    voice: string;
    imageUrl?: string;
  };
  problem: {
    scenes: { visual: string; text?: string; voice: string }[];
  };
  solution: {
    visual: string;
    voice: string;
    text: string;
  };
  demo: {
    step1_prep: { visual: string; voice?: string };
    step2_action: { visual: string; voice?: string };
    step3_result: { visual: string; voice: string };
  };
  cta: {
    voice: string;
    text: string;
  };
}

export interface FilterOption {
  id: string;
  app_id: string;
  category: string;
  value: string;
  is_custom: boolean;
  created_at: string;
}

export interface SyncLog {
  id: string;
  app_id: string;
  sync_type: 'auto' | 'manual';
  status: 'pending' | 'success' | 'failed';
  changes: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
}

export interface FilterState {
  coreUser: string[];
  painPoint: string[];
  solution: string[];
  motivation: string[];
  videoStructure: string[];
}

export type ScreenType =
  | 'f1'
  | 'f2'
  | 'f2.1'
  | 'f2.1.1'
  | 'f2.1.2'
  | 'f2.2'
  | 'f2.2.1'
  | 'f2.2.2';

// Supabase Database types helper
export interface Database {
  public: {
    Tables: {
      apps: {
        Row: AppProject;
        Insert: Omit<AppProject, 'id' | 'created_at' | 'updated_at'> & { id?: string };
        Update: Partial<Omit<AppProject, 'id'>>;
      };
      features: {
        Row: Feature;
        Insert: Omit<Feature, 'id' | 'created_at'> & { id?: string };
        Update: Partial<Omit<Feature, 'id'>>;
      };
      hooks: {
        Row: Hook;
        Insert: Omit<Hook, 'id' | 'created_at'> & { id?: string };
        Update: Partial<Omit<Hook, 'id'>>;
      };
      generated_ideas: {
        Row: GeneratedIdea;
        Insert: Omit<GeneratedIdea, 'id' | 'created_at'> & { id?: string };
        Update: Partial<Omit<GeneratedIdea, 'id'>>;
      };
      filter_options: {
        Row: FilterOption;
        Insert: Omit<FilterOption, 'id' | 'created_at'> & { id?: string };
        Update: Partial<Omit<FilterOption, 'id'>>;
      };
      sync_logs: {
        Row: SyncLog;
        Insert: Omit<SyncLog, 'id' | 'created_at'> & { id?: string };
        Update: Partial<Omit<SyncLog, 'id'>>;
      };
    };
  };
}
