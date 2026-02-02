import { createBrowserClient } from '@supabase/ssr'

// Type-safe database schema
export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          display_name: string | null
          avatar_url: string | null
          created_at: string
        }
        Insert: {
          id?: string
          email: string
          display_name?: string | null
          avatar_url?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          email?: string
          display_name?: string | null
          avatar_url?: string | null
          created_at?: string
        }
      }
      profiles: {
        Row: {
          id: string
          email: string
          full_name: string | null
          avatar_url: string | null
          institution: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          avatar_url?: string | null
          institution?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          avatar_url?: string | null
          institution?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      analyses: {
        Row: {
          id: string
          user_id: string
          name: string
          library_id?: string
          library_type?: string
          method?: string
          algorithms?: string[]
          status: string
          progress?: number
          current_step?: string | null
          parameters?: Record<string, unknown>
          results: unknown
          logs?: unknown[] | null
          error_message?: string | null
          file_names?: string[]
          sample_labels?: unknown[]
          created_at: string
          updated_at?: string
          started_at?: string | null
          completed_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          library_id?: string
          library_type?: string
          method?: string
          algorithms?: string[]
          status?: string
          progress?: number
          current_step?: string | null
          parameters?: Record<string, unknown>
          results?: unknown
          logs?: unknown[] | null
          error_message?: string | null
          file_names?: string[]
          sample_labels?: unknown[]
          created_at?: string
          updated_at?: string
          started_at?: string | null
          completed_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          library_id?: string
          library_type?: string
          method?: string
          algorithms?: string[]
          status?: string
          progress?: number
          current_step?: string | null
          parameters?: Record<string, unknown>
          results?: unknown
          logs?: unknown[] | null
          error_message?: string | null
          file_names?: string[]
          sample_labels?: unknown[]
          created_at?: string
          updated_at?: string
          started_at?: string | null
          completed_at?: string | null
        }
      }
      analysis_results: {
        Row: {
          id: string
          analysis_id: string
          gene: string
          log2fc: number
          fdr: number
          pvalue: number
        }
      }
      gene_info_cache: {
        Row: {
          id: string
          gene_symbol: string
          data: unknown
          cached_at: string
        }
        Insert: {
          gene_symbol: string
          data: unknown
          cached_at?: string
        }
      }
      drug_gene_cache: {
        Row: {
          id: string
          gene_symbol: string
          drugs: unknown
          cached_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          gene_symbol: string
          drugs: unknown
          cached_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          gene_symbol?: string
          drugs?: unknown
          cached_at?: string
          created_at?: string
          updated_at?: string
        }
      }
      clinical_trials_cache: {
        Row: {
          id: string
          query_key: string
          data: unknown
          cached_at: string
        }
        Insert: {
          query_key: string
          data: unknown
          cached_at?: string
        }
      }
      analysis_comments: {
        Row: {
          id: string
          analysis_id: string
          user_id: string
          parent_comment_id: string | null
          target_type: string
          target_id: string | null
          content: string
          mentions: unknown[]
          is_resolved: boolean
          resolved_by: string | null
          resolved_at: string | null
          edited: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          analysis_id: string
          user_id: string
          parent_comment_id?: string | null
          target_type?: string
          target_id?: string | null
          content: string
          mentions?: unknown[]
          is_resolved?: boolean
          resolved_by?: string | null
          resolved_at?: string | null
          edited?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          analysis_id?: string
          user_id?: string
          parent_comment_id?: string | null
          target_type?: string
          target_id?: string | null
          content?: string
          mentions?: unknown[]
          is_resolved?: boolean
          resolved_by?: string | null
          resolved_at?: string | null
          edited?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      analysis_activity: {
        Row: {
          id: string
          analysis_id: string
          user_id: string
          action: string
          activity_type: string
          description: string
          details: unknown
          metadata: unknown
          created_at: string
        }
        Insert: {
          id?: string
          analysis_id: string
          user_id: string
          action?: string
          activity_type?: string
          description?: string
          details?: unknown
          metadata?: unknown
          created_at?: string
        }
        Update: {
          id?: string
          analysis_id?: string
          user_id?: string
          action?: string
          activity_type?: string
          description?: string
          details?: unknown
          metadata?: unknown
          created_at?: string
        }
      }
      analysis_presence: {
        Row: {
          id: string
          analysis_id: string
          user_id: string
          status: string
          last_seen: string
        }
        Insert: {
          id?: string
          analysis_id: string
          user_id: string
          status?: string
          last_seen?: string
        }
        Update: {
          id?: string
          analysis_id?: string
          user_id?: string
          status?: string
          last_seen?: string
        }
      }
      comment_reactions: {
        Row: {
          id: string
          comment_id: string
          user_id: string
          reaction: string
          created_at: string
        }
        Insert: {
          id?: string
          comment_id: string
          user_id: string
          reaction: string
          created_at?: string
        }
        Update: {
          id?: string
          comment_id?: string
          user_id?: string
          reaction?: string
          created_at?: string
        }
      }
      user_notifications: {
        Row: {
          id: string
          user_id: string
          type: string
          message: string
          read: boolean
          data: unknown
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          type: string
          message: string
          read?: boolean
          data?: unknown
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          type?: string
          message?: string
          read?: boolean
          data?: unknown
          created_at?: string
        }
      }
      activity_logs: {
        Row: {
          id: string
          analysis_id: string
          user_id: string
          action: string
          details: unknown
          created_at: string
        }
        Insert: {
          id?: string
          analysis_id: string
          user_id: string
          action: string
          details?: unknown
          created_at?: string
        }
        Update: {
          id?: string
          analysis_id?: string
          user_id?: string
          action?: string
          details?: unknown
          created_at?: string
        }
      }
      analysis_shares: {
        Row: {
          id: string
          analysis_id: string
          email: string
          permission: 'view' | 'edit' | 'admin'
          status: 'pending' | 'accepted' | 'declined'
          user_id: string | null
          shared_by: string
          created_at: string
          accepted_at: string | null
          // Link-based sharing fields
          visibility: 'private' | 'institution' | 'public'
          share_token: string | null
          link_permission: 'view' | 'edit'
          link_expires_at: string | null
          institution_domain: string | null
          institution_permission: 'view' | 'edit'
          updated_at: string
          is_link_share: boolean
        }
        Insert: {
          id?: string
          analysis_id: string
          email: string
          permission?: 'view' | 'edit' | 'admin'
          status?: 'pending' | 'accepted' | 'declined'
          user_id?: string | null
          shared_by: string
          created_at?: string
          accepted_at?: string | null
          visibility?: 'private' | 'institution' | 'public'
          share_token?: string | null
          link_permission?: 'view' | 'edit'
          link_expires_at?: string | null
          institution_domain?: string | null
          institution_permission?: 'view' | 'edit'
          updated_at?: string
          is_link_share?: boolean
        }
        Update: {
          id?: string
          analysis_id?: string
          email?: string
          permission?: 'view' | 'edit' | 'admin'
          status?: 'pending' | 'accepted' | 'declined'
          user_id?: string | null
          shared_by?: string
          created_at?: string
          accepted_at?: string | null
          visibility?: 'private' | 'institution' | 'public'
          share_token?: string | null
          link_permission?: 'view' | 'edit'
          link_expires_at?: string | null
          institution_domain?: string | null
          institution_permission?: 'view' | 'edit'
          updated_at?: string
          is_link_share?: boolean
        }
      }
      analysis_access_log: {
        Row: {
          id: string
          analysis_id: string
          user_id: string | null
          access_type: string
          access_method: 'owner' | 'collaborator' | 'institution' | 'public_link' | null
          ip_address: string | null
          user_agent: string | null
          accessed_at: string
        }
        Insert: {
          id?: string
          analysis_id: string
          user_id?: string | null
          access_type: string
          access_method?: 'owner' | 'collaborator' | 'institution' | 'public_link' | null
          ip_address?: string | null
          user_agent?: string | null
          accessed_at?: string
        }
        Update: {
          id?: string
          analysis_id?: string
          user_id?: string | null
          access_type?: string
          access_method?: 'owner' | 'collaborator' | 'institution' | 'public_link' | null
          ip_address?: string | null
          user_agent?: string | null
          accessed_at?: string
        }
      }
    }
  }
}

// Resolve client key: Supabase now recommends the short publishable key (sb_publishable_...) for client auth.
// Prefer it when present, otherwise fall back to the legacy JWT anon key.
function getAnonKey(): string | undefined {
  const publishable = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY?.trim()
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (publishable && publishable.startsWith('sb_publishable_')) return publishable
  return anon || undefined
}

// Supabase project URLs are https://<ref>.supabase.co — reject app/localhost URLs that return HTML and cause "Unexpected token '<'" auth errors
function isValidSupabaseUrl(url: string): boolean {
  if (!url || !url.trim()) return false
  try {
    const u = new URL(url.trim())
    const host = u.hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.vercel.app') || host.endsWith('.netlify.app')) return false
    return host.includes('supabase.co')
  } catch {
    return false
  }
}

function assertValidSupabaseUrl(url: string) {
  if (!isValidSupabaseUrl(url)) {
    try {
      new URL(url)
    } catch {
      throw new Error(
        `NEXT_PUBLIC_SUPABASE_URL is not a valid URL: ${url}. Use your Supabase project URL (e.g. https://your-project.supabase.co).`
      )
    }
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL must be your Supabase project URL (e.g. https://your-project.supabase.co), not the app URL. Currently: ${url}`
    )
  }
}

// Client instance cache for singleton pattern
let browserClient: ReturnType<typeof createBrowserClient<Database>> | null = null

// Create browser-side Supabase client (for Client Components)
// Uses singleton pattern to prevent multiple GoTrueClient instances
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const anonKey = getAnonKey()
  if (!url || !anonKey) {
    throw new Error(
      'Missing Supabase config. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in frontend/.env.local, then stop the dev server (Ctrl+C) and run "npm run dev" again from the frontend folder. If env was just added, clear the .next folder and restart.'
    )
  }
  assertValidSupabaseUrl(url)

  // Return existing instance if on client side
  if (typeof window !== 'undefined' && browserClient) {
    return browserClient
  }

  // Create new instance
  const client = createBrowserClient<Database>(url, anonKey)

  // Cache for client-side reuse
  if (typeof window !== 'undefined') {
    browserClient = client
  }

  return client
}

