import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';

const CLINICAL_TRIALS_API = 'https://clinicaltrials.gov/api/v2/studies';
const CACHE_DAYS = 1;
const CACHE_MS = CACHE_DAYS * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 50;

function buildQueryParams(params: { gene?: string; drug?: string; condition?: string }): URLSearchParams {
  const q = new URLSearchParams();
  q.set('pageSize', String(PAGE_SIZE));
  q.set('countTotal', 'true');
  if (params.condition?.trim()) q.set('query.cond', params.condition.trim());
  if (params.drug?.trim()) q.set('query.intr', params.drug.trim());
  if (params.gene?.trim()) q.set('query.term', params.gene.trim());
  return q;
}

function formatTrial(study: any): Record<string, unknown> {
  const protocol = study?.protocolSection ?? {};
  const ident = protocol?.identificationModule ?? {};
  const statusMod = protocol?.statusModule ?? {};
  const design = protocol?.designModule ?? {};
  const enrollment = protocol?.designModule?.enrollmentInfo ?? protocol?.enrollmentInfo ?? {};
  const conditions = protocol?.conditionsModule?.conditions ?? [];
  const arms = protocol?.armsInterventionsModule ?? {};
  const interventions = arms?.interventions ?? [];
  const sponsorMod = protocol?.sponsorCollaboratorsModule ?? {};
  const lead = sponsorMod?.leadSponsor ?? {};
  const contacts = protocol?.contactsLocationsModule ?? {};
  const locations = contacts?.locations ?? [];
  const nctId = ident?.nctId ?? '';

  const phaseList = design?.phases ?? [];
  const phase = Array.isArray(phaseList) && phaseList.length > 0 ? phaseList[0] : null;

  return {
    nctId,
    title: ident?.briefTitle ?? ident?.officialTitle ?? '',
    status: statusMod?.overallStatus ?? null,
    phase: phase ?? null,
    enrollment: enrollment?.count ?? null,
    startDate: statusMod?.startDateStruct?.date ?? null,
    completionDate: statusMod?.completionDateStruct?.date ?? statusMod?.primaryCompletionDateStruct?.date ?? null,
    conditions: Array.isArray(conditions) ? conditions : [conditions].filter(Boolean),
    interventions: interventions.map((i: any) => ({ type: i?.type ?? 'OTHER', name: i?.name ?? '' })),
    sponsor: lead?.name ?? null,
    locations: locations.slice(0, 5).map((loc: any) => ({
      facility: loc?.facility ?? null,
      city: loc?.city ?? null,
      state: loc?.state ?? null,
      country: loc?.country ?? null,
    })),
    hasResults: study?.hasResults ?? false,
    url: nctId ? `https://clinicaltrials.gov/study/${nctId}` : null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const gene = searchParams.get('gene')?.trim() ?? '';
    const drug = searchParams.get('drug')?.trim() ?? '';
    const condition = searchParams.get('condition')?.trim() ?? '';
    if (!gene && !drug && !condition) {
      return NextResponse.json(
        { error: 'At least one parameter required', details: 'Use ?gene=TP53&drug=cisplatin&condition=cancer' },
        { status: 400 }
      );
    }

    const queryKey = `gene=${gene}&drug=${drug}&condition=${condition}`;

    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const { data: cachedRow } = await supabaseAdmin
        .from('clinical_trials_cache')
        .select('data, cached_at')
        .eq('query_key', queryKey)
        .maybeSingle();
      const cached = cachedRow as { data: unknown; cached_at: string } | null;
      const cachedAt = cached?.cached_at ? new Date(cached.cached_at).getTime() : 0;
      if (cached && Date.now() - cachedAt < CACHE_MS && cached.data) {
        return NextResponse.json(cached.data as Record<string, unknown>);
      }
    }

    const qParams = buildQueryParams({ gene, drug, condition });
    const url = `${CLINICAL_TRIALS_API}?${qParams.toString()}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      return NextResponse.json(
        { error: 'ClinicalTrials.gov request failed', details: res.statusText },
        { status: 502 }
      );
    }
    const json = await res.json();
    const studies = json?.studies ?? [];
    const total = json?.totalCount ?? studies.length;

    const trials = studies.map((s: any) => formatTrial(s));
    const byPhase: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const t of trials) {
      const ph = (t.phase as string) ?? 'NA';
      byPhase[ph] = (byPhase[ph] ?? 0) + 1;
      const st = (t.status as string) ?? 'UNKNOWN';
      byStatus[st] = (byStatus[st] ?? 0) + 1;
    }

    const payload = {
      total,
      trials,
      summary: { byPhase, byStatus },
    };

    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const table = supabaseAdmin.from('clinical_trials_cache');
      const { data: existing } = await table.select('id').eq('query_key', queryKey).maybeSingle();
      const row = { data: payload, cached_at: new Date().toISOString() };
      if (existing) {
        await (table as any).update(row).eq('query_key', queryKey);
      } else {
        await (table as any).insert({ query_key: queryKey, ...row });
      }
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error('Clinical trials API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch clinical trials',
        details: error instanceof Error ? error.message : 'Unknown',
      },
      { status: 500 }
    );
  }
}
