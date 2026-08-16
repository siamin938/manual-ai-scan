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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      business_competitors: {
        Row: {
          active: boolean
          competitor_business_id: string
          created_at: string
          org_id: string
          target_business_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          competitor_business_id: string
          created_at?: string
          org_id: string
          target_business_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          competitor_business_id?: string
          created_at?: string
          org_id?: string
          target_business_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_competitors_competitor_business_id_fkey"
            columns: ["competitor_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_competitors_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_competitors_target_business_id_fkey"
            columns: ["target_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          active: boolean
          address: string | null
          aliases: string[]
          category: string
          city: string | null
          country_code: string
          created_at: string
          google_maps_url: string | null
          id: string
          is_client_business: boolean
          metadata: Json
          name: string
          naver_place_url: string | null
          official_domains: string[]
          org_id: string
          region: string | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          aliases?: string[]
          category: string
          city?: string | null
          country_code?: string
          created_at?: string
          google_maps_url?: string | null
          id?: string
          is_client_business?: boolean
          metadata?: Json
          name: string
          naver_place_url?: string | null
          official_domains?: string[]
          org_id: string
          region?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          aliases?: string[]
          category?: string
          city?: string | null
          country_code?: string
          created_at?: string
          google_maps_url?: string | null
          id?: string
          is_client_business?: boolean
          metadata?: Json
          name?: string
          naver_place_url?: string | null
          official_domains?: string[]
          org_id?: string
          region?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "businesses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_events: {
        Row: {
          amount_usd: number
          created_at: string
          id: string
          input_tokens: number | null
          job_id: string | null
          metadata: Json
          model: string
          org_id: string
          output_tokens: number | null
          provider: Database["public"]["Enums"]["provider_name"]
          run_id: string | null
        }
        Insert: {
          amount_usd?: number
          created_at?: string
          id?: string
          input_tokens?: number | null
          job_id?: string | null
          metadata?: Json
          model: string
          org_id: string
          output_tokens?: number | null
          provider: Database["public"]["Enums"]["provider_name"]
          run_id?: string | null
        }
        Update: {
          amount_usd?: number
          created_at?: string
          id?: string
          input_tokens?: number | null
          job_id?: string | null
          metadata?: Json
          model?: string
          org_id?: string
          output_tokens?: number | null
          provider?: Database["public"]["Enums"]["provider_name"]
          run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "measurement_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "measurement_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      experiments: {
        Row: {
          action_type: string
          baseline_end_at: string | null
          baseline_run_id: string | null
          baseline_start_at: string | null
          business_id: string
          confounders: string | null
          created_at: string
          created_by: string | null
          followup_end_at: string | null
          followup_run_id: string | null
          followup_start_at: string | null
          hypothesis: string
          id: string
          interpretation: string | null
          intervention_at: string | null
          intervention_description: string | null
          name: string
          org_id: string
          status: Database["public"]["Enums"]["experiment_status"]
          updated_at: string
        }
        Insert: {
          action_type: string
          baseline_end_at?: string | null
          baseline_run_id?: string | null
          baseline_start_at?: string | null
          business_id: string
          confounders?: string | null
          created_at?: string
          created_by?: string | null
          followup_end_at?: string | null
          followup_run_id?: string | null
          followup_start_at?: string | null
          hypothesis: string
          id?: string
          interpretation?: string | null
          intervention_at?: string | null
          intervention_description?: string | null
          name: string
          org_id: string
          status?: Database["public"]["Enums"]["experiment_status"]
          updated_at?: string
        }
        Update: {
          action_type?: string
          baseline_end_at?: string | null
          baseline_run_id?: string | null
          baseline_start_at?: string | null
          business_id?: string
          confounders?: string | null
          created_at?: string
          created_by?: string | null
          followup_end_at?: string | null
          followup_run_id?: string | null
          followup_start_at?: string | null
          hypothesis?: string
          id?: string
          interpretation?: string | null
          intervention_at?: string | null
          intervention_description?: string | null
          name?: string
          org_id?: string
          status?: Database["public"]["Enums"]["experiment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "experiments_baseline_run_id_fkey"
            columns: ["baseline_run_id"]
            isOneToOne: false
            referencedRelation: "measurement_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experiments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experiments_followup_run_id_fkey"
            columns: ["followup_run_id"]
            isOneToOne: false
            referencedRelation: "measurement_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experiments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_ui_checks: {
        Row: {
          business_id: string
          client_position: number | null
          created_at: string
          created_by: string | null
          id: string
          logged_in: boolean
          notes: string | null
          observed_at: string
          org_id: string
          personalized: boolean
          platform: Database["public"]["Enums"]["manual_platform"]
          prompt_text: string
          question_id: string | null
          response_text: string
          screenshot_path: string | null
          updated_at: string
          was_client_mentioned: boolean
        }
        Insert: {
          business_id: string
          client_position?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          logged_in?: boolean
          notes?: string | null
          observed_at: string
          org_id: string
          personalized?: boolean
          platform: Database["public"]["Enums"]["manual_platform"]
          prompt_text: string
          question_id?: string | null
          response_text?: string
          screenshot_path?: string | null
          updated_at?: string
          was_client_mentioned?: boolean
        }
        Update: {
          business_id?: string
          client_position?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          logged_in?: boolean
          notes?: string | null
          observed_at?: string
          org_id?: string
          personalized?: boolean
          platform?: Database["public"]["Enums"]["manual_platform"]
          prompt_text?: string
          question_id?: string | null
          response_text?: string
          screenshot_path?: string | null
          updated_at?: string
          was_client_mentioned?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "manual_ui_checks_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_ui_checks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_ui_checks_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      measurement_jobs: {
        Row: {
          actual_cost_usd: number
          attempt_count: number
          completed_at: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          estimated_cost_usd: number
          id: string
          idempotency_key: string
          locked_at: string | null
          next_attempt_at: string
          org_id: string
          provider: Database["public"]["Enums"]["provider_name"]
          provider_model: string
          question_id: string
          repetition_no: number
          run_id: string
          scheduled_at: string
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
        }
        Insert: {
          actual_cost_usd?: number
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          estimated_cost_usd?: number
          id?: string
          idempotency_key: string
          locked_at?: string | null
          next_attempt_at?: string
          org_id: string
          provider: Database["public"]["Enums"]["provider_name"]
          provider_model: string
          question_id: string
          repetition_no: number
          run_id: string
          scheduled_at?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Update: {
          actual_cost_usd?: number
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          estimated_cost_usd?: number
          id?: string
          idempotency_key?: string
          locked_at?: string | null
          next_attempt_at?: string
          org_id?: string
          provider?: Database["public"]["Enums"]["provider_name"]
          provider_model?: string
          question_id?: string
          repetition_no?: number
          run_id?: string
          scheduled_at?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "measurement_jobs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_jobs_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_jobs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "measurement_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      measurement_mentions: {
        Row: {
          confidence: Database["public"]["Enums"]["parse_confidence"]
          created_at: string
          display_name: string
          explicit_rank: boolean
          id: string
          matched_alias: string | null
          matched_business_id: string | null
          measurement_id: string
          org_id: string
          position: number
        }
        Insert: {
          confidence?: Database["public"]["Enums"]["parse_confidence"]
          created_at?: string
          display_name: string
          explicit_rank?: boolean
          id?: string
          matched_alias?: string | null
          matched_business_id?: string | null
          measurement_id: string
          org_id: string
          position: number
        }
        Update: {
          confidence?: Database["public"]["Enums"]["parse_confidence"]
          created_at?: string
          display_name?: string
          explicit_rank?: boolean
          id?: string
          matched_alias?: string | null
          matched_business_id?: string | null
          measurement_id?: string
          org_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "measurement_mentions_matched_business_id_fkey"
            columns: ["matched_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_mentions_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "measurements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_mentions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      measurement_runs: {
        Row: {
          actual_cost_usd: number
          business_id: string
          completed_at: string | null
          completed_jobs: number
          created_at: string
          created_by: string | null
          estimated_cost_usd: number
          experiment_id: string | null
          failed_jobs: number
          id: string
          max_cost_usd: number
          name: string
          org_id: string
          phase: Database["public"]["Enums"]["run_phase"]
          question_set_id: string
          repetitions: number
          run_type: Database["public"]["Enums"]["run_type"]
          scheduled_at: string
          selected_providers: Database["public"]["Enums"]["provider_name"][]
          started_at: string | null
          status: Database["public"]["Enums"]["run_status"]
          total_jobs: number
          updated_at: string
        }
        Insert: {
          actual_cost_usd?: number
          business_id: string
          completed_at?: string | null
          completed_jobs?: number
          created_at?: string
          created_by?: string | null
          estimated_cost_usd?: number
          experiment_id?: string | null
          failed_jobs?: number
          id?: string
          max_cost_usd?: number
          name: string
          org_id: string
          phase?: Database["public"]["Enums"]["run_phase"]
          question_set_id: string
          repetitions?: number
          run_type?: Database["public"]["Enums"]["run_type"]
          scheduled_at?: string
          selected_providers?: Database["public"]["Enums"]["provider_name"][]
          started_at?: string | null
          status?: Database["public"]["Enums"]["run_status"]
          total_jobs?: number
          updated_at?: string
        }
        Update: {
          actual_cost_usd?: number
          business_id?: string
          completed_at?: string | null
          completed_jobs?: number
          created_at?: string
          created_by?: string | null
          estimated_cost_usd?: number
          experiment_id?: string | null
          failed_jobs?: number
          id?: string
          max_cost_usd?: number
          name?: string
          org_id?: string
          phase?: Database["public"]["Enums"]["run_phase"]
          question_set_id?: string
          repetitions?: number
          run_type?: Database["public"]["Enums"]["run_type"]
          scheduled_at?: string
          selected_providers?: Database["public"]["Enums"]["provider_name"][]
          started_at?: string | null
          status?: Database["public"]["Enums"]["run_status"]
          total_jobs?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "measurement_runs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_runs_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiment_effects"
            referencedColumns: ["experiment_id"]
          },
          {
            foreignKeyName: "measurement_runs_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiment_effects_by_provider"
            referencedColumns: ["experiment_id"]
          },
          {
            foreignKeyName: "measurement_runs_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_runs_question_set_id_fkey"
            columns: ["question_set_id"]
            isOneToOne: false
            referencedRelation: "question_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      measurement_sources: {
        Row: {
          created_at: string
          domain: string | null
          id: string
          measurement_id: string
          org_id: string
          title: string | null
          url: string
        }
        Insert: {
          created_at?: string
          domain?: string | null
          id?: string
          measurement_id: string
          org_id: string
          title?: string | null
          url: string
        }
        Update: {
          created_at?: string
          domain?: string | null
          id?: string
          measurement_id?: string
          org_id?: string
          title?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "measurement_sources_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "measurements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_sources_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      measurements: {
        Row: {
          actual_cost_usd: number
          answer_fingerprint: string | null
          client_domain_cited: boolean
          client_position: number | null
          created_at: string
          id: string
          input_tokens: number | null
          invalid_reason: string | null
          job_id: string
          manual_review_required: boolean
          observed_at: string
          org_id: string
          output_tokens: number | null
          parse_confidence: Database["public"]["Enums"]["parse_confidence"]
          parser_version: string
          provider: Database["public"]["Enums"]["provider_name"]
          provider_model: string
          provider_request_id: string | null
          question_id: string
          response_text: string
          run_id: string
          valid: boolean
          was_client_mentioned: boolean
        }
        Insert: {
          actual_cost_usd?: number
          answer_fingerprint?: string | null
          client_domain_cited?: boolean
          client_position?: number | null
          created_at?: string
          id?: string
          input_tokens?: number | null
          invalid_reason?: string | null
          job_id: string
          manual_review_required?: boolean
          observed_at?: string
          org_id: string
          output_tokens?: number | null
          parse_confidence?: Database["public"]["Enums"]["parse_confidence"]
          parser_version: string
          provider: Database["public"]["Enums"]["provider_name"]
          provider_model: string
          provider_request_id?: string | null
          question_id: string
          response_text?: string
          run_id: string
          valid?: boolean
          was_client_mentioned?: boolean
        }
        Update: {
          actual_cost_usd?: number
          answer_fingerprint?: string | null
          client_domain_cited?: boolean
          client_position?: number | null
          created_at?: string
          id?: string
          input_tokens?: number | null
          invalid_reason?: string | null
          job_id?: string
          manual_review_required?: boolean
          observed_at?: string
          org_id?: string
          output_tokens?: number | null
          parse_confidence?: Database["public"]["Enums"]["parse_confidence"]
          parser_version?: string
          provider?: Database["public"]["Enums"]["provider_name"]
          provider_model?: string
          provider_request_id?: string | null
          question_id?: string
          response_text?: string
          run_id?: string
          valid?: boolean
          was_client_mentioned?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "measurements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "measurement_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurements_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurements_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "measurement_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          org_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          daily_request_limit: number
          id: string
          monthly_budget_usd: number
          name: string
          plan: string
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          daily_request_limit?: number
          id?: string
          monthly_budget_usd?: number
          name: string
          plan?: string
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          daily_request_limit?: number
          id?: string
          monthly_budget_usd?: number
          name?: string
          plan?: string
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      provider_payloads: {
        Row: {
          created_at: string
          expires_at: string
          job_id: string
          org_id: string
          request_payload_redacted: Json
          response_payload: Json
        }
        Insert: {
          created_at?: string
          expires_at: string
          job_id: string
          org_id: string
          request_payload_redacted: Json
          response_payload: Json
        }
        Update: {
          created_at?: string
          expires_at?: string
          job_id?: string
          org_id?: string
          request_payload_redacted?: Json
          response_payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "provider_payloads_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "measurement_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_payloads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_settings: {
        Row: {
          approval_reference: string | null
          automated_benchmark_approved: boolean
          config: Json
          created_at: string
          enabled: boolean
          estimated_cost_per_request_usd: number
          model_name: string
          org_id: string
          paid_account_confirmed: boolean
          provider: Database["public"]["Enums"]["provider_name"]
          search_context_size: string
          terms_reviewed: boolean
          terms_reviewed_at: string | null
          terms_reviewed_by: string | null
          terms_version: string | null
          updated_at: string
        }
        Insert: {
          approval_reference?: string | null
          automated_benchmark_approved?: boolean
          config?: Json
          created_at?: string
          enabled?: boolean
          estimated_cost_per_request_usd?: number
          model_name: string
          org_id: string
          paid_account_confirmed?: boolean
          provider: Database["public"]["Enums"]["provider_name"]
          search_context_size?: string
          terms_reviewed?: boolean
          terms_reviewed_at?: string | null
          terms_reviewed_by?: string | null
          terms_version?: string | null
          updated_at?: string
        }
        Update: {
          approval_reference?: string | null
          automated_benchmark_approved?: boolean
          config?: Json
          created_at?: string
          enabled?: boolean
          estimated_cost_per_request_usd?: number
          model_name?: string
          org_id?: string
          paid_account_confirmed?: boolean
          provider?: Database["public"]["Enums"]["provider_name"]
          search_context_size?: string
          terms_reviewed?: boolean
          terms_reviewed_at?: string | null
          terms_reviewed_by?: string | null
          terms_version?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      question_sets: {
        Row: {
          active: boolean
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          org_id: string
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          org_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          business_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          org_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "question_sets_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_sets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      questions: {
        Row: {
          active: boolean
          city: string | null
          country_code: string
          created_at: string
          data_class: Database["public"]["Enums"]["data_class"]
          id: string
          intent_type: string
          language: string
          org_id: string
          prompt_hash: string | null
          prompt_text: string
          question_set_id: string
          region: string | null
          updated_at: string
          weight: number
        }
        Insert: {
          active?: boolean
          city?: string | null
          country_code?: string
          created_at?: string
          data_class?: Database["public"]["Enums"]["data_class"]
          id?: string
          intent_type?: string
          language?: string
          org_id: string
          prompt_hash?: string | null
          prompt_text: string
          question_set_id: string
          region?: string | null
          updated_at?: string
          weight?: number
        }
        Update: {
          active?: boolean
          city?: string | null
          country_code?: string
          created_at?: string
          data_class?: Database["public"]["Enums"]["data_class"]
          id?: string
          intent_type?: string
          language?: string
          org_id?: string
          prompt_hash?: string | null
          prompt_text?: string
          question_set_id?: string
          region?: string | null
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "questions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_question_set_id_fkey"
            columns: ["question_set_id"]
            isOneToOne: false
            referencedRelation: "question_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendations: {
        Row: {
          action_type: string
          business_id: string
          created_at: string
          created_by: string | null
          effort_level: string
          evidence_experiments: number
          expected_days: number | null
          experiment_id: string | null
          id: string
          org_id: string
          priority_score: number
          rationale: string
          status: Database["public"]["Enums"]["recommendation_status"]
          title: string
          updated_at: string
        }
        Insert: {
          action_type: string
          business_id: string
          created_at?: string
          created_by?: string | null
          effort_level?: string
          evidence_experiments?: number
          expected_days?: number | null
          experiment_id?: string | null
          id?: string
          org_id: string
          priority_score?: number
          rationale: string
          status?: Database["public"]["Enums"]["recommendation_status"]
          title: string
          updated_at?: string
        }
        Update: {
          action_type?: string
          business_id?: string
          created_at?: string
          created_by?: string | null
          effort_level?: string
          evidence_experiments?: number
          expected_days?: number | null
          experiment_id?: string | null
          id?: string
          org_id?: string
          priority_score?: number
          rationale?: string
          status?: Database["public"]["Enums"]["recommendation_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recommendations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendations_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiment_effects"
            referencedColumns: ["experiment_id"]
          },
          {
            foreignKeyName: "recommendations_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiment_effects_by_provider"
            referencedColumns: ["experiment_id"]
          },
          {
            foreignKeyName: "recommendations_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      system_events: {
        Row: {
          created_at: string
          created_by: string | null
          event_type: string
          id: string
          message: string
          metadata: Json
          org_id: string
          run_id: string | null
          severity: Database["public"]["Enums"]["event_severity"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_type: string
          id?: string
          message: string
          metadata?: Json
          org_id: string
          run_id?: string | null
          severity?: Database["public"]["Enums"]["event_severity"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_type?: string
          id?: string
          message?: string
          metadata?: Json
          org_id?: string
          run_id?: string | null
          severity?: Database["public"]["Enums"]["event_severity"]
        }
        Relationships: [
          {
            foreignKeyName: "system_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "measurement_runs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      experiment_effects: {
        Row: {
          action_type: string | null
          baseline_inclusion_rate_pct: number | null
          baseline_n: number | null
          baseline_run_id: string | null
          baseline_top3_rate_pct: number | null
          business_id: string | null
          experiment_id: string | null
          followup_inclusion_rate_pct: number | null
          followup_n: number | null
          followup_run_id: string | null
          followup_top3_rate_pct: number | null
          inclusion_change_pp: number | null
          name: string | null
          org_id: string | null
          top3_change_pp: number | null
        }
        Relationships: [
          {
            foreignKeyName: "experiments_baseline_run_id_fkey"
            columns: ["baseline_run_id"]
            isOneToOne: false
            referencedRelation: "measurement_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experiments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experiments_followup_run_id_fkey"
            columns: ["followup_run_id"]
            isOneToOne: false
            referencedRelation: "measurement_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experiments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      experiment_effects_by_provider: {
        Row: {
          baseline_inclusion_rate_pct: number | null
          baseline_n: number | null
          baseline_top3_rate_pct: number | null
          business_id: string | null
          experiment_id: string | null
          followup_inclusion_rate_pct: number | null
          followup_n: number | null
          followup_top3_rate_pct: number | null
          inclusion_change_pp: number | null
          org_id: string | null
          provider: Database["public"]["Enums"]["provider_name"] | null
          top3_change_pp: number | null
        }
        Relationships: [
          {
            foreignKeyName: "experiments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experiments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      question_metrics: {
        Row: {
          best_position: number | null
          inclusion_rate_pct: number | null
          intent_type: string | null
          mention_n: number | null
          org_id: string | null
          prompt_text: string | null
          provider: Database["public"]["Enums"]["provider_name"] | null
          question_id: string | null
          run_id: string | null
          valid_n: number | null
        }
        Relationships: [
          {
            foreignKeyName: "measurements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurements_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurements_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "measurement_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      run_business_share: {
        Row: {
          answer_share_pct: number | null
          display_name: string | null
          matched_business_id: string | null
          mention_count: number | null
          org_id: string | null
          provider: Database["public"]["Enums"]["provider_name"] | null
          response_count: number | null
          run_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "measurement_mentions_matched_business_id_fkey"
            columns: ["matched_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurements_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "measurement_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      run_metrics: {
        Row: {
          domain_citation_rate_pct: number | null
          domain_cited_n: number | null
          first_mention_n: number | null
          first_mention_rate_pct: number | null
          inclusion_rate_pct: number | null
          invalid_n: number | null
          mention_n: number | null
          org_id: string | null
          provider: Database["public"]["Enums"]["provider_name"] | null
          run_id: string | null
          top3_n: number | null
          top3_rate_pct: number | null
          valid_n: number | null
        }
        Relationships: [
          {
            foreignKeyName: "measurements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurements_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "measurement_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      run_metrics_overall: {
        Row: {
          first_mention_n: number | null
          first_mention_rate_pct: number | null
          inclusion_rate_pct: number | null
          invalid_n: number | null
          mention_n: number | null
          org_id: string | null
          run_id: string | null
          top3_n: number | null
          top3_rate_pct: number | null
          valid_n: number | null
        }
        Relationships: [
          {
            foreignKeyName: "measurements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurements_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "measurement_runs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      claim_measurement_jobs: {
        Args: { p_limit?: number }
        Returns: {
          actual_cost_usd: number
          attempt_count: number
          completed_at: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          estimated_cost_usd: number
          id: string
          idempotency_key: string
          locked_at: string | null
          next_attempt_at: string
          org_id: string
          provider: Database["public"]["Enums"]["provider_name"]
          provider_model: string
          question_id: string
          repetition_no: number
          run_id: string
          scheduled_at: string
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "measurement_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_organization_with_owner: {
        Args: { p_name: string; p_slug: string }
        Returns: string
      }
      get_org_usage: {
        Args: { p_org_id: string }
        Returns: {
          daily_requests: number
          monthly_actual_cost_usd: number
          monthly_reserved_cost_usd: number
        }[]
      }
      has_org_role: {
        Args: {
          allowed_roles: Database["public"]["Enums"]["app_role"][]
          target_org: string
        }
        Returns: boolean
      }
      is_org_member: { Args: { target_org: string }; Returns: boolean }
      purge_expired_provider_payloads: { Args: never; Returns: number }
      refresh_run_progress: {
        Args: { p_run_id: string }
        Returns: Database["public"]["Enums"]["run_status"]
      }
      seed_automotive_question_set: {
        Args: {
          p_brand: string
          p_business_id: string
          p_city: string
          p_name?: string
          p_org_id: string
          p_region: string
          p_service: string
        }
        Returns: string
      }
      storage_object_org_id: { Args: { object_name: string }; Returns: string }
    }
    Enums: {
      app_role: "owner" | "admin" | "analyst" | "client_viewer"
      data_class: "public" | "restricted" | "confidential"
      event_severity: "info" | "warning" | "error" | "critical"
      experiment_status:
        | "draft"
        | "baseline"
        | "action_applied"
        | "followup"
        | "completed"
        | "cancelled"
      job_status: "queued" | "processing" | "completed" | "failed" | "cancelled"
      manual_platform: "chatgpt_ui" | "gemini_app" | "perplexity_web"
      parse_confidence: "low" | "medium" | "high"
      provider_name: "openai" | "gemini" | "perplexity"
      recommendation_status:
        | "draft"
        | "approved"
        | "doing"
        | "done"
        | "rejected"
      run_phase: "standalone" | "baseline" | "followup" | "control"
      run_status:
        | "draft"
        | "queued"
        | "running"
        | "completed"
        | "partial"
        | "failed"
        | "cancelled"
      run_type: "audit" | "experiment"
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
      app_role: ["owner", "admin", "analyst", "client_viewer"],
      data_class: ["public", "restricted", "confidential"],
      event_severity: ["info", "warning", "error", "critical"],
      experiment_status: [
        "draft",
        "baseline",
        "action_applied",
        "followup",
        "completed",
        "cancelled",
      ],
      job_status: ["queued", "processing", "completed", "failed", "cancelled"],
      manual_platform: ["chatgpt_ui", "gemini_app", "perplexity_web"],
      parse_confidence: ["low", "medium", "high"],
      provider_name: ["openai", "gemini", "perplexity"],
      recommendation_status: ["draft", "approved", "doing", "done", "rejected"],
      run_phase: ["standalone", "baseline", "followup", "control"],
      run_status: [
        "draft",
        "queued",
        "running",
        "completed",
        "partial",
        "failed",
        "cancelled",
      ],
      run_type: ["audit", "experiment"],
    },
  },
} as const
