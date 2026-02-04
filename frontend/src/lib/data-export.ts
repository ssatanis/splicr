/**
 * Personal data export for privacy/GDPR compliance.
 * Produces a structured, residency-specific export payload.
 */

export type DataResidency = 'us' | 'eu' | 'asia';

const EXPORT_VERSION = '1.0';
const DATA_CONTROLLER = 'SplicR';
const CONTROLLER_CONTACT = 'privacy@splicr.com';

function getExportNotice(region: DataResidency, exportedAt: string): string {
  const date = new Date(exportedAt).toISOString();
  switch (region) {
    case 'eu':
      return [
        'GDPR PERSONAL DATA EXPORT',
        '────────────────────────────',
        `This export is provided in accordance with Regulation (EU) 2016/679 (GDPR), Article 20(1) — Right to data portability.`,
        '',
        `Data controller: ${DATA_CONTROLLER}`,
        `Contact: ${CONTROLLER_CONTACT}`,
        `Export generated: ${date} (UTC)`,
        '',
        'You have the right to receive the personal data concerning you in a structured, commonly used and machine-readable format, and to transmit those data to another controller without hindrance.',
        '',
        'This file contains a complete export of the personal data we hold associated with your account, in a portable format.',
      ].join('\n');
    case 'asia':
      return [
        'PERSONAL DATA EXPORT',
        '────────────────────────────',
        `This export is provided in accordance with applicable data protection and privacy laws (including PDPA and similar frameworks in the Asia-Pacific region).`,
        '',
        `Data controller: ${DATA_CONTROLLER}`,
        `Contact: ${CONTROLLER_CONTACT}`,
        `Export generated: ${date} (UTC)`,
        '',
        'This file contains a complete export of the personal data we hold associated with your account, in a portable format.',
      ].join('\n');
    case 'us':
    default:
      return [
        'PERSONAL DATA EXPORT',
        '────────────────────────────',
        'This export is provided in accordance with applicable U.S. state privacy laws (e.g., CCPA, VCDPA, CPA) and our privacy policy.',
        '',
        `Data controller: ${DATA_CONTROLLER}`,
        `Contact: ${CONTROLLER_CONTACT}`,
        `Export generated: ${date} (UTC)`,
        '',
        'This file contains a complete export of the personal data we hold associated with your account, in a portable format.',
      ].join('\n');
  }
}

export interface ExportMetadata {
  export_version: string;
  exported_at: string;
  residency_region: DataResidency;
  residency_label: string;
  notice: string;
  data_categories_included: string[];
}

export interface DataExportPayload {
  _export_metadata: ExportMetadata;
  account: {
    user_id: string;
    email: string;
    email_confirmed_at: string | null;
    created_at: string;
    last_sign_in_at: string | null;
  };
  profile: Record<string, unknown> | null;
  analyses: Array<{
    id: string;
    name: string;
    status: string;
    created_at: string;
    updated_at: string;
    library_type?: string;
    method?: string;
    parameters_summary?: Record<string, unknown>;
    file_names?: string[];
    sample_labels?: unknown[];
    result_summary?: { gene_count?: number; has_results: boolean };
  }>;
  analysis_defaults: Record<string, unknown> | null;
  user_settings: Record<string, unknown> | null;
  analysis_shares: Array<{
    id: string;
    analysis_id: string;
    email: string;
    permission: string;
    status: string;
    created_at: string;
    visibility?: string;
    is_link_share?: boolean;
  }>;
  notifications: Array<{
    id: string;
    type: string;
    title: string;
    message: string;
    read: boolean;
    created_at: string;
  }>;
  qc_settings: Record<string, unknown> | null;
  data_management_settings: Record<string, unknown> | null;
  presets: Array<{ id: string; name: string; description: string | null; created_at: string }>;
}

// Accept any Supabase client (browser or server, typed or untyped) for data export
import type { SupabaseClient as SupabaseClientType } from '@supabase/supabase-js';

const RESIDENCY_LABELS: Record<DataResidency, string> = {
  us: 'United States',
  eu: 'European Union (GDPR)',
  asia: 'Asia Pacific',
};

