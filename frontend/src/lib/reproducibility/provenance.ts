/**
 * Provenance Tracking Utilities
 *
 * W3C PROV-compliant provenance tracking for scientific reproducibility.
 * Captures complete data lineage, transformations, and attributions.
 *
 * @see https://www.w3.org/TR/prov-dm/
 */

import { createClient } from '@/lib/supabase/server';
import {
  ProvEntity,
  ProvActivity,
  ProvAgent,
  ProvRelation,
  ProvEntityType,
  ProvActivityType,
  ProvAgentType,
  ProvRelationType,
  ProvenanceGraph,
  ProvenanceTrace,
  ComputeResources,
} from '@/lib/types';
import * as crypto from 'crypto';

// =============================================================================
// PROV ENTITY OPERATIONS
// =============================================================================

/**
 * Create a new provenance entity (data object)
 */
export async function createProvEntity(params: {
  analysis_id: string;
  version_id?: string;
  type: ProvEntityType;
  label: string;
  location?: string;
  size_bytes?: number;
  format?: string;
  attributes?: Record<string, any>;
  is_input?: boolean;
  is_output?: boolean;
  is_intermediate?: boolean;
  file_content?: Buffer | string; // Optional: calculate checksum from content
}): Promise<ProvEntity> {
  const supabase = await createClient();

  // Calculate checksum if content provided
  let checksum = null;
  if (params.file_content) {
    checksum = calculateChecksum(params.file_content);
  }

  const entity = {
    analysis_id: params.analysis_id,
    version_id: params.version_id || null,
    type: params.type,
    label: params.label,
    location: params.location || null,
    checksum,
    size_bytes: params.size_bytes || null,
    format: params.format || null,
    attributes: params.attributes || null,
    is_input: params.is_input || false,
    is_output: params.is_output || false,
    is_intermediate: params.is_intermediate || false,
  };

  const { data, error } = await (supabase as any)
    .from('prov_entities')
    .insert(entity)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create provenance entity: ${error.message}`);
  }

  return data as ProvEntity;
}

/**
 * Get all entities for an analysis
 */
export async function getProvEntities(
  analysis_id: string,
  version_id?: string
): Promise<ProvEntity[]> {
  const supabase = await createClient();

  let query = supabase
    .from('prov_entities')
    .select('*')
    .eq('analysis_id', analysis_id)
    .order('created_at', { ascending: true });

  if (version_id) {
    query = query.eq('version_id', version_id);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch provenance entities: ${error.message}`);
  }

  return data as ProvEntity[];
}

/**
 * Get entity by ID
 */
export async function getProvEntity(entity_id: string): Promise<ProvEntity> {
  const supabase = await createClient();

  const { data, error } = await (supabase as any)
    .from('prov_entities')
    .select('*')
    .eq('id', entity_id)
    .single();

  if (error) {
    throw new Error(`Failed to fetch provenance entity: ${error.message}`);
  }

  return data as ProvEntity;
}

// =============================================================================
// PROV ACTIVITY OPERATIONS
// =============================================================================

/**
 * Start a new provenance activity (processing step)
 */