// Singleton client for backward compatibility with existing code
// Using createBrowserClient for consistency and proper SSR support
let _supabaseInstance: ReturnType<typeof createBrowserClient<Database>> | null = null

export const supabase = (() => {
  if (typeof window === 'undefined') {
    // Server-side: create a new instance each time (shouldn't be used server-side anyway)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || ''
    const key = getAnonKey() || ''
    if (!url || !key) {
      throw new Error('Missing Supabase configuration')
    }
    return createBrowserClient<Database>(url, key)
  }

  // Client-side: use singleton to prevent multiple instances
  if (!_supabaseInstance) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || ''
    const key = getAnonKey() || ''
    if (!url || !key) {
      throw new Error('Missing Supabase configuration')
    }
    _supabaseInstance = createBrowserClient<Database>(url, key)
  }
  return _supabaseInstance
})()

// Check if Supabase is configured
export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && getAnonKey()
)

import { normalizeAnalysisMethod } from '@/lib/analysis-method'
export { normalizeAnalysisMethod }

// Database types
export interface AnalysisRecord {
  id: string
  user_id: string
  name: string
  library_type: string
  algorithms: string[]
  status: 'created' | 'queued' | 'running' | 'complete' | 'failed' | 'cancelled'
  progress: number
  current_step: string | null
  parameters: Record<string, unknown>
  results: Record<string, unknown> | null
  logs: LogEntry[] | null
  error_message: string | null
  file_names: string[]
  sample_labels: SampleLabel[]
  created_at: string
  updated_at: string
  started_at: string | null
  completed_at: string | null
}