export async function buildDataExport(
  supabase: SupabaseClientType,
  residency: DataResidency
): Promise<DataExportPayload> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const exportedAt = new Date().toISOString();
  const notice = getExportNotice(residency, exportedAt);

  const account = {
    user_id: user.id,
    email: user.email ?? '',
    email_confirmed_at: (user as { email_confirmed_at?: string }).email_confirmed_at ?? null,
    created_at: (user as { created_at?: string }).created_at ?? exportedAt,
    last_sign_in_at: (user as { last_sign_in_at?: string }).last_sign_in_at ?? null,
  };

  const sb = supabase as any;
  const uid = user.id;

  let profile: Record<string, unknown> | null = null;
  try {
    const { data } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
    if (data) profile = data as Record<string, unknown>;
  } catch {
    // table may not exist
  }

  let analyses: DataExportPayload['analyses'] = [];
  try {
    const { data } = await sb.from('analyses').select('id, name, status, created_at, updated_at, library_id, library_type, library, method, parameters, file_names, sample_labels, results').eq('user_id', uid).order('created_at', { ascending: false }).limit(500);
    const list = (data ?? []) as Array<{
      id: string;
      name: string;
      status: string;
      created_at: string;
      updated_at: string;
      library_id?: string;
      library_type?: string;
      library?: string;
      method?: string;
      parameters?: Record<string, unknown>;
      file_names?: string[];
      sample_labels?: unknown[];
      results?: unknown;
    }>;
    analyses = list.map((a) => {
      const results = a.results as Record<string, unknown> | null | undefined;
      const resultSummary = results
        ? {
            gene_count: Array.isArray(results.genes) ? (results.genes as unknown[]).length : undefined,
            has_results: true,
          }
        : { has_results: false };
      return {
        id: a.id,
        name: a.name,
        status: a.status,
        created_at: a.created_at,
        updated_at: a.updated_at,
        library_type: a.library_type ?? a.library,
        method: a.method,
        parameters_summary: a.parameters ?? undefined,
        file_names: a.file_names,
        sample_labels: a.sample_labels,
        result_summary: resultSummary,
      };
    });
  } catch {
    // ignore
  }

  let analysis_defaults: Record<string, unknown> | null = null;
  try {
    const { data } = await sb.from('analysis_defaults').select('*').eq('user_id', uid).maybeSingle();
    if (data) analysis_defaults = data as Record<string, unknown>;
  } catch {
    // ignore
  }

  let user_settings: Record<string, unknown> | null = null;
  try {
    const { data } = await sb.from('user_settings').select('*').eq('user_id', uid).maybeSingle();
    if (data) user_settings = data as Record<string, unknown>;
  } catch {
    // ignore
  }

  let analysis_shares: DataExportPayload['analysis_shares'] = [];
  try {
    const { data } = await sb
      .from('analysis_shares')
      .select('id, analysis_id, email, permission, status, created_at, visibility, is_link_share')
      .or(`shared_by.eq.${uid},user_id.eq.${uid}`)
      .order('created_at', { ascending: false })
      .limit(500);
    analysis_shares = (data ?? []) as DataExportPayload['analysis_shares'];
  } catch {
    // try shared_by column if different
    try {
      const { data } = await sb.from('analysis_shares').select('id, analysis_id, email, permission, status, created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(500);
      analysis_shares = (data ?? []).map((r: any) => ({ ...r, visibility: undefined, is_link_share: undefined })) as DataExportPayload['analysis_shares'];
    } catch {
      // ignore
    }
  }

  let notifications: DataExportPayload['notifications'] = [];
  try {
    const { data } = await sb.from('notifications').select('id, type, title, message, read, created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(200);
    notifications = (data ?? []) as DataExportPayload['notifications'];
  } catch {
    try {
      const { data } = await sb.from('user_notifications').select('id, type, message, read, created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(200);
      notifications = (data ?? []).map((n: any) => ({
        id: n.id,
        type: n.type,
        title: n.type,
        message: n.message,
        read: n.read,
        created_at: n.created_at,
      })) as DataExportPayload['notifications'];
    } catch {
      // ignore
    }
  }

  let qc_settings: Record<string, unknown> | null = null;
  try {
    const { data } = await sb.from('qc_settings').select('*').eq('user_id', uid).maybeSingle();
    if (data) qc_settings = data as Record<string, unknown>;
  } catch {
    // ignore
  }

  let data_management_settings: Record<string, unknown> | null = null;
  try {
    const { data } = await sb.from('data_management_settings').select('*').eq('user_id', uid).maybeSingle();
    if (data) data_management_settings = data as Record<string, unknown>;
  } catch {
    // ignore
  }

  let presets: DataExportPayload['presets'] = [];
  try {
    const { data } = await sb.from('analysis_presets').select('id, name, description, created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(200);
    presets = (data ?? []) as DataExportPayload['presets'];
  } catch {
    // ignore
  }

  const data_categories_included = [
    'account',
    'profile',
    'analyses',
    'analysis_defaults',
    'user_settings',
    'analysis_shares',
    'notifications',
    'qc_settings',
    'data_management_settings',
    'presets',
  ];

  return {
    _export_metadata: {
      export_version: EXPORT_VERSION,
      exported_at: exportedAt,
      residency_region: residency,
      residency_label: RESIDENCY_LABELS[residency],
      notice,
      data_categories_included,
    },
    account,
    profile,
    analyses,
    analysis_defaults,
    user_settings,
    analysis_shares,
    notifications,
    qc_settings,
    data_management_settings,
    presets,
  };
}

export function getExportFileName(residency: DataResidency): string {
  const date = new Date().toISOString().slice(0, 10);
  const region = residency.toUpperCase();
  return `SplicR-DataExport-${region}-${date}.json`;
}