export async function startProvActivity(params: {
  analysis_id: string;
  version_id?: string;
  type: ProvActivityType;
  label: string;
  algorithm: string;
  algorithm_version?: string;
  parameters: Record<string, any>;
  compute_resources?: ComputeResources;
}): Promise<ProvActivity> {
  const supabase = await createClient();

  const activity = {
    analysis_id: params.analysis_id,
    version_id: params.version_id || null,
    type: params.type,
    label: params.label,
    algorithm: params.algorithm,
    algorithm_version: params.algorithm_version || null,
    parameters: params.parameters,
    started_at: new Date().toISOString(),
    ended_at: null,
    duration_seconds: null,
    status: 'running' as const,
    error_message: null,
    compute_resources: params.compute_resources || null,
    output_summary: null,
  };

  const { data, error } = await (supabase as any)
    .from('prov_activities')
    .insert(activity)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create provenance activity: ${error.message}`);
  }

  return data as ProvActivity;
}

/**
 * Complete a provenance activity (success or failure)
 */
export async function completeProvActivity(
  activity_id: string,
  params: {
    status: 'success' | 'failed';
    error_message?: string;
    output_summary?: Record<string, any>;
    compute_resources?: ComputeResources;
  }
): Promise<ProvActivity> {
  const supabase = await createClient();

  // Get activity to calculate duration
  const { data: activity } = await (supabase as any)
    .from('prov_activities')
    .select('started_at')
    .eq('id', activity_id)
    .single();

  const ended_at = new Date();
  const duration_seconds = activity
    ? Math.floor((ended_at.getTime() - new Date(activity.started_at).getTime()) / 1000)
    : null;

  const updates = {
    ended_at: ended_at.toISOString(),
    duration_seconds,
    status: params.status,
    error_message: params.error_message || null,
    output_summary: params.output_summary || null,
    compute_resources: params.compute_resources || undefined,
  };

  const { data, error } = await (supabase as any)
    .from('prov_activities')
    .update(updates)
    .eq('id', activity_id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to complete provenance activity: ${error.message}`);
  }

  return data as ProvActivity;
}

/**
 * Get all activities for an analysis
 */
export async function getProvActivities(
  analysis_id: string,
  version_id?: string
): Promise<ProvActivity[]> {
  const supabase = await createClient();

  let query = supabase
    .from('prov_activities')
    .select('*')
    .eq('analysis_id', analysis_id)
    .order('started_at', { ascending: true });

  if (version_id) {
    query = query.eq('version_id', version_id);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch provenance activities: ${error.message}`);
  }

  return data as ProvActivity[];
}

// =============================================================================
// PROV AGENT OPERATIONS
// =============================================================================

/**
 * Create or get a provenance agent
 */
export async function createOrGetProvAgent(params: {
  type: ProvAgentType;
  label: string;
  version?: string;
  user_id?: string;
  organization?: string;
  email?: string;
  orcid?: string;
  url?: string;
  attributes?: Record<string, any>;
}): Promise<ProvAgent> {
  const supabase = await createClient();

  // Try to find existing agent first
  let query = supabase
    .from('prov_agents')
    .select('*')
    .eq('type', params.type)
    .eq('label', params.label);

  if (params.version) {
    query = query.eq('version', params.version);
  } else {
    query = query.is('version', null);
  }

  const { data: existing } = await query.single();

  if (existing) {
    return existing as ProvAgent;
  }

  // Create new agent
  const agent = {
    type: params.type,
    label: params.label,
    version: params.version || null,
    user_id: params.user_id || null,
    organization: params.organization || null,
    email: params.email || null,
    orcid: params.orcid || null,
    url: params.url || null,
    attributes: params.attributes || null,
  };

  const { data, error } = await (supabase as any)
    .from('prov_agents')
    .insert(agent)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create provenance agent: ${error.message}`);
  }

  return data as ProvAgent;
}

/**
 * Get all agents for an analysis
 */
export async function getProvAgents(): Promise<ProvAgent[]> {
  const supabase = await createClient();

  const { data, error } = await (supabase as any)
    .from('prov_agents')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch provenance agents: ${error.message}`);
  }

  return data as ProvAgent[];
}

// =============================================================================
// PROV RELATION OPERATIONS
// =============================================================================

/**
 * Create a provenance relation between entities, activities, or agents
 */
export async function createProvRelation(params: {
  analysis_id: string;
  version_id?: string;
  relation_type: ProvRelationType;
  source: { entity_id?: string; activity_id?: string; agent_id?: string };
  target: { entity_id?: string; activity_id?: string; agent_id?: string };
  attributes?: Record<string, any>;
}): Promise<ProvRelation> {
  const supabase = await createClient();

  const relation = {
    analysis_id: params.analysis_id,
    version_id: params.version_id || null,
    relation_type: params.relation_type,
    source_entity_id: params.source.entity_id || null,
    source_activity_id: params.source.activity_id || null,
    source_agent_id: params.source.agent_id || null,
    target_entity_id: params.target.entity_id || null,
    target_activity_id: params.target.activity_id || null,
    target_agent_id: params.target.agent_id || null,
    attributes: params.attributes || null,
  };

  const { data, error } = await (supabase as any)
    .from('prov_relations')
    .insert(relation)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create provenance relation: ${error.message}`);
  }

  return data as ProvRelation;
}