export interface LogEntry {
  timestamp: string
  step: string
  message: string
  progress: number
  level: 'info' | 'warning' | 'error' | 'success'
}

export interface SampleLabel {
  fileName: string
  fileId: string
  sampleName: string
  condition: 'control' | 'treatment'
  replicate: number
}

// Database operations using the new client
export class AnalysisDB {
  private static async getUserId(): Promise<string> {
    // Try to get user from Supabase session
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (user) {
      return user.id
    }

    // Fallback to localStorage for anonymous users
    if (typeof window !== 'undefined') {
      let userId = localStorage.getItem('splicr_user_id')
      if (!userId) {
        userId = `anon_${Date.now()}_${Math.random().toString(36).substring(7)}`
        localStorage.setItem('splicr_user_id', userId)
      }
      return userId
    }
    return 'default_user'
  }

  static async createAnalysis(data: {
    name: string
    libraryType: string
    algorithms: string[]
    parameters: Record<string, unknown>
    fileNames: string[]
    sampleLabels: SampleLabel[]
  }): Promise<AnalysisRecord> {
    const userId = await this.getUserId()
    const id = `analysis_${Date.now()}_${Math.random().toString(36).substring(7)}`

    const record: AnalysisRecord = {
      id,
      user_id: userId,
      name: data.name,
      library_type: data.libraryType,
      algorithms: data.algorithms,
      status: 'created',
      progress: 0,
      current_step: 'Initializing...',
      parameters: data.parameters,
      results: null,
      logs: [],
      error_message: null,
      file_names: data.fileNames,
      sample_labels: data.sampleLabels,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      started_at: null,
      completed_at: null
    }

    if (isSupabaseConfigured) {
      const supabase = createClient()
      // Match live schema: library (not library_type), method (not algorithms), omit current_step if column missing
      // Normalize method to allowed DB values (analyses_method_check: mageck, bagel2, drugz)
      const rawMethod = (record.algorithms && record.algorithms[0]) || 'mageck';
      const method = normalizeAnalysisMethod(rawMethod);
      const { data: insertedData, error } = await (supabase.from('analyses') as any)
        .insert([{
          id: record.id,
          user_id: record.user_id,
          name: record.name,
          library: record.library_type,
          method,
          status: record.status,
          progress: record.progress,
          parameters: record.parameters,
          results: record.results,
          logs: record.logs,
          error_message: record.error_message,
          file_names: record.file_names,
          sample_labels: record.sample_labels,
          created_at: record.created_at,
          updated_at: record.updated_at,
          started_at: record.started_at,
          completed_at: record.completed_at
        }])
        .select()
        .single()

      if (error) {
        console.error('Supabase insert error:', error)
        this.saveToLocalStorage(record)
      }

      return insertedData || record
    } else {
      this.saveToLocalStorage(record)
      return record
    }
  }

