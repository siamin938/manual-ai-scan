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
      business_first_party_sources: {
        Row: {
          active: boolean
          business_id: string
          canonical_url: string | null
          created_at: string
          created_by: string | null
          id: string
          match_mode: string
          normalized_host: string | null
          org_id: string
          resource_key: string | null
          source_type: string
          updated_at: string
          verification_status: string
        }
        Insert: {
          active?: boolean
          business_id: string
          canonical_url?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          match_mode: string
          normalized_host?: string | null
          org_id: string
          resource_key?: string | null
          source_type: string
          updated_at?: string
          verification_status?: string
        }
        Update: {
          active?: boolean
          business_id?: string
          canonical_url?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          match_mode?: string
          normalized_host?: string | null
          org_id?: string
          resource_key?: string | null
          source_type?: string
          updated_at?: string
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_first_party_sources_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_first_party_sources_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          action_application_snapshot: Json | null
          action_type: string
          baseline_condition_snapshot: Json | null
          baseline_end_at: string | null
          baseline_run_id: string | null
          baseline_start_at: string | null
          baseline_value: number | null
          business_id: string
          changed_by: string | null
          confounders: string | null
          created_at: string
          created_by: string | null
          delta_value: number | null
          evaluated_at: string | null
          evaluated_by: string | null
          evaluation_snapshot: Json | null
          evaluation_version: string | null
          evidence_grade: string | null
          followup_condition_snapshot: Json | null
          followup_end_at: string | null
          followup_run_id: string | null
          followup_start_at: string | null
          followup_value: number | null
          hypothesis: string
          id: string
          interpretation: string | null
          intervention_at: string | null
          intervention_confirmed_at: string | null
          intervention_description: string | null
          intervention_evidence: Json | null
          name: string
          org_id: string
          primary_metric: string | null
          result_classification: string | null
          source_insight_action_id: string | null
          source_profile_coverage_item_id: string | null
          source_type: string
          status: Database["public"]["Enums"]["experiment_status"]
          updated_at: string
        }
        Insert: {
          action_application_snapshot?: Json | null
          action_type: string
          baseline_condition_snapshot?: Json | null
          baseline_end_at?: string | null
          baseline_run_id?: string | null
          baseline_start_at?: string | null
          baseline_value?: number | null
          business_id: string
          changed_by?: string | null
          confounders?: string | null
          created_at?: string
          created_by?: string | null
          delta_value?: number | null
          evaluated_at?: string | null
          evaluated_by?: string | null
          evaluation_snapshot?: Json | null
          evaluation_version?: string | null
          evidence_grade?: string | null
          followup_condition_snapshot?: Json | null
          followup_end_at?: string | null
          followup_run_id?: string | null
          followup_start_at?: string | null
          followup_value?: number | null
          hypothesis: string
          id?: string
          interpretation?: string | null
          intervention_at?: string | null
          intervention_confirmed_at?: string | null
          intervention_description?: string | null
          intervention_evidence?: Json | null
          name: string
          org_id: string
          primary_metric?: string | null
          result_classification?: string | null
          source_insight_action_id?: string | null
          source_profile_coverage_item_id?: string | null
          source_type?: string
          status?: Database["public"]["Enums"]["experiment_status"]
          updated_at?: string
        }
        Update: {
          action_application_snapshot?: Json | null
          action_type?: string
          baseline_condition_snapshot?: Json | null
          baseline_end_at?: string | null
          baseline_run_id?: string | null
          baseline_start_at?: string | null
          baseline_value?: number | null
          business_id?: string
          changed_by?: string | null
          confounders?: string | null
          created_at?: string
          created_by?: string | null
          delta_value?: number | null
          evaluated_at?: string | null
          evaluated_by?: string | null
          evaluation_snapshot?: Json | null
          evaluation_version?: string | null
          evidence_grade?: string | null
          followup_condition_snapshot?: Json | null
          followup_end_at?: string | null
          followup_run_id?: string | null
          followup_start_at?: string | null
          followup_value?: number | null
          hypothesis?: string
          id?: string
          interpretation?: string | null
          intervention_at?: string | null
          intervention_confirmed_at?: string | null
          intervention_description?: string | null
          intervention_evidence?: Json | null
          name?: string
          org_id?: string
          primary_metric?: string | null
          result_classification?: string | null
          source_insight_action_id?: string | null
          source_profile_coverage_item_id?: string | null
          source_type?: string
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
          {
            foreignKeyName: "experiments_source_insight_action_fkey"
            columns: ["source_insight_action_id", "org_id", "business_id"]
            isOneToOne: false
            referencedRelation: "insight_actions"
            referencedColumns: ["id", "org_id", "business_id"]
          },
          {
            foreignKeyName: "experiments_source_profile_coverage_item_fkey"
            columns: [
              "source_profile_coverage_item_id",
              "org_id",
              "business_id",
            ]
            isOneToOne: false
            referencedRelation: "profile_coverage_items"
            referencedColumns: ["id", "org_id", "business_id"]
          },
        ]
      }
      insight_actions: {
        Row: {
          action_key: string
          action_payload: Json
          action_type: string
          business_id: string
          confidence_score: number
          created_at: string
          engine_run_id: string
          evidence_grade: string
          id: string
          org_id: string
          primary_finding_id: string
          priority_score: number
          rationale: string
          recommendation_mode: string
          recommended_action: string
          source_finding_ids: string[]
          status: string
          title: string
          updated_at: string
          validation_plan: string
        }
        Insert: {
          action_key: string
          action_payload?: Json
          action_type: string
          business_id: string
          confidence_score: number
          created_at?: string
          engine_run_id: string
          evidence_grade: string
          id?: string
          org_id: string
          primary_finding_id: string
          priority_score: number
          rationale: string
          recommendation_mode: string
          recommended_action: string
          source_finding_ids?: string[]
          status?: string
          title: string
          updated_at?: string
          validation_plan: string
        }
        Update: {
          action_key?: string
          action_payload?: Json
          action_type?: string
          business_id?: string
          confidence_score?: number
          created_at?: string
          engine_run_id?: string
          evidence_grade?: string
          id?: string
          org_id?: string
          primary_finding_id?: string
          priority_score?: number
          rationale?: string
          recommendation_mode?: string
          recommended_action?: string
          source_finding_ids?: string[]
          status?: string
          title?: string
          updated_at?: string
          validation_plan?: string
        }
        Relationships: [
          {
            foreignKeyName: "insight_actions_engine_run_id_fkey"
            columns: ["engine_run_id"]
            isOneToOne: false
            referencedRelation: "insight_engine_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insight_actions_primary_finding_id_fkey"
            columns: ["primary_finding_id"]
            isOneToOne: false
            referencedRelation: "insight_findings"
            referencedColumns: ["id"]
          },
        ]
      }
      insight_engine_runs: {
        Row: {
          analysis_scope: Json
          business_id: string
          completed_at: string | null
          created_at: string
          eligible_measurement_count: number
          engine_version: string
          error_code: string | null
          error_message: string | null
          excluded_measurement_count: number
          experiment_id: string | null
          finding_count: number
          id: string
          input_fingerprint: string | null
          input_measurement_count: number
          org_id: string
          requested_by: string | null
          source_run_id: string | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          analysis_scope?: Json
          business_id: string
          completed_at?: string | null
          created_at?: string
          eligible_measurement_count?: number
          engine_version?: string
          error_code?: string | null
          error_message?: string | null
          excluded_measurement_count?: number
          experiment_id?: string | null
          finding_count?: number
          id?: string
          input_fingerprint?: string | null
          input_measurement_count?: number
          org_id: string
          requested_by?: string | null
          source_run_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          analysis_scope?: Json
          business_id?: string
          completed_at?: string | null
          created_at?: string
          eligible_measurement_count?: number
          engine_version?: string
          error_code?: string | null
          error_message?: string | null
          excluded_measurement_count?: number
          experiment_id?: string | null
          finding_count?: number
          id?: string
          input_fingerprint?: string | null
          input_measurement_count?: number
          org_id?: string
          requested_by?: string | null
          source_run_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "insight_engine_runs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insight_engine_runs_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiment_effects"
            referencedColumns: ["experiment_id"]
          },
          {
            foreignKeyName: "insight_engine_runs_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiment_effects_by_provider"
            referencedColumns: ["experiment_id"]
          },
          {
            foreignKeyName: "insight_engine_runs_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insight_engine_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insight_engine_runs_source_run_id_fkey"
            columns: ["source_run_id"]
            isOneToOne: false
            referencedRelation: "measurement_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      insight_findings: {
        Row: {
          baseline_value: number | null
          business_id: string
          causal_claim_allowed: boolean
          claim_type: string
          comparison_value: number | null
          competitor_business_id: string | null
          confidence_score: number
          created_at: string
          delta_value: number | null
          denominator: number | null
          engine_run_id: string
          evidence_grade: string
          evidence_payload: Json
          experiment_id: string | null
          finding_key: string
          finding_type: string
          id: string
          metric_name: string | null
          metric_value: number | null
          numerator: number | null
          org_id: string
          priority_score: number
          question_id: string | null
          sample_size: number
          summary: string
          title: string
        }
        Insert: {
          baseline_value?: number | null
          business_id: string
          causal_claim_allowed?: boolean
          claim_type?: string
          comparison_value?: number | null
          competitor_business_id?: string | null
          confidence_score?: number
          created_at?: string
          delta_value?: number | null
          denominator?: number | null
          engine_run_id: string
          evidence_grade?: string
          evidence_payload?: Json
          experiment_id?: string | null
          finding_key: string
          finding_type: string
          id?: string
          metric_name?: string | null
          metric_value?: number | null
          numerator?: number | null
          org_id: string
          priority_score?: number
          question_id?: string | null
          sample_size?: number
          summary?: string
          title: string
        }
        Update: {
          baseline_value?: number | null
          business_id?: string
          causal_claim_allowed?: boolean
          claim_type?: string
          comparison_value?: number | null
          competitor_business_id?: string | null
          confidence_score?: number
          created_at?: string
          delta_value?: number | null
          denominator?: number | null
          engine_run_id?: string
          evidence_grade?: string
          evidence_payload?: Json
          experiment_id?: string | null
          finding_key?: string
          finding_type?: string
          id?: string
          metric_name?: string | null
          metric_value?: number | null
          numerator?: number | null
          org_id?: string
          priority_score?: number
          question_id?: string | null
          sample_size?: number
          summary?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "insight_findings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insight_findings_competitor_business_id_fkey"
            columns: ["competitor_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insight_findings_engine_run_id_fkey"
            columns: ["engine_run_id"]
            isOneToOne: false
            referencedRelation: "insight_engine_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insight_findings_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiment_effects"
            referencedColumns: ["experiment_id"]
          },
          {
            foreignKeyName: "insight_findings_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiment_effects_by_provider"
            referencedColumns: ["experiment_id"]
          },
          {
            foreignKeyName: "insight_findings_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insight_findings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insight_findings_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
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
      measurement_citation_attributions: {
        Row: {
          attribution_level: string
          attribution_version: string
          business_id: string
          canonical_display_name: string
          canonical_key: string
          citation_end_index: number
          citation_start_index: number
          citation_url: string
          created_at: string
          domain: string | null
          entity_end_index: number | null
          entity_start_index: number | null
          evidence: Json
          id: string
          measurement_id: string
          measurement_mention_id: string | null
          org_id: string
          source_run_id: string
          title: string | null
        }
        Insert: {
          attribution_level: string
          attribution_version: string
          business_id: string
          canonical_display_name: string
          canonical_key: string
          citation_end_index: number
          citation_start_index: number
          citation_url: string
          created_at?: string
          domain?: string | null
          entity_end_index?: number | null
          entity_start_index?: number | null
          evidence?: Json
          id?: string
          measurement_id: string
          measurement_mention_id?: string | null
          org_id: string
          source_run_id: string
          title?: string | null
        }
        Update: {
          attribution_level?: string
          attribution_version?: string
          business_id?: string
          canonical_display_name?: string
          canonical_key?: string
          citation_end_index?: number
          citation_start_index?: number
          citation_url?: string
          created_at?: string
          domain?: string | null
          entity_end_index?: number | null
          entity_start_index?: number | null
          evidence?: Json
          id?: string
          measurement_id?: string
          measurement_mention_id?: string | null
          org_id?: string
          source_run_id?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "measurement_citation_attributions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_citation_attributions_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "measurements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_citation_attributions_measurement_mention_id_fkey"
            columns: ["measurement_mention_id"]
            isOneToOne: false
            referencedRelation: "measurement_mentions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_citation_attributions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_citation_attributions_source_run_id_fkey"
            columns: ["source_run_id"]
            isOneToOne: false
            referencedRelation: "measurement_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      measurement_citations: {
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
            foreignKeyName: "measurement_citations_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "measurements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_citations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      measurement_credit_accounts: {
        Row: {
          balance: number
          created_at: string
          lifetime_consumed: number
          lifetime_granted: number
          org_id: string
          updated_at: string
        }
        Insert: {
          balance?: number
          created_at?: string
          lifetime_consumed?: number
          lifetime_granted?: number
          org_id: string
          updated_at?: string
        }
        Update: {
          balance?: number
          created_at?: string
          lifetime_consumed?: number
          lifetime_granted?: number
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "measurement_credit_accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      measurement_credit_ledger: {
        Row: {
          actor_user_id: string | null
          amount: number
          balance_after: number
          created_at: string
          entry_type: string
          id: string
          note: string | null
          org_id: string
          reference_key: string | null
          run_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          amount: number
          balance_after: number
          created_at?: string
          entry_type: string
          id?: string
          note?: string | null
          org_id: string
          reference_key?: string | null
          run_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          amount?: number
          balance_after?: number
          created_at?: string
          entry_type?: string
          id?: string
          note?: string | null
          org_id?: string
          reference_key?: string | null
          run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "measurement_credit_ledger_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_credit_ledger_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "measurement_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      measurement_entity_canonicalizations: {
        Row: {
          business_id: string
          canonical_display_name: string
          canonical_key: string
          confidence: string
          created_at: string
          id: string
          measurement_id: string
          measurement_mention_id: string
          org_id: string
          reason_codes: string[]
          resolution_status: string
          resolver_version: string
          source_run_id: string
        }
        Insert: {
          business_id: string
          canonical_display_name: string
          canonical_key: string
          confidence: string
          created_at?: string
          id?: string
          measurement_id: string
          measurement_mention_id: string
          org_id: string
          reason_codes?: string[]
          resolution_status: string
          resolver_version: string
          source_run_id: string
        }
        Update: {
          business_id?: string
          canonical_display_name?: string
          canonical_key?: string
          confidence?: string
          created_at?: string
          id?: string
          measurement_id?: string
          measurement_mention_id?: string
          org_id?: string
          reason_codes?: string[]
          resolution_status?: string
          resolver_version?: string
          source_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "measurement_entity_canonicalization_measurement_mention_id_fkey"
            columns: ["measurement_mention_id"]
            isOneToOne: false
            referencedRelation: "measurement_mentions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_entity_canonicalizations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_entity_canonicalizations_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "measurements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_entity_canonicalizations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_entity_canonicalizations_source_run_id_fkey"
            columns: ["source_run_id"]
            isOneToOne: false
            referencedRelation: "measurement_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      measurement_entity_verifications: {
        Row: {
          business_id: string
          confidence: string
          created_at: string
          id: string
          measurement_id: string
          measurement_mention_id: string
          org_id: string
          reason_codes: string[]
          verification_status: string
          verified_count_as_business: boolean
          verified_entity_kind: string
          verifier_version: string
        }
        Insert: {
          business_id: string
          confidence: string
          created_at?: string
          id?: string
          measurement_id: string
          measurement_mention_id: string
          org_id: string
          reason_codes?: string[]
          verification_status: string
          verified_count_as_business?: boolean
          verified_entity_kind: string
          verifier_version: string
        }
        Update: {
          business_id?: string
          confidence?: string
          created_at?: string
          id?: string
          measurement_id?: string
          measurement_mention_id?: string
          org_id?: string
          reason_codes?: string[]
          verification_status?: string
          verified_count_as_business?: boolean
          verified_entity_kind?: string
          verifier_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "measurement_entity_verifications_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_entity_verifications_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "measurements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_entity_verifications_measurement_mention_id_fkey"
            columns: ["measurement_mention_id"]
            isOneToOne: false
            referencedRelation: "measurement_mentions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_entity_verifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      measurement_first_party_summaries: {
        Row: {
          business_id: string
          classifier_version: string
          client_first_party_cited: boolean
          created_at: string
          first_party_source_count: number
          id: string
          low_confidence_source_count: number
          measurement_id: string
          org_id: string
          source_count: number
          summarized_at: string
        }
        Insert: {
          business_id: string
          classifier_version: string
          client_first_party_cited?: boolean
          created_at?: string
          first_party_source_count?: number
          id?: string
          low_confidence_source_count?: number
          measurement_id: string
          org_id: string
          source_count?: number
          summarized_at?: string
        }
        Update: {
          business_id?: string
          classifier_version?: string
          client_first_party_cited?: boolean
          created_at?: string
          first_party_source_count?: number
          id?: string
          low_confidence_source_count?: number
          measurement_id?: string
          org_id?: string
          source_count?: number
          summarized_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "measurement_first_party_summaries_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_first_party_summaries_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "measurements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_first_party_summaries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          count_as_confirmed_business: boolean
          created_at: string
          display_name: string
          entity_kind: string | null
          explicit_rank: boolean
          id: string
          matched_alias: string | null
          matched_business_id: string | null
          measurement_id: string
          org_id: string
          position: number
          resolution_confidence: string | null
          resolution_evidence: Json
          specificity: string | null
        }
        Insert: {
          confidence?: Database["public"]["Enums"]["parse_confidence"]
          count_as_confirmed_business?: boolean
          created_at?: string
          display_name: string
          entity_kind?: string | null
          explicit_rank?: boolean
          id?: string
          matched_alias?: string | null
          matched_business_id?: string | null
          measurement_id: string
          org_id: string
          position: number
          resolution_confidence?: string | null
          resolution_evidence?: Json
          specificity?: string | null
        }
        Update: {
          confidence?: Database["public"]["Enums"]["parse_confidence"]
          count_as_confirmed_business?: boolean
          created_at?: string
          display_name?: string
          entity_kind?: string | null
          explicit_rank?: boolean
          id?: string
          matched_alias?: string | null
          matched_business_id?: string | null
          measurement_id?: string
          org_id?: string
          position?: number
          resolution_confidence?: string | null
          resolution_evidence?: Json
          specificity?: string | null
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
      measurement_source_classifications: {
        Row: {
          business_id: string
          classification: string
          classified_at: string
          classifier_version: string
          confidence: string
          created_at: string
          id: string
          match_method: string | null
          matched_first_party_source_id: string | null
          measurement_source_id: string
          org_id: string
          source_type: string | null
        }
        Insert: {
          business_id: string
          classification: string
          classified_at?: string
          classifier_version: string
          confidence?: string
          created_at?: string
          id?: string
          match_method?: string | null
          matched_first_party_source_id?: string | null
          measurement_source_id: string
          org_id: string
          source_type?: string | null
        }
        Update: {
          business_id?: string
          classification?: string
          classified_at?: string
          classifier_version?: string
          confidence?: string
          created_at?: string
          id?: string
          match_method?: string | null
          matched_first_party_source_id?: string | null
          measurement_source_id?: string
          org_id?: string
          source_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "measurement_source_classifica_matched_first_party_source_i_fkey"
            columns: ["matched_first_party_source_id"]
            isOneToOne: false
            referencedRelation: "business_first_party_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_source_classifications_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_source_classifications_measurement_source_id_fkey"
            columns: ["measurement_source_id"]
            isOneToOne: false
            referencedRelation: "measurement_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_source_classifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      profile_coverage_items: {
        Row: {
          average_position: number | null
          best_position: number | null
          business_id: string
          coverage_run_id: string
          coverage_status: string
          created_at: string
          domain_citation_rate: number
          domain_cited_count: number
          first_party_citation_rate: number
          first_party_cited_count: number
          first_party_classifier_version: string | null
          id: string
          manual_review_count: number
          measurement_count: number
          mention_rate: number
          mentioned_count: number
          metrics: Json
          org_id: string
          question_id: string
          top3_count: number
          top3_rate: number
        }
        Insert: {
          average_position?: number | null
          best_position?: number | null
          business_id: string
          coverage_run_id: string
          coverage_status: string
          created_at?: string
          domain_citation_rate?: number
          domain_cited_count?: number
          first_party_citation_rate?: number
          first_party_cited_count?: number
          first_party_classifier_version?: string | null
          id?: string
          manual_review_count?: number
          measurement_count?: number
          mention_rate?: number
          mentioned_count?: number
          metrics?: Json
          org_id: string
          question_id: string
          top3_count?: number
          top3_rate?: number
        }
        Update: {
          average_position?: number | null
          best_position?: number | null
          business_id?: string
          coverage_run_id?: string
          coverage_status?: string
          created_at?: string
          domain_citation_rate?: number
          domain_cited_count?: number
          first_party_citation_rate?: number
          first_party_cited_count?: number
          first_party_classifier_version?: string | null
          id?: string
          manual_review_count?: number
          measurement_count?: number
          mention_rate?: number
          mentioned_count?: number
          metrics?: Json
          org_id?: string
          question_id?: string
          top3_count?: number
          top3_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "profile_coverage_items_coverage_run_id_fkey"
            columns: ["coverage_run_id"]
            isOneToOne: false
            referencedRelation: "profile_coverage_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_coverage_runs: {
        Row: {
          analysis_scope: Json
          business_id: string
          client_domain_citation_rate: number | null
          client_first_party_citation_rate: number | null
          completed_at: string | null
          coverage_score: number | null
          covered_question_count: number
          created_at: string
          eligible_measurement_count: number
          engine_version: string
          evidence_grade: string | null
          excluded_measurement_count: number
          first_party_classifier_version: string | null
          id: string
          input_fingerprint: string
          input_measurement_count: number
          manual_review_count: number
          manual_review_rate: number | null
          measurement_coverage_rate: number | null
          missing_question_count: number
          org_id: string
          partial_question_count: number
          question_count: number
          question_coverage_rate: number | null
          repeat_stability_rate: number | null
          requested_by: string | null
          required_parser_version: string
          source_run_id: string
          started_at: string
          status: string
          top3_coverage_rate: number | null
          updated_at: string
        }
        Insert: {
          analysis_scope?: Json
          business_id: string
          client_domain_citation_rate?: number | null
          client_first_party_citation_rate?: number | null
          completed_at?: string | null
          coverage_score?: number | null
          covered_question_count?: number
          created_at?: string
          eligible_measurement_count?: number
          engine_version?: string
          evidence_grade?: string | null
          excluded_measurement_count?: number
          first_party_classifier_version?: string | null
          id?: string
          input_fingerprint: string
          input_measurement_count?: number
          manual_review_count?: number
          manual_review_rate?: number | null
          measurement_coverage_rate?: number | null
          missing_question_count?: number
          org_id: string
          partial_question_count?: number
          question_count?: number
          question_coverage_rate?: number | null
          repeat_stability_rate?: number | null
          requested_by?: string | null
          required_parser_version?: string
          source_run_id: string
          started_at?: string
          status?: string
          top3_coverage_rate?: number | null
          updated_at?: string
        }
        Update: {
          analysis_scope?: Json
          business_id?: string
          client_domain_citation_rate?: number | null
          client_first_party_citation_rate?: number | null
          completed_at?: string | null
          coverage_score?: number | null
          covered_question_count?: number
          created_at?: string
          eligible_measurement_count?: number
          engine_version?: string
          evidence_grade?: string | null
          excluded_measurement_count?: number
          first_party_classifier_version?: string | null
          id?: string
          input_fingerprint?: string
          input_measurement_count?: number
          manual_review_count?: number
          manual_review_rate?: number | null
          measurement_coverage_rate?: number | null
          missing_question_count?: number
          org_id?: string
          partial_question_count?: number
          question_count?: number
          question_coverage_rate?: number | null
          repeat_stability_rate?: number | null
          requested_by?: string | null
          required_parser_version?: string
          source_run_id?: string
          started_at?: string
          status?: string
          top3_coverage_rate?: number | null
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
      visibility_postprocess_tokens: {
        Row: {
          active: boolean
          created_at: string
          name: string
          token: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          name: string
          token: string
        }
        Update: {
          active?: boolean
          created_at?: string
          name?: string
          token?: string
        }
        Relationships: []
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
      measurement_citation_attributions_actionable_v1: {
        Row: {
          attribution_level: string | null
          attribution_version: string | null
          business_id: string | null
          canonical_display_name: string | null
          canonical_key: string | null
          citation_end_index: number | null
          citation_start_index: number | null
          citation_url: string | null
          created_at: string | null
          domain: string | null
          entity_end_index: number | null
          entity_start_index: number | null
          evidence: Json | null
          id: string | null
          measurement_id: string | null
          measurement_mention_id: string | null
          org_id: string | null
          source_run_id: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "measurement_citation_attributions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_citation_attributions_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "measurements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_citation_attributions_measurement_mention_id_fkey"
            columns: ["measurement_mention_id"]
            isOneToOne: false
            referencedRelation: "measurement_mentions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_citation_attributions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_citation_attributions_source_run_id_fkey"
            columns: ["source_run_id"]
            isOneToOne: false
            referencedRelation: "measurement_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      measurement_citation_attributions_actionable_v2: {
        Row: {
          attribution_level: string | null
          attribution_version: string | null
          business_id: string | null
          canonical_display_name: string | null
          canonical_key: string | null
          citation_end_index: number | null
          citation_start_index: number | null
          citation_url: string | null
          created_at: string | null
          domain: string | null
          entity_end_index: number | null
          entity_start_index: number | null
          evidence: Json | null
          id: string | null
          measurement_id: string | null
          measurement_mention_id: string | null
          org_id: string | null
          source_run_id: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "measurement_citation_attributions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_citation_attributions_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "measurements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_citation_attributions_measurement_mention_id_fkey"
            columns: ["measurement_mention_id"]
            isOneToOne: false
            referencedRelation: "measurement_mentions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_citation_attributions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_citation_attributions_source_run_id_fkey"
            columns: ["source_run_id"]
            isOneToOne: false
            referencedRelation: "measurement_runs"
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
      get_compatible_audit_runs_v01: {
        Args: { p_business_id: string; p_limit?: number; p_org_id: string }
        Returns: {
          completed_at: string
          created_at: string
          run_id: string
        }[]
      }
      get_competitor_significance_v01: {
        Args: { p_business_id: string; p_org_id: string; p_run_id: string }
        Returns: {
          canonical_key: string
          citation_response_count: number
          compatible_run_count: number
          compatible_run_presence_count: number
          direct_citation_response_count: number
          intent_count: number
          is_new: boolean
          mention_count: number
          name: string
          prior_run_presence_count: number
          question_count: number
          repeat_response_count: number
          response_count: number
          significance_score: number
          tier: string
          top3_response_count: number
        }[]
      }
      get_competitor_significance_v02: {
        Args: { p_business_id: string; p_org_id: string; p_run_id: string }
        Returns: {
          canonical_key: string
          citation_response_count: number
          compatible_run_count: number
          compatible_run_presence_count: number
          direct_citation_response_count: number
          intent_count: number
          is_new: boolean
          mention_count: number
          name: string
          prior_run_presence_count: number
          question_count: number
          repeat_response_count: number
          response_count: number
          significance_score: number
          tier: string
          top3_response_count: number
        }[]
      }
      get_global_high_visibility_source_patterns_v01: {
        Args: { p_business_id: string; p_requesting_org_id: string }
        Returns: Json
      }
      get_high_visibility_source_patterns_v01: {
        Args: { p_business_id: string; p_org_id: string }
        Returns: Json
      }
      get_org_usage: {
        Args: { p_org_id: string }
        Returns: {
          daily_requests: number
          monthly_actual_cost_usd: number
          monthly_reserved_cost_usd: number
        }[]
      }
      get_visibility_repeat_aggregate_v01: {
        Args: { p_business_id: string; p_org_id: string }
        Returns: Json
      }
      grant_measurement_credits_v01: {
        Args: {
          p_actor_user_id?: string
          p_amount: number
          p_note?: string
          p_org_id: string
          p_reference_key?: string
        }
        Returns: {
          balance_after: number
          idempotent: boolean
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
      parse_korean_business_location: {
        Args: { p_address: string }
        Returns: {
          city: string
          region: string
        }[]
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