/**
 * Get all relations for an analysis
 */
export async function getProvRelations(
  analysis_id: string,
  version_id?: string
): Promise<ProvRelation[]> {
  const supabase = await createClient();

  let query = supabase
    .from('prov_relations')
    .select('*')
    .eq('analysis_id', analysis_id)
    .order('created_at', { ascending: true });

  if (version_id) {
    query = query.eq('version_id', version_id);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch provenance relations: ${error.message}`);
  }

  return data as ProvRelation[];
}

// =============================================================================
// HIGH-LEVEL PROVENANCE OPERATIONS
// =============================================================================

/**
 * Get complete provenance graph for an analysis
 */
export async function getProvenanceGraph(
  analysis_id: string,
  version_id?: string
): Promise<ProvenanceGraph> {
  const [entities, activities, relations] = await Promise.all([
    getProvEntities(analysis_id, version_id),
    getProvActivities(analysis_id, version_id),
    getProvRelations(analysis_id, version_id),
  ]);

  // Get unique agents referenced in the relations and activities
  const agentIds = new Set<string>();
  relations.forEach((rel) => {
    if (rel.source_agent_id) agentIds.add(rel.source_agent_id);
    if (rel.target_agent_id) agentIds.add(rel.target_agent_id);
  });

  const supabase = await createClient();
  const { data: agents } = await (supabase as any)
    .from('prov_agents')
    .select('*')
    .in('id', Array.from(agentIds));

  return {
    entities,
    activities,
    agents: (agents as ProvAgent[]) || [],
    relations,
  };
}

/**
 * Trace provenance lineage for a specific entity
 * Returns upstream (where it came from) and downstream (what it produced)
 */
export async function traceProvenanceLineage(
  entity_id: string,
  max_depth: number = 10
): Promise<ProvenanceTrace> {
  const supabase = await createClient();

  // Get the entity
  const entity = await getProvEntity(entity_id);

  // Trace upstream (what contributed to this entity)
  const upstream = await traceUpstream(entity_id, max_depth);

  // Trace downstream (what this entity contributed to)
  const downstream = await traceDownstream(entity_id, max_depth);

  return {
    entity,
    upstream,
    downstream,
  };
}

/**
 * Trace upstream provenance (backward from entity)
 */
async function traceUpstream(
  entity_id: string,
  max_depth: number,
  current_depth: number = 0,
  visited: Set<string> = new Set()
): Promise<any[]> {
  if (current_depth >= max_depth || visited.has(entity_id)) {
    return [];
  }

  visited.add(entity_id);
  const supabase = await createClient();

  const trace: any[] = [];

  // Find activities that generated this entity (wasGeneratedBy)
  const { data: generatedBy } = await (supabase as any)
    .from('prov_relations')
    .select('*, prov_activities(*)')
    .eq('target_entity_id', entity_id)
    .eq('relation_type', 'wasGeneratedBy');

  if (generatedBy) {
    for (const rel of generatedBy as any[]) {
      const activity = rel.prov_activities;
      trace.push({
        relation: rel,
        activity,
        depth: current_depth,
      });

      // Find entities used by this activity
      const { data: usedEntities } = await (supabase as any)
    .from('prov_relations')
        .select('*, prov_entities(*)')
        .eq('source_activity_id', activity.id)
        .eq('relation_type', 'used');

      if (usedEntities) {
        for (const usedRel of usedEntities as any[]) {
          const usedEntity = usedRel.prov_entities;
          trace.push({
            relation: usedRel,
            entity: usedEntity,
            depth: current_depth + 1,
          });

          // Recurse upstream from this entity
          const nestedTrace = await traceUpstream(
            usedEntity.id,
            max_depth,
            current_depth + 2,
            visited
          );
          trace.push(...nestedTrace);
        }
      }
    }
  }

  // Find entities this was derived from (wasDerivedFrom)
  const { data: derivedFrom } = await (supabase as any)
    .from('prov_relations')
    .select('*, prov_entities!prov_relations_target_entity_id_fkey(*)')
    .eq('source_entity_id', entity_id)
    .eq('relation_type', 'wasDerivedFrom');

  if (derivedFrom) {
    for (const rel of derivedFrom as any[]) {
      const sourceEntity = rel.prov_entities;
      trace.push({
        relation: rel,
        entity: sourceEntity,
        depth: current_depth,
      });

      // Recurse upstream
      const nestedTrace = await traceUpstream(
        sourceEntity.id,
        max_depth,
        current_depth + 1,
        visited
      );
      trace.push(...nestedTrace);
    }
  }

  return trace;
}

/**
 * Trace downstream provenance (forward from entity)
 */
async function traceDownstream(
  entity_id: string,
  max_depth: number,
  current_depth: number = 0,
  visited: Set<string> = new Set()
): Promise<any[]> {
  if (current_depth >= max_depth || visited.has(entity_id)) {
    return [];
  }

  visited.add(entity_id);
  const supabase = await createClient();

  const trace: any[] = [];

  // Find activities that used this entity
  const { data: usedBy } = await (supabase as any)
    .from('prov_relations')
    .select('*, prov_activities(*)')
    .eq('target_entity_id', entity_id)
    .eq('relation_type', 'used');

  if (usedBy) {
    for (const rel of usedBy as any[]) {
      const activity = rel.prov_activities;
      trace.push({
        relation: rel,
        activity,
        depth: current_depth,
      });

      // Find entities generated by this activity
      const { data: generatedEntities } = await (supabase as any)
    .from('prov_relations')
        .select('*, prov_entities(*)')
        .eq('source_activity_id', activity.id)
        .eq('relation_type', 'wasGeneratedBy');

      if (generatedEntities) {
        for (const genRel of generatedEntities as any[]) {
          const genEntity = genRel.prov_entities;
          trace.push({
            relation: genRel,
            entity: genEntity,
            depth: current_depth + 1,
          });

          // Recurse downstream
          const nestedTrace = await traceDownstream(
            genEntity.id,
            max_depth,
            current_depth + 2,
            visited
          );
          trace.push(...nestedTrace);
        }
      }
    }
  }

  // Find entities derived from this entity
  const { data: derivatives } = await (supabase as any)
    .from('prov_relations')
    .select('*, prov_entities!prov_relations_source_entity_id_fkey(*)')
    .eq('target_entity_id', entity_id)
    .eq('relation_type', 'wasDerivedFrom');

  if (derivatives) {
    for (const rel of derivatives as any[]) {
      const derivedEntity = rel.prov_entities;
      trace.push({
        relation: rel,
        entity: derivedEntity,
        depth: current_depth,
      });

      // Recurse downstream
      const nestedTrace = await traceDownstream(
        derivedEntity.id,
        max_depth,
        current_depth + 1,
        visited
      );
      trace.push(...nestedTrace);
    }
  }

  return trace;
}

// =============================================================================
// HELPER UTILITIES
// =============================================================================

/**
 * Calculate SHA256 checksum for file content
 */
export function calculateChecksum(content: Buffer | string): string {
  const hash = crypto.createHash('sha256');
  hash.update(content);
  return hash.digest('hex');
}

/**
 * Export provenance graph as W3C PROV-JSON format
 * @see https://www.w3.org/Submission/2013/SUBM-prov-json-20130424/
 */
export function exportProvenanceAsProvJson(graph: ProvenanceGraph): any {
  const provJson: any = {
    prefix: {
      prov: 'http://www.w3.org/ns/prov#',
      splicr: 'https://splicr.org/ns#',
      xsd: 'http://www.w3.org/2001/XMLSchema#',
    },
    entity: {},
    activity: {},
    agent: {},
  };

  // Convert entities
  graph.entities.forEach((entity) => {
    const id = `splicr:entity/${entity.id}`;
    provJson.entity[id] = {
      'prov:type': entity.type,
      'prov:label': entity.label,
      'prov:location': entity.location,
      'splicr:checksum': entity.checksum,
      'splicr:size_bytes': entity.size_bytes,
      'splicr:format': entity.format,
      'splicr:attributes': entity.attributes,
    };
  });

  // Convert activities
  graph.activities.forEach((activity) => {
    const id = `splicr:activity/${activity.id}`;
    provJson.activity[id] = {
      'prov:type': activity.type,
      'prov:label': activity.label,
      'prov:startTime': activity.started_at,
      'prov:endTime': activity.ended_at,
      'splicr:algorithm': activity.algorithm,
      'splicr:algorithm_version': activity.algorithm_version,
      'splicr:parameters': activity.parameters,
      'splicr:status': activity.status,
    };
  });

  // Convert agents
  graph.agents.forEach((agent) => {
    const id = `splicr:agent/${agent.id}`;
    provJson.agent[id] = {
      'prov:type': agent.type,
      'prov:label': agent.label,
      'splicr:version': agent.version,
      'splicr:url': agent.url,
    };
  });

  // Convert relations
  graph.relations.forEach((rel) => {
    const relType = rel.relation_type;

    // Determine source and target IDs
    const sourceId = rel.source_entity_id
      ? `splicr:entity/${rel.source_entity_id}`
      : rel.source_activity_id
      ? `splicr:activity/${rel.source_activity_id}`
      : rel.source_agent_id
      ? `splicr:agent/${rel.source_agent_id}`
      : null;

    const targetId = rel.target_entity_id
      ? `splicr:entity/${rel.target_entity_id}`
      : rel.target_activity_id
      ? `splicr:activity/${rel.target_activity_id}`
      : rel.target_agent_id
      ? `splicr:agent/${rel.target_agent_id}`
      : null;

    if (!sourceId || !targetId) return;

    // Add relation based on type
    if (!provJson[relType]) {
      provJson[relType] = {};
    }

    provJson[relType][`splicr:relation/${rel.id}`] = {
      'prov:entity': sourceId,
      'prov:activity': targetId,
      'prov:time': rel.created_at,
    };
  });

  return provJson;
}

/**
 * Create standard provenance relations for a typical pipeline step
 * This is a convenience function for the common pattern:
 * input entities -> activity -> output entities
 */
export async function createPipelineStepProvenance(params: {
  analysis_id: string;
  version_id?: string;
  activity: {
    type: ProvActivityType;
    label: string;
    algorithm: string;
    algorithm_version?: string;
    parameters: Record<string, any>;
  };
  input_entities: string[]; // Entity IDs
  output_entities: string[]; // Entity IDs
  agent_id?: string; // Optional agent who performed the activity
  compute_resources?: ComputeResources;
}): Promise<{
  activity: ProvActivity;
  relations: ProvRelation[];
}> {
  // Start the activity
  const activity = await startProvActivity({
    analysis_id: params.analysis_id,
    version_id: params.version_id,
    type: params.activity.type,
    label: params.activity.label,
    algorithm: params.activity.algorithm,
    algorithm_version: params.activity.algorithm_version,
    parameters: params.activity.parameters,
    compute_resources: params.compute_resources,
  });

  const relations: ProvRelation[] = [];

  // Create 'used' relations for input entities
  for (const input_entity_id of params.input_entities) {
    const rel = await createProvRelation({
      analysis_id: params.analysis_id,
      version_id: params.version_id,
      relation_type: 'used',
      source: { activity_id: activity.id },
      target: { entity_id: input_entity_id },
    });
    relations.push(rel);
  }

  // Create 'wasGeneratedBy' relations for output entities
  for (const output_entity_id of params.output_entities) {
    const rel = await createProvRelation({
      analysis_id: params.analysis_id,
      version_id: params.version_id,
      relation_type: 'wasGeneratedBy',
      source: { entity_id: output_entity_id },
      target: { activity_id: activity.id },
    });
    relations.push(rel);
  }

  // Create 'wasAssociatedWith' relation if agent specified
  if (params.agent_id) {
    const rel = await createProvRelation({
      analysis_id: params.analysis_id,
      version_id: params.version_id,
      relation_type: 'wasAssociatedWith',
      source: { activity_id: activity.id },
      target: { agent_id: params.agent_id },
    });
    relations.push(rel);
  }

  return {
    activity,
    relations,
  };
}
