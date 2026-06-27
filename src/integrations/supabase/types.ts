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
          id: string
          last_used_at: string | null
          pinned: boolean
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string
          confidence?: number
          content: string
          created_at?: string
          id?: string
          last_used_at?: string | null
          pinned?: boolean
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          confidence?: number
          content?: string
          created_at?: string
          id?: string
          last_used_at?: string | null
          pinned?: boolean
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          created_at: string
          daily_cap: number
          enabled: boolean
          quiet_end: string
          quiet_start: string
          shift_end_recovery: boolean
          shift_start: boolean
          timezone: string
          updated_at: string
          user_id: string
          wind_down: boolean
        }
        Insert: {
          bright_light?: boolean
          caffeine_cutoff?: boolean
          created_at?: string
          daily_cap?: number
          enabled?: boolean
          quiet_end?: string
          quiet_start?: string
          shift_end_recovery?: boolean
          shift_start?: boolean
          timezone?: string
          updated_at?: string
          user_id: string
          wind_down?: boolean
        }
        Update: {
          bright_light?: boolean
          caffeine_cutoff?: boolean
          created_at?: string
          daily_cap?: number
          enabled?: boolean
          quiet_end?: string
          quiet_start?: string
          shift_end_recovery?: boolean
          shift_start?: boolean
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
          id: string
          metadata: Json
          notes: string | null
          shift_type: string | null
          start_min: number
          title: string | null
          updated_at: string
          user_id: string
          week_index: number
        }
        Insert: {
          created_at?: string
          day: number
          employer_id?: string | null
          end_min: number
          id?: string
          metadata?: Json
          notes?: string | null
          shift_type?: string | null
          start_min: number
          title?: string | null
          updated_at?: string
          user_id: string
          week_index?: number
        }
        Update: {
          created_at?: string
          day?: number
          employer_id?: string | null
          end_min?: number
          id?: string
          metadata?: Json
          notes?: string | null
          shift_type?: string | null
          start_min?: number
          title?: string | null
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
      user_prefs: {
        Row: {
          ai_daily_token_cap: number
          assistant_mode: string
          assistant_name: string
          created_at: string
          cycle_anchor: string | null
          cycle_weeks: number
          lat: number
          location_label: string
          lon: number
          low_light: boolean
          memory_cutoff_at: string | null
          memory_enabled: boolean
          notifications: boolean
          onboarded_at: string | null
          partner_name: string
          sleep_hours: number
          updated_at: string
          user_id: string
          wind_down_min: number
        }
        Insert: {
          ai_daily_token_cap?: number
          assistant_mode?: string
          assistant_name?: string
          created_at?: string
          cycle_anchor?: string | null
          cycle_weeks?: number
          lat?: number
          location_label?: string
          lon?: number
          low_light?: boolean
          memory_cutoff_at?: string | null
          memory_enabled?: boolean
          notifications?: boolean
          onboarded_at?: string | null
          partner_name?: string
          sleep_hours?: number
          updated_at?: string
          user_id: string
          wind_down_min?: number
        }
        Update: {
          ai_daily_token_cap?: number
          assistant_mode?: string
          assistant_name?: string
          created_at?: string
          cycle_anchor?: string | null
          cycle_weeks?: number
          lat?: number
          location_label?: string
          lon?: number
          low_light?: boolean
          memory_cutoff_at?: string | null
          memory_enabled?: boolean
          notifications?: boolean
          onboarded_at?: string | null
          partner_name?: string
          sleep_hours?: number
          updated_at?: string
          user_id?: string
          wind_down_min?: number
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
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