  static async updateAnalysis(
    id: string,
    updates: Partial<AnalysisRecord>
  ): Promise<void> {
    const updateData = {
      ...updates,
      updated_at: new Date().toISOString()
    }

    if (isSupabaseConfigured) {
      const supabase = createClient()
      const { error } = await (supabase.from('analyses') as any)
        .update(updateData)
        .eq('id', id)

      if (error) {
        console.error('Supabase update error:', error)
        this.updateLocalStorage(id, updateData)
      }
    } else {
      this.updateLocalStorage(id, updateData)
    }
  }

  static async getAnalysis(id: string): Promise<AnalysisRecord | null> {
    if (isSupabaseConfigured) {
      const supabase = createClient()
      const { data, error } = await (supabase.from('analyses') as any)
        .select('*')
        .eq('id', id)
        .single()

      if (error || !data) {
        return this.getFromLocalStorage(id)
      }

      return data as AnalysisRecord
    } else {
      return this.getFromLocalStorage(id)
    }
  }

  static async listAnalyses(): Promise<AnalysisRecord[]> {
    const userId = await this.getUserId()

    if (isSupabaseConfigured) {
      const supabase = createClient()
      const { data, error } = await (supabase.from('analyses') as any)
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

      if (error || !data) {
        return this.getAllFromLocalStorage()
      }

      return data as AnalysisRecord[]
    } else {
      return this.getAllFromLocalStorage()
    }
  }

  static async deleteAnalysis(id: string): Promise<void> {
    if (isSupabaseConfigured) {
      const supabase = createClient()
      const { error } = await (supabase.from('analyses') as any)
        .delete()
        .eq('id', id)

      if (error) {
        console.error('Supabase delete error:', error)
      }
    }

    this.deleteFromLocalStorage(id)
  }

  // Local storage fallback methods
  private static getStorageKey(): string {
    return 'splicr_analyses'
  }

  private static saveToLocalStorage(record: AnalysisRecord): void {
    if (typeof window === 'undefined') return

    const stored = localStorage.getItem(this.getStorageKey())
    const analyses: AnalysisRecord[] = stored ? JSON.parse(stored) : []
    analyses.push(record)
    localStorage.setItem(this.getStorageKey(), JSON.stringify(analyses))
  }

  private static updateLocalStorage(id: string, updates: Partial<AnalysisRecord>): void {
    if (typeof window === 'undefined') return

    const stored = localStorage.getItem(this.getStorageKey())
    if (!stored) return

    const analyses: AnalysisRecord[] = JSON.parse(stored)
    const index = analyses.findIndex(a => a.id === id)

    if (index !== -1) {
      analyses[index] = { ...analyses[index], ...updates }
      localStorage.setItem(this.getStorageKey(), JSON.stringify(analyses))
    }
  }

  private static getFromLocalStorage(id: string): AnalysisRecord | null {
    if (typeof window === 'undefined') return null

    const stored = localStorage.getItem(this.getStorageKey())
    if (!stored) return null

    const analyses: AnalysisRecord[] = JSON.parse(stored)
    return analyses.find(a => a.id === id) || null
  }

  private static getAllFromLocalStorage(): AnalysisRecord[] {
    if (typeof window === 'undefined') return []

    const stored = localStorage.getItem(this.getStorageKey())
    if (!stored) return []

    const analyses: AnalysisRecord[] = JSON.parse(stored)
    return analyses.sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
  }

  private static deleteFromLocalStorage(id: string): void {
    if (typeof window === 'undefined') return

    const stored = localStorage.getItem(this.getStorageKey())
    if (!stored) return

    const analyses: AnalysisRecord[] = JSON.parse(stored)
    const filtered = analyses.filter(a => a.id !== id)
    localStorage.setItem(this.getStorageKey(), JSON.stringify(filtered))
  }
}

export default AnalysisDB
