export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_feedback: {
        Row: {
          created_at: string
          id: string
          note: string | null
          outcome_json: Json
          reaction: Database["public"]["Enums"]["ai_feedback_reaction"]
          recommendation_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          outcome_json?: Json
          reaction: Database["public"]["Enums"]["ai_feedback_reaction"]
          recommendation_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          outcome_json?: Json
          reaction?: Database["public"]["Enums"]["ai_feedback_reaction"]
          recommendation_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_feedback_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "ai_recommendations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_log: {
        Row: {
          completion_tokens: number
          created_at: string
          error: string | null
          id: string
          intent: string
          latency_ms: number | null
          model: string
          prompt_tokens: number
          status: string
          total_tokens: number | null
          user_id: string
        }
        Insert: {
          completion_tokens?: number
          created_at?: string
          error?: string | null
          id?: string
          intent: string
          latency_ms?: number | null
          model: string
          prompt_tokens?: number
          status?: string
          total_tokens?: number | null
          user_id: string
        }
        Update: {
          completion_tokens?: number
          created_at?: string
          error?: string | null
          id?: string
          intent?: string
          latency_ms?: number | null
          model?: string
          prompt_tokens?: number
          status?: string
          total_tokens?: number | null
          user_id?: string
        }
        Relationships: []
      }
      ai_memory: {
        Row: {
          category: string
          confidence: number
          content: string
          created_at: string
          embedding_hash: string | null
          expires_at: string | null
          id: string
          importance: number
          last_referenced_at: string | null
          last_used_at: string | null
          pinned: boolean
          source: string
          superseded_by: string | null
          updated_at: string
          use_count: number
          user_id: string
        }
        Insert: {
          category?: string
          confidence?: number
          content: string
          created_at?: string
          embedding_hash?: string | null
          expires_at?: string | null
          id?: string
          importance?: number
          last_referenced_at?: string | null
          last_used_at?: string | null
          pinned?: boolean
          source?: string
          superseded_by?: string | null
          updated_at?: string
          use_count?: number
          user_id: string
        }
        Update: {
          category?: string
          confidence?: number
          content?: string
          created_at?: string
          embedding_hash?: string | null
          expires_at?: string | null
          id?: string
          importance?: number
          last_referenced_at?: string | null
          last_used_at?: string | null
          pinned?: boolean
          source?: string
          superseded_by?: string | null
          updated_at?: string
          use_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_memory_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "ai_memory"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_memory_proposals: {
        Row: {
          category: string
          confidence: number
          content: string
          created_at: string
          decided_at: string | null
          dedupe_key: string
          evidence: Json
          first_seen_at: string
          id: string
          last_seen_at: string
          observed_count: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category: string
          confidence?: number
          content: string
          created_at?: string
          decided_at?: string | null
          dedupe_key: string
          evidence?: Json
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          observed_count?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          confidence?: number
          content?: string
          created_at?: string
          decided_at?: string | null
          dedupe_key?: string
          evidence?: Json
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          observed_count?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_patterns: {
        Row: {
          active: boolean
          created_at: string
          first_seen_at: string
          id: string
          last_seen_at: string
          muted_until: string | null
          occurrences: number
          pattern_key: string
          severity: number
          signals_json: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          muted_until?: string | null
          occurrences?: number
          pattern_key: string
          severity?: number
          signals_json?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          muted_until?: string | null
          occurrences?: number
          pattern_key?: string
          severity?: number
          signals_json?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_recommendations: {
        Row: {
          body_clock_basis: string | null
          confidence: number
          created_at: string
          evidence_json: Json
          feedback_score: number | null
          headline: string
          id: string
          intent: string
          pattern_id: string | null
          predicted_impact_json: Json
          rationale: string | null
          superseded_by: string | null
          tz: string | null
          user_id: string
          valid_from: string
          valid_in_tz: string | null
          valid_until: string | null
        }
        Insert: {
          body_clock_basis?: string | null
          confidence?: number
          created_at?: string
          evidence_json?: Json
          feedback_score?: number | null
          headline: string
          id?: string
          intent: string
          pattern_id?: string | null
          predicted_impact_json?: Json
          rationale?: string | null
          superseded_by?: string | null
          tz?: string | null
          user_id: string
          valid_from?: string
          valid_in_tz?: string | null
          valid_until?: string | null
        }
        Update: {
          body_clock_basis?: string | null
          confidence?: number
          created_at?: string
          evidence_json?: Json
          feedback_score?: number | null
          headline?: string
          id?: string
          intent?: string
          pattern_id?: string | null
          predicted_impact_json?: Json
          rationale?: string | null
          superseded_by?: string | null
          tz?: string | null
          user_id?: string
          valid_from?: string
          valid_in_tz?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_recommendations_pattern_fk"
            columns: ["pattern_id"]
            isOneToOne: false
            referencedRelation: "ai_patterns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_recommendations_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "ai_recommendations"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      employers: {
        Row: {
          archived_at: string | null
          color: string
          commute_min: number | null
          created_at: string
          department: string | null
          id: string
          is_default: boolean
          location: string | null
          metadata: Json
          name: string
          pay_currency: string | null
          pay_rate: number | null
          recovery_notes: string | null
          reminder_offset_min: number | null
          sort_order: number
          supervisor: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          color?: string
          commute_min?: number | null
          created_at?: string
          department?: string | null
          id?: string
          is_default?: boolean
          location?: string | null
          metadata?: Json
          name: string
          pay_currency?: string | null
          pay_rate?: number | null
          recovery_notes?: string | null
          reminder_offset_min?: number | null
          sort_order?: number
          supervisor?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          color?: string
          commute_min?: number | null
          created_at?: string
          department?: string | null
          id?: string
          is_default?: boolean
          location?: string | null
          metadata?: Json
          name?: string
          pay_currency?: string | null
          pay_rate?: number | null
          recovery_notes?: string | null
          reminder_offset_min?: number | null
          sort_order?: number
          supervisor?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      legal_acceptances: {
        Row: {
          accepted_at: string
          document_slug: string
          document_version: string
          id: string
          ip: unknown
          snapshot_json: Json
          source: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          accepted_at?: string
          document_slug: string
          document_version: string
          id?: string
          ip?: unknown
          snapshot_json?: Json
          source: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          accepted_at?: string
          document_slug?: string
          document_version?: string
          id?: string
          ip?: unknown
          snapshot_json?: Json
          source?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      notification_log: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: string
          scheduled_for: string
          sent_at: string | null
          suppressed_reason: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          scheduled_for: string
          sent_at?: string | null
          suppressed_reason?: string | null
          title?: string | null
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          scheduled_for?: string
          sent_at?: string | null
          suppressed_reason?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: []
      }
      notification_prefs: {
        Row: {
          bright_light: boolean
          caffeine_cutoff: boolean
          calendar: boolean
          commute: boolean
          created_at: string
          daily_cap: number
          enabled: boolean
          last_routine_summary_at: string | null
          quiet_end: string
          quiet_start: string
          shift_end_recovery: boolean
          shift_start: boolean
          smart_alarm: boolean
          timezone: string
          updated_at: string
          user_id: string
          wind_down: boolean
        }
        Insert: {
          bright_light?: boolean
          caffeine_cutoff?: boolean
          calendar?: boolean
          commute?: boolean
          created_at?: string
          daily_cap?: number
          enabled?: boolean
          last_routine_summary_at?: string | null
          quiet_end?: string
          quiet_start?: string
          shift_end_recovery?: boolean
          shift_start?: boolean
          smart_alarm?: boolean
          timezone?: string
          updated_at?: string
          user_id: string
          wind_down?: boolean
        }
        Update: {
          bright_light?: boolean
          caffeine_cutoff?: boolean
          calendar?: boolean
          commute?: boolean
          created_at?: string
          daily_cap?: number
          enabled?: boolean
          last_routine_summary_at?: string | null
          quiet_end?: string
          quiet_start?: string
          shift_end_recovery?: boolean
          shift_start?: boolean
          smart_alarm?: boolean
          timezone?: string
          updated_at?: string
          user_id?: string
          wind_down?: boolean
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          revenuecat_user_id: string | null
          subscription_expires_at: string | null
          subscription_tier: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          revenuecat_user_id?: string | null
          subscription_expires_at?: string | null
          subscription_tier?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          revenuecat_user_id?: string | null
          subscription_expires_at?: string | null
          subscription_tier?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_seen_at: string
          p256dh: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_seen_at?: string
          p256dh: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_seen_at?: string
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      shifts: {
        Row: {
          created_at: string
          day: number
          employer_id: string | null
          end_min: number
          end_utc: string | null
          id: string
          metadata: Json
          notes: string | null
          shift_type: string | null
          start_min: number
          start_utc: string | null
          title: string | null
          tz: string | null
          updated_at: string
          user_id: string
          week_index: number
        }
        Insert: {
          created_at?: string
          day: number
          employer_id?: string | null
          end_min: number
          end_utc?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          shift_type?: string | null
          start_min: number
          start_utc?: string | null
          title?: string | null
          tz?: string | null
          updated_at?: string
          user_id: string
          week_index?: number
        }
        Update: {
          created_at?: string
          day?: number
          employer_id?: string | null
          end_min?: number
          end_utc?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          shift_type?: string | null
          start_min?: number
          start_utc?: string | null
          title?: string | null
          tz?: string | null
          updated_at?: string
          user_id?: string
          week_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "shifts_employer_id_fkey"
            columns: ["employer_id"]
            isOneToOne: false
            referencedRelation: "employers"
            referencedColumns: ["id"]
          },
        ]
      }
      sound_mixes: {
        Row: {
          created_at: string
          id: string
          is_favorite: boolean
          name: string
          tracks: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_favorite?: boolean
          name: string
          tracks?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_favorite?: boolean
          name?: string
          tracks?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          id: string
          price_id: string
          product_id: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          price_id: string
          product_id: string
          status?: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          price_id?: string
          product_id?: string
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      trips: {
        Row: {
          arrive_utc: string
          created_at: string
          depart_utc: string
          dest_label: string | null
          dest_lat: number | null
          dest_lon: number | null
          dest_tz: string
          id: string
          label: string | null
          origin_tz: string
          source: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          arrive_utc: string
          created_at?: string
          depart_utc: string
          dest_label?: string | null
          dest_lat?: number | null
          dest_lon?: number | null
          dest_tz: string
          id?: string
          label?: string | null
          origin_tz: string
          source?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          arrive_utc?: string
          created_at?: string
          depart_utc?: string
          dest_label?: string | null
          dest_lat?: number | null
          dest_lon?: number | null
          dest_tz?: string
          id?: string
          label?: string | null
          origin_tz?: string
          source?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tz_events: {
        Row: {
          confidence: number
          detected_at: string
          from_tz: string | null
          id: string
          source: string
          to_tz: string
          user_id: string
        }
        Insert: {
          confidence?: number
          detected_at?: string
          from_tz?: string | null
          id?: string
          source?: string
          to_tz: string
          user_id: string
        }
        Update: {
          confidence?: number
          detected_at?: string
          from_tz?: string | null
          id?: string
          source?: string
          to_tz?: string
          user_id?: string
        }
        Relationships: []
      }
      user_events: {
        Row: {
          created_at: string
          ends_at: string | null
          id: string
          kind: string
          location: string | null
          notes: string | null
          reminder_min: number
          source: string
          starts_at: string
          title: string
          travel_buffer_min: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          id?: string
          kind: string
          location?: string | null
          notes?: string | null
          reminder_min?: number
          source?: string
          starts_at: string
          title: string
          travel_buffer_min?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          id?: string
          kind?: string
          location?: string | null
          notes?: string | null
          reminder_min?: number
          source?: string
          starts_at?: string
          title?: string
          travel_buffer_min?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_prefs: {
        Row: {
          ai_daily_token_cap: number
          assistant_mode: string
          assistant_name: string
          brief_enabled: Json
          brief_layout: Json
          calendar_travel_detect: boolean
          commute_minutes_baseline: number | null
          consent_json: Json
          created_at: string
          current_tz: string | null
          cycle_anchor: string | null
          cycle_weeks: number
          daily_review_enabled: boolean
          feedback_learning_enabled: boolean
          home_address: string | null
          home_tz: string | null
          lat: number
          location_label: string
          lon: number
          low_light: boolean
          memory_cutoff_at: string | null
          memory_enabled: boolean
          memory_learning_paused: boolean
          notifications: boolean
          offline_enabled: boolean
          onboarded_at: string | null
          partner_name: string
          predictive_enabled: boolean
          sleep_hours: number
          tomorrow_preview_enabled: boolean
          travel_mode_enabled: boolean
          tz_auto: boolean
          updated_at: string
          user_id: string
          voice_accent: string | null
          voice_id: string
          voice_instructions: string | null
          voice_language: string
          voice_personality: string
          voice_provider: string
          voice_speed: number
          wind_down_min: number
          work_address: string | null
        }
        Insert: {
          ai_daily_token_cap?: number
          assistant_mode?: string
          assistant_name?: string
          brief_enabled?: Json
          brief_layout?: Json
          calendar_travel_detect?: boolean
          commute_minutes_baseline?: number | null
          consent_json?: Json
          created_at?: string
          current_tz?: string | null
          cycle_anchor?: string | null
          cycle_weeks?: number
          daily_review_enabled?: boolean
          feedback_learning_enabled?: boolean
          home_address?: string | null
          home_tz?: string | null
          lat?: number
          location_label?: string
          lon?: number
          low_light?: boolean
          memory_cutoff_at?: string | null
          memory_enabled?: boolean
          memory_learning_paused?: boolean
          notifications?: boolean
          offline_enabled?: boolean
          onboarded_at?: string | null
          partner_name?: string
          predictive_enabled?: boolean
          sleep_hours?: number
          tomorrow_preview_enabled?: boolean
          travel_mode_enabled?: boolean
          tz_auto?: boolean
          updated_at?: string
          user_id: string
          voice_accent?: string | null
          voice_id?: string
          voice_instructions?: string | null
          voice_language?: string
          voice_personality?: string
          voice_provider?: string
          voice_speed?: number
          wind_down_min?: number
          work_address?: string | null
        }
        Update: {
          ai_daily_token_cap?: number
          assistant_mode?: string
          assistant_name?: string
          brief_enabled?: Json
          brief_layout?: Json
          calendar_travel_detect?: boolean
          commute_minutes_baseline?: number | null
          consent_json?: Json
          created_at?: string
          current_tz?: string | null
          cycle_anchor?: string | null
          cycle_weeks?: number
          daily_review_enabled?: boolean
          feedback_learning_enabled?: boolean
          home_address?: string | null
          home_tz?: string | null
          lat?: number
          location_label?: string
          lon?: number
          low_light?: boolean
          memory_cutoff_at?: string | null
          memory_enabled?: boolean
          memory_learning_paused?: boolean
          notifications?: boolean
          offline_enabled?: boolean
          onboarded_at?: string | null
          partner_name?: string
          predictive_enabled?: boolean
          sleep_hours?: number
          tomorrow_preview_enabled?: boolean
          travel_mode_enabled?: boolean
          tz_auto?: boolean
          updated_at?: string
          user_id?: string
          voice_accent?: string | null
          voice_id?: string
          voice_instructions?: string | null
          voice_language?: string
          voice_personality?: string
          voice_provider?: string
          voice_speed?: number
          wind_down_min?: number
          work_address?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wearable_connections: {
        Row: {
          access_token: string
          created_at: string
          expires_at: string | null
          id: string
          last_sync_at: string | null
          last_sync_error: string | null
          provider: string
          provider_user_id: string | null
          refresh_token: string | null
          scope: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          expires_at?: string | null
          id?: string
          last_sync_at?: string | null
          last_sync_error?: string | null
          provider: string
          provider_user_id?: string | null
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          last_sync_at?: string | null
          last_sync_error?: string | null
          provider?: string
          provider_user_id?: string | null
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wearable_readings: {
        Row: {
          date: string
          deep_min: number | null
          fetched_at: string
          hrv_ms: number | null
          id: string
          light_min: number | null
          provider: string
          raw: Json | null
          rem_min: number | null
          resting_hr: number | null
          sleep_duration_min: number | null
          sleep_efficiency: number | null
          sleep_end: string | null
          sleep_start: string | null
          user_id: string
        }
        Insert: {
          date: string
          deep_min?: number | null
          fetched_at?: string
          hrv_ms?: number | null
          id?: string
          light_min?: number | null
          provider: string
          raw?: Json | null
          rem_min?: number | null
          resting_hr?: number | null
          sleep_duration_min?: number | null
          sleep_efficiency?: number | null
          sleep_end?: string | null
          sleep_start?: string | null
          user_id: string
        }
        Update: {
          date?: string
          deep_min?: number | null
          fetched_at?: string
          hrv_ms?: number | null
          id?: string
          light_min?: number | null
          provider?: string
          raw?: Json | null
          rem_min?: number | null
          resting_hr?: number | null
          sleep_duration_min?: number | null
          sleep_efficiency?: number | null
          sleep_end?: string | null
          sleep_start?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_active_subscription: {
        Args: { check_env?: string; user_uuid: string }
        Returns: boolean
      }
      has_ai_budget: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      ai_feedback_reaction:
        | "helpful"
        | "not_helpful"
        | "already_did"
        | "ignored_today"
        | "dismissed_forever"
      app_role: "admin" | "tester" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      ai_feedback_reaction: [
        "helpful",
        "not_helpful",
        "already_did",
        "ignored_today",
        "dismissed_forever",
      ],
      app_role: ["admin", "tester", "user"],
    },
  },
} as const
