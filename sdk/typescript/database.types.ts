/**
 * TxScore Database Types
 * 
 * Auto-generated TypeScript types for TxScore Supabase schema
 * 
 * To regenerate: npx supabase gen types typescript --local > database.types.ts
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      tx_genes_master: {
        Row: {
          gene_id: string
          gene_symbol: string
          uniprot_id: string | null
          gene_name: string | null
          chromosome: string | null
          start_position: number | null
          end_position: number | null
          strand: string | null
          aliases: Json | null
          gene_type: string | null
          gene_biotype: string | null
          description: string | null
          protein_length: number | null
          protein_class: string | null
          protein_family: string | null
          source: string | null
          version: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          gene_id: string
          gene_symbol: string
          uniprot_id?: string | null
          gene_name?: string | null
          chromosome?: string | null
          start_position?: number | null
          end_position?: number | null
          strand?: string | null
          aliases?: Json | null
          gene_type?: string | null
          gene_biotype?: string | null
          description?: string | null
          protein_length?: number | null
          protein_class?: string | null
          protein_family?: string | null
          source?: string | null
          version?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          gene_id?: string
          gene_symbol?: string
          uniprot_id?: string | null
          gene_name?: string | null
          chromosome?: string | null
          start_position?: number | null
          end_position?: number | null
          strand?: string | null
          aliases?: Json | null
          gene_type?: string | null
          gene_biotype?: string | null
          description?: string | null
          protein_length?: number | null
          protein_class?: string | null
          protein_family?: string | null
          source?: string | null
          version?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      tx_depmap_data: {
        Row: {
          id: number
          gene_id: string
          cell_line_id: string
          chronos_effect: number
          dependency_probability: number | null
          cancer_type: string | null
          tissue_origin: string | null
          lineage: string | null
          primary_disease: string | null
          subtype: string | null
          mutation_profile: Json | null
          expression_cluster: string | null
          msi_status: string | null
          depmap_release: string
          screen_type: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          gene_id: string
          cell_line_id: string
          chronos_effect: number
          dependency_probability?: number | null
          cancer_type?: string | null
          tissue_origin?: string | null
          lineage?: string | null
          primary_disease?: string | null
          subtype?: string | null
          mutation_profile?: Json | null
          expression_cluster?: string | null
          msi_status?: string | null
          depmap_release: string
          screen_type?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          gene_id?: string
          cell_line_id?: string
          chronos_effect?: number
          dependency_probability?: number | null
          cancer_type?: string | null
          tissue_origin?: string | null
          lineage?: string | null
          primary_disease?: string | null
          subtype?: string | null
          mutation_profile?: Json | null
          expression_cluster?: string | null
          msi_status?: string | null
          depmap_release?: string
          screen_type?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "depmap_data_gene_id_fkey"
            columns: ["gene_id"]
            referencedRelation: "tx_genes_master"
            referencedColumns: ["gene_id"]
          }
        ]
      }
      tx_gtex_expression: {
        Row: {
          id: number
          gene_id: string
          tissue_name: string
          median_tpm: number
          mean_tpm: number | null
          std_tpm: number | null
          samples_count: number
          max_tpm: number | null
          percentile_25: number | null
          percentile_75: number | null
          tissue_category: string | null
          tissue_detail: string | null
          gtex_version: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          gene_id: string
          tissue_name: string
          median_tpm: number
          mean_tpm?: number | null
          std_tpm?: number | null
          samples_count: number
          max_tpm?: number | null
          percentile_25?: number | null
          percentile_75?: number | null
          tissue_category?: string | null
          tissue_detail?: string | null
          gtex_version?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          gene_id?: string
          tissue_name?: string
          median_tpm?: number
          mean_tpm?: number | null
          std_tpm?: number | null
          samples_count?: number
          max_tpm?: number | null
          percentile_25?: number | null
          percentile_75?: number | null
          tissue_category?: string | null
          tissue_detail?: string | null
          gtex_version?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gtex_expression_gene_id_fkey"
            columns: ["gene_id"]
            referencedRelation: "tx_genes_master"
            referencedColumns: ["gene_id"]
          }
        ]
      }
      tx_gnomad_constraint: {
        Row: {
          gene_id: string
          loeuf: number | null
          loeuf_lower: number | null
          loeuf_upper: number | null
          pli: number | null
          mis_z: number | null
          oe_mis: number | null
          oe_mis_lower: number | null
          oe_mis_upper: number | null
          syn_z: number | null
          oe_syn: number | null
          oe_syn_lower: number | null
          oe_syn_upper: number | null
          oe_lof: number | null
          oe_lof_lower: number | null
          oe_lof_upper: number | null
          obs_lof: number | null
          exp_lof: number | null
          obs_mis: number | null
          exp_mis: number | null
          obs_syn: number | null
          exp_syn: number | null
          lof_flags: Json | null
          constraint_flags: Json | null
          gnomad_version: string
          created_at: string
          updated_at: string
        }
        Insert: {
          gene_id: string
          loeuf?: number | null
          loeuf_lower?: number | null
          loeuf_upper?: number | null
          pli?: number | null
          mis_z?: number | null
          oe_mis?: number | null
          oe_mis_lower?: number | null
          oe_mis_upper?: number | null
          syn_z?: number | null
          oe_syn?: number | null
          oe_syn_lower?: number | null
          oe_syn_upper?: number | null
          oe_lof?: number | null
          oe_lof_lower?: number | null
          oe_lof_upper?: number | null
          obs_lof?: number | null
          exp_lof?: number | null
          obs_mis?: number | null
          exp_mis?: number | null
          obs_syn?: number | null
          exp_syn?: number | null
          lof_flags?: Json | null
          constraint_flags?: Json | null
          gnomad_version?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          gene_id?: string
          loeuf?: number | null
          loeuf_lower?: number | null
          loeuf_upper?: number | null
          pli?: number | null
          mis_z?: number | null
          oe_mis?: number | null
          oe_mis_lower?: number | null
          oe_mis_upper?: number | null
          syn_z?: number | null
          oe_syn?: number | null
          oe_syn_lower?: number | null
          oe_syn_upper?: number | null
          oe_lof?: number | null
          oe_lof_lower?: number | null
          oe_lof_upper?: number | null
          obs_lof?: number | null
          exp_lof?: number | null
          obs_mis?: number | null
          exp_mis?: number | null
          obs_syn?: number | null
          exp_syn?: number | null
          lof_flags?: Json | null
          constraint_flags?: Json | null
          gnomad_version?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gnomad_constraint_gene_id_fkey"
            columns: ["gene_id"]
            referencedRelation: "tx_genes_master"
            referencedColumns: ["gene_id"]
          }
        ]
      }
      tx_alphafold_structures: {
        Row: {
          id: number
          gene_id: string
          uniprot_id: string
          mean_plddt: number
          max_plddt: number | null
          min_plddt: number | null
          plddt_high_confidence_frac: number | null
          plddt_confident_frac: number | null
          plddt_low_confidence_frac: number | null
          structure_url: string | null
          pae_url: string | null
          pockets: Json | null
          num_druggable_pockets: number | null
          domains: Json | null
          active_sites: Json | null
          binding_sites: Json | null
          disordered_regions: Json | null
          disorder_fraction: number | null
          alphafold_version: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          gene_id: string
          uniprot_id: string
          mean_plddt: number
          max_plddt?: number | null
          min_plddt?: number | null
          plddt_high_confidence_frac?: number | null
          plddt_confident_frac?: number | null
          plddt_low_confidence_frac?: number | null
          structure_url?: string | null
          pae_url?: string | null
          pockets?: Json | null
          num_druggable_pockets?: number | null
          domains?: Json | null
          active_sites?: Json | null
          binding_sites?: Json | null
          disordered_regions?: Json | null
          disorder_fraction?: number | null
          alphafold_version?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          gene_id?: string
          uniprot_id?: string
          mean_plddt?: number
          max_plddt?: number | null
          min_plddt?: number | null
          plddt_high_confidence_frac?: number | null
          plddt_confident_frac?: number | null
          plddt_low_confidence_frac?: number | null
          structure_url?: string | null
          pae_url?: string | null
          pockets?: Json | null
          num_druggable_pockets?: number | null
          domains?: Json | null
          active_sites?: Json | null
          binding_sites?: Json | null
          disordered_regions?: Json | null
          disorder_fraction?: number | null
          alphafold_version?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "alphafold_structures_gene_id_fkey"
            columns: ["gene_id"]
            referencedRelation: "tx_genes_master"
            referencedColumns: ["gene_id"]
          }
        ]
      }
      tx_clinvar_variants: {
        Row: {
          variant_id: string
          gene_id: string
          clinical_significance: string
          review_status: string | null
          variant_type: string | null
          molecular_consequence: string | null
          chromosome: string
          position: number
          ref_allele: string | null
          alt_allele: string | null
          hgvs_c: string | null
          hgvs_p: string | null
          conditions: string[] | null
          phenotype_ids: string[] | null
          gnomad_af: number | null
          submitter_count: number | null
          last_evaluated: string | null
          clinvar_version: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          variant_id: string
          gene_id: string
          clinical_significance: string
          review_status?: string | null
          variant_type?: string | null
          molecular_consequence?: string | null
          chromosome: string
          position: number
          ref_allele?: string | null
          alt_allele?: string | null
          hgvs_c?: string | null
          hgvs_p?: string | null
          conditions?: string[] | null
          phenotype_ids?: string[] | null
          gnomad_af?: number | null
          submitter_count?: number | null
          last_evaluated?: string | null
          clinvar_version?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          variant_id?: string
          gene_id?: string
          clinical_significance?: string
          review_status?: string | null
          variant_type?: string | null
          molecular_consequence?: string | null
          chromosome?: string
          position?: number
          ref_allele?: string | null
          alt_allele?: string | null
          hgvs_c?: string | null
          hgvs_p?: string | null
          conditions?: string[] | null
          phenotype_ids?: string[] | null
          gnomad_af?: number | null
          submitter_count?: number | null
          last_evaluated?: string | null
          clinvar_version?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinvar_variants_gene_id_fkey"
            columns: ["gene_id"]
            referencedRelation: "tx_genes_master"
            referencedColumns: ["gene_id"]
          }
        ]
      }
      tx_drug_interactions: {
        Row: {
          interaction_id: number
          gene_id: string
          drug_name: string
          drug_chembl_id: string | null
          drug_drugbank_id: string | null
          interaction_type: string | null
          interaction_claim_source: string | null
          approval_status: string | null
          clinical_trial_phase: string | null
          mechanism_of_action: string | null
          target_type: string | null
          source: string
          source_db_version: string | null
          pmids: string[] | null
          created_at: string
          updated_at: string
        }
        Insert: {
          interaction_id?: number
          gene_id: string
          drug_name: string
          drug_chembl_id?: string | null
          drug_drugbank_id?: string | null
          interaction_type?: string | null
          interaction_claim_source?: string | null
          approval_status?: string | null
          clinical_trial_phase?: string | null
          mechanism_of_action?: string | null
          target_type?: string | null
          source: string
          source_db_version?: string | null
          pmids?: string[] | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          interaction_id?: number
          gene_id?: string
          drug_name?: string
          drug_chembl_id?: string | null
          drug_drugbank_id?: string | null
          interaction_type?: string | null
          interaction_claim_source?: string | null
          approval_status?: string | null
          clinical_trial_phase?: string | null
          mechanism_of_action?: string | null
          target_type?: string | null
          source?: string
          source_db_version?: string | null
          pmids?: string[] | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "drug_interactions_gene_id_fkey"
            columns: ["gene_id"]
            referencedRelation: "tx_genes_master"
            referencedColumns: ["gene_id"]
          }
        ]
      }
      tx_clinical_trials: {
        Row: {
          nct_id: string
          gene_id: string
          title: string
          brief_summary: string | null
          detailed_description: string | null
          phase: string | null
          status: string
          start_date: string | null
          primary_completion_date: string | null
          completion_date: string | null
          last_update_posted: string | null
          enrollment: number | null
          enrollment_type: string | null
          conditions: string[] | null
          interventions: Json | null
          study_type: string | null
          allocation: string | null
          intervention_model: string | null
          primary_purpose: string | null
          masking: string | null
          primary_outcomes: Json | null
          secondary_outcomes: Json | null
          lead_sponsor: string | null
          sponsor_type: string | null
          collaborators: string[] | null
          countries: string[] | null
          locations: Json | null
          arms: Json | null
          has_results: boolean | null
          results_first_posted: string | null
          source_register: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          nct_id: string
          gene_id: string
          title: string
          brief_summary?: string | null
          detailed_description?: string | null
          phase?: string | null
          status: string
          start_date?: string | null
          primary_completion_date?: string | null
          completion_date?: string | null
          last_update_posted?: string | null
          enrollment?: number | null
          enrollment_type?: string | null
          conditions?: string[] | null
          interventions?: Json | null
          study_type?: string | null
          allocation?: string | null
          intervention_model?: string | null
          primary_purpose?: string | null
          masking?: string | null
          primary_outcomes?: Json | null
          secondary_outcomes?: Json | null
          lead_sponsor?: string | null
          sponsor_type?: string | null
          collaborators?: string[] | null
          countries?: string[] | null
          locations?: Json | null
          arms?: Json | null
          has_results?: boolean | null
          results_first_posted?: string | null
          source_register?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          nct_id?: string
          gene_id?: string
          title?: string
          brief_summary?: string | null
          detailed_description?: string | null
          phase?: string | null
          status?: string
          start_date?: string | null
          primary_completion_date?: string | null
          completion_date?: string | null
          last_update_posted?: string | null
          enrollment?: number | null
          enrollment_type?: string | null
          conditions?: string[] | null
          interventions?: Json | null
          study_type?: string | null
          allocation?: string | null
          intervention_model?: string | null
          primary_purpose?: string | null
          masking?: string | null
          primary_outcomes?: Json | null
          secondary_outcomes?: Json | null
          lead_sponsor?: string | null
          sponsor_type?: string | null
          collaborators?: string[] | null
          countries?: string[] | null
          locations?: Json | null
          arms?: Json | null
          has_results?: boolean | null
          results_first_posted?: string | null
          source_register?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinical_trials_gene_id_fkey"
            columns: ["gene_id"]
            referencedRelation: "tx_genes_master"
            referencedColumns: ["gene_id"]
          }
        ]
      }
      tx_txscore_cache: {
        Row: {
          gene_id: string
          cancer_type: string
          tvs: number
          efficacy_score: number
          safety_score: number
          druggability_score: number
          precedent_score: number
          stratification_score: number
          efficacy_components: Json | null
          tissue_risks: Json | null
          critical_tissue_risk: number | null
          modality_recommendation: Json | null
          binding_pockets: Json | null
          precedent_components: Json | null
          biomarker_features: Json | null
          model_version: string
          weights: Json | null
          confidence_interval: Json | null
          data_sources: Json | null
          computed_at: string
          expires_at: string | null
        }
        Insert: {
          gene_id: string
          cancer_type: string
          tvs: number
          efficacy_score: number
          safety_score: number
          druggability_score: number
          precedent_score: number
          stratification_score: number
          efficacy_components?: Json | null
          tissue_risks?: Json | null
          critical_tissue_risk?: number | null
          modality_recommendation?: Json | null
          binding_pockets?: Json | null
          precedent_components?: Json | null
          biomarker_features?: Json | null
          model_version?: string
          weights?: Json | null
          confidence_interval?: Json | null
          data_sources?: Json | null
          computed_at?: string
          expires_at?: string | null
        }
        Update: {
          gene_id?: string
          cancer_type?: string
          tvs?: number
          efficacy_score?: number
          safety_score?: number
          druggability_score?: number
          precedent_score?: number
          stratification_score?: number
          efficacy_components?: Json | null
          tissue_risks?: Json | null
          critical_tissue_risk?: number | null
          modality_recommendation?: Json | null
          binding_pockets?: Json | null
          precedent_components?: Json | null
          biomarker_features?: Json | null
          model_version?: string
          weights?: Json | null
          confidence_interval?: Json | null
          data_sources?: Json | null
          computed_at?: string
          expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "txscore_cache_gene_id_fkey"
            columns: ["gene_id"]
            referencedRelation: "tx_genes_master"
            referencedColumns: ["gene_id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_essential_genes: {
        Args: {
          p_cancer_type: string
          p_chronos_threshold?: number
          p_prevalence_threshold?: number
        }
        Returns: string[]
      }
      get_pan_cancer_targets: {
        Args: {
          p_min_cancer_types?: number
          p_min_tvs?: number
        }
        Returns: {
          gene_id: string
          cancer_types: string[]
          avg_tvs: number
          num_cancer_types: number
        }[]
      }
      rank_targets_custom: {
        Args: {
          p_cancer_type: string
          p_weights?: Json
          p_limit?: number
        }
        Returns: {
          gene_id: string
          cancer_type: string
          tvs: number
          custom_score: number
          efficacy_score: number
          safety_score: number
          druggability_score: number
          precedent_score: number
          stratification_score: number
        }[]
      }
      find_similar_targets: {
        Args: {
          p_gene_id: string
          p_cancer_type: string
          p_limit?: number
        }
        Returns: {
          gene_id: string
          cancer_type: string
          tvs: number
          similarity_score: number
          efficacy_score: number
          safety_score: number
          druggability_score: number
        }[]
      }
      compute_selectivity_index: {
        Args: {
          p_gene_id: string
          p_cancer_type: string
        }
        Returns: number
      }
      compute_tissue_safety_risk: {
        Args: {
          p_gene_id: string
          p_tissue_name: string
        }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
  }
}
