'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/Button';
import InstitutionAutocomplete from '@/components/InstitutionAutocomplete';
import {
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  User,
  Mail,
  Building2,
  Briefcase,
  Upload,
  Trash2,
  ExternalLink,
  GraduationCap,
  Link2,
  Copy,
  Check,
} from 'lucide-react';
import { AvatarCropModal } from '@/components/AvatarCropModal';

interface ProfileData {
  full_name: string;
  display_name: string;
  email: string;
  institution: string;
  department_lab: string;
  orcid_id: string;
  research_areas: string[];
  team_role: string;
  profile_visibility: 'public' | 'team' | 'private';
  timezone: string;
  avatar_url: string | null;
}

/** Shape of a profile row from DB (select *). Matches public.profiles: lab_name, role; optional columns from migration. */
type ProfileRow = {
  id?: string;
  email?: string;
  full_name?: string | null;
  display_name?: string | null;
  institution?: string | null;
  lab_name?: string | null;
  role?: string | null;
  orcid_id?: string | null;
  orcid_verified?: boolean;
  research_areas?: string[] | null;
  profile_visibility?: 'public' | 'team' | 'private' | null;
  timezone?: string | null;
  avatar_url?: string | null;
  created_at?: string;
  updated_at?: string;
};

/** Shape of users row fields we read for public profile. */
type UsersPublicProfileRow = {
  public_profile_id?: string | null;
  public_profile_enabled?: boolean;
};

const RESEARCH_AREAS = [
  'Cancer Biology',
  'Genetics',
  'Drug Discovery',
  'Immunology',
  'Neuroscience',
  'Developmental Biology',
  'Synthetic Biology',
  'Gene Therapy',
  'Metabolic Engineering',
  'Structural Biology',
  'Systems Biology',
  'Microbiology',
];

const TEAM_ROLES = [
  'Principal Investigator',
  'Post-doctoral Researcher',
  'Graduate Student',
  'Research Associate',
  'Core Facility Manager',
  'Lab Technician',
  'Undergraduate Researcher',
  'Research Assistant',
];

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Australia/Sydney',
];

export function ProfileSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [orcidVerified, setOrcidVerified] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [publicProfileId, setPublicProfileId] = useState<string | null>(null);
  const [publicProfileEnabled, setPublicProfileEnabled] = useState(false);
  const [updatingPublicProfile, setUpdatingPublicProfile] = useState(false);
  const [copied, setCopied] = useState(false);

  const [profile, setProfile] = useState<ProfileData>({
    full_name: '',
    display_name: '',
    email: '',
    institution: '',
    department_lab: '',
    orcid_id: '',
    research_areas: [],
    team_role: '',
    profile_visibility: 'private',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
    avatar_url: null,
  });

  const supabase = createClient();

  useEffect(() => {
    loadProfile();
  }, []);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  async function loadProfile() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [profilesRes, usersRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('users').select('public_profile_id, public_profile_enabled').eq('id', user.id).maybeSingle(),
      ]);
      const { data: rawData, error } = profilesRes;
      const data = rawData as ProfileRow | null;
      const usersData = usersRes.data as UsersPublicProfileRow | null;

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading profile:', error);
        return;
      }

      if (usersData) {
        setPublicProfileId(usersData.public_profile_id ?? null);
        setPublicProfileEnabled(!!usersData.public_profile_enabled);
      }

      const meta = user.user_metadata || {};
      const fromAuth = meta.full_name || meta.name || user.email?.split('@')[0] || '';
      if (data) {
        setProfile({
          full_name: data.full_name || fromAuth || '',
          display_name: (data.display_name ?? data.full_name ?? fromAuth) || '',
          email: user.email || '',
          institution: data.institution || '',
          department_lab: data.lab_name ?? '',
          orcid_id: data.orcid_id || '',
          research_areas: Array.isArray(data.research_areas) ? data.research_areas : [],
          team_role: data.role ?? '',
          profile_visibility: (data.profile_visibility as ProfileData['profile_visibility']) || 'private',
          timezone: data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
          avatar_url: data.avatar_url || null,
        });
        setOrcidVerified(!!data.orcid_verified);
      } else {
        const autoDetectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        setProfile(prev => ({
          ...prev,
          full_name: fromAuth,
          display_name: fromAuth,
          email: user.email || '',
          timezone: autoDetectedTimezone,
        }));
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile() {
    setSaving(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const basePayload = {
          id: user.id,
          email: user.email,
          full_name: profile.full_name || null,
          institution: profile.institution || null,
          lab_name: profile.department_lab || null,
          role: profile.team_role || null,
          avatar_url: profile.avatar_url,
          orcid_verified: orcidVerified,
          updated_at: new Date().toISOString(),
        };
      const extendedPayload = {
          ...basePayload,
          display_name: profile.display_name || profile.full_name || null,
          orcid_id: profile.orcid_id || null,
          research_areas: profile.research_areas?.length ? profile.research_areas : null,
          profile_visibility: profile.profile_visibility,
          timezone: profile.timezone,
        };
      let result = await (supabase.from('profiles') as any).upsert(extendedPayload);
      if (result.error) {
        const msg = result.error.message || '';
        if (msg.includes('column') && msg.includes('does not exist')) {
          result = await (supabase.from('profiles') as any).upsert(basePayload);
        }
        if (result.error) throw result.error;
      }

      setSuccess(true);
    } catch (error: any) {
      console.error('Error saving profile:', error);
      setError(error.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  }

  function handleAvatarFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be less than 5MB');
      e.target.value = '';
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('File must be an image (JPEG, PNG, GIF, or WebP)');
      e.target.value = '';
      return;
    }

    setError(null);
    const objectUrl = URL.createObjectURL(file);
    setCropImageSrc(objectUrl);
    e.target.value = '';
  }

  async function handleAvatarCropSave(blob: Blob) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    setUploadingAvatar(true);
    setError(null);
    try {
      const fileExt = blob.type === 'image/png' ? 'png' : 'jpg';
      const fileName = `${user.id}-${Date.now()}.${fileExt}`;
      const filePath = `avatars/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('user-uploads')
        .upload(filePath, blob, {
          cacheControl: '3600',
          upsert: true,
          contentType: blob.type,
        });

      if (uploadError) {
        if (uploadError.message?.toLowerCase().includes('bucket') && uploadError.message?.toLowerCase().includes('not found')) {
          setError('Storage bucket is not set up. Please create a bucket named "user-uploads" in Supabase Dashboard (Storage) and run the storage migration, or contact support.');
        } else {
          throw uploadError;
        }
        return;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('user-uploads')
        .getPublicUrl(filePath);

      setProfile(prev => ({ ...prev, avatar_url: publicUrl }));

      // Use upsert so avatar saves even if the profiles row doesn't exist yet
      const { error: updateError } = await (supabase.from('profiles') as any)
        .upsert({
          id: user.id,
          email: user.email,
          avatar_url: publicUrl,
          updated_at: new Date().toISOString(),
        });
      if (updateError) {
        console.error('Failed to save avatar to profile:', updateError);
        setError('Avatar uploaded but failed to save to profile. Try saving your profile.');
      }

      // Keep users.avatar_url in sync for any consumers that read from users
      await (supabase.from('users') as any)
        .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
        .eq('id', user.id);

      if (!updateError && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('profile-updated'));
      }

      setSuccess(true);
    } catch (err: unknown) {
      console.error('Error uploading avatar:', err);
      setError(err instanceof Error ? err.message : 'Failed to upload avatar');
      throw err;
    } finally {
      setUploadingAvatar(false);
    }
  }

  function closeCropModal() {
    if (cropImageSrc) {
      URL.revokeObjectURL(cropImageSrc);
      setCropImageSrc(null);
    }
  }

  function toggleResearchArea(area: string) {
    setProfile(prev => ({
      ...prev,
      research_areas: prev.research_areas.includes(area)
        ? prev.research_areas.filter(a => a !== area)
        : [...prev.research_areas, area],
    }));
  }

  async function verifyOrcid() {
    const raw = profile.orcid_id?.trim().replace(/\s/g, '');
    if (!raw) return;

    setError(null);
    setSaving(true);
    try {
      const base = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await fetch(`${base}/api/orcid/verify?orcid=${encodeURIComponent(raw)}`);
      const data = await res.json().catch(() => ({}));

      if (!data.valid || !data.orcid) {
        setError('ORCID iD not found. Check the format (e.g. 0000-0000-0000-0000) and try again.');
        return;
      }

      setProfile(prev => ({ ...prev, orcid_id: data.orcid }));
      setOrcidVerified(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await (supabase.from('profiles') as any).upsert({
          id: user.id,
          email: user.email,
          orcid_id: data.orcid,
          orcid_verified: true,
          updated_at: new Date().toISOString(),
        });
      }
      setSuccess(true);
    } catch (e: any) {
      setError(e.message || 'Verification failed. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-serif text-text-primary mb-2 flex items-center gap-2">
          <User className="w-6 h-6" />
          Profile & Account
        </h2>
        <p className="text-sm text-text-secondary">
          Manage your personal information and research profile
        </p>
      </div>

      {/* Toast Messages */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500">
          <AlertCircle className="w-5 h-5" />
          <span className="text-sm">{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 p-4 bg-green-500/10 border border-green-500/20 rounded-xl text-green-500">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">Profile saved successfully!</span>
        </div>
      )}

      {/* Avatar & Basic Info */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Basic Information</h3>

        <div className="flex items-start gap-6 mb-6">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative w-24 h-24 rounded-full bg-background border-2 border-border overflow-hidden flex items-center justify-center">
              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt="Profile"
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-12 h-12 text-text-tertiary" />
              )}
            </div>
            <label className="cursor-pointer">
              <input
                type="file"
                accept="image/*"
                onChange={handleAvatarFileSelect}
                className="hidden"
                disabled={uploadingAvatar || !!cropImageSrc}
              />
              <div className="flex items-center gap-2 px-3 py-1.5 bg-background border border-border rounded-lg text-sm text-text-primary hover:bg-surface transition-colors">
                {uploadingAvatar ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Upload
                  </>
                )}
              </div>
            </label>
            {profile.avatar_url && (
              <button
                type="button"
                onClick={async () => {
                  setProfile(prev => ({ ...prev, avatar_url: null }));
                  const { data: { user } } = await supabase.auth.getUser();
                  if (user) {
                    await (supabase.from('profiles') as any).upsert({ id: user.id, email: user.email, avatar_url: null, updated_at: new Date().toISOString() });
                    await (supabase.from('users') as any).update({ avatar_url: null, updated_at: new Date().toISOString() }).eq('id', user.id);
                    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('profile-updated'));
                  }
                }}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-error hover:bg-error/10 rounded-lg transition-colors"
                aria-label="Delete picture"
              >
                <Trash2 className="w-4 h-4" />
                Delete picture
              </button>
            )}
            <p className="text-xs text-text-tertiary text-center">Max 5MB.</p>
          </div>

          {cropImageSrc && (
            <AvatarCropModal
              imageSrc={cropImageSrc}
              onSave={handleAvatarCropSave}
              onCancel={closeCropModal}
            />
          )}

          {/* Basic Fields */}
          <div className="flex-1 space-y-4">
            <div>
              <label className="block text-sm font-serif text-text-secondary mb-2">
                Full Name
              </label>
              <input
                type="text"
                value={profile.full_name}
                onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
                className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="Your full name"
              />
            </div>
            <div>
              <label className="block text-sm font-serif text-text-secondary mb-2">
                Display Name
                <span className="text-xs text-text-tertiary ml-2">(shown to others)</span>
              </label>
              <input
                type="text"
                value={profile.display_name}
                onChange={(e) => setProfile({ ...profile, display_name: e.target.value })}
                maxLength={50}
                className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder={profile.full_name || 'Your display name'}
              />
              <p className="text-xs text-text-tertiary mt-1">
                {profile.display_name.length}/50 characters
              </p>
            </div>

            <div>
              <label className="block text-sm font-serif text-text-secondary mb-2 flex items-center gap-2">
                <Mail className="w-4 h-4" />
                Email
              </label>
              <input
                type="email"
                value={profile.email}
                readOnly
                className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary opacity-60 cursor-not-allowed"
              />
              <p className="text-xs text-text-tertiary mt-1">Email is managed by your account</p>
            </div>
          </div>
        </div>

        {/* Display Preferences */}
        <div className="pt-4 border-t border-border">
          <label className="block text-sm font-serif text-text-secondary mb-2">
            Profile Visibility
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(['public', 'team', 'private'] as const).map((visibility) => (
              <button
                key={visibility}
                onClick={() => setProfile({ ...profile, profile_visibility: visibility })}
                className={`px-4 py-2 rounded-lg text-sm font-serif transition-colors ${
                  profile.profile_visibility === visibility
                    ? 'bg-accent text-text-primary'
                    : 'bg-background border border-border text-text-secondary hover:bg-surface'
                }`}
              >
                {visibility.charAt(0).toUpperCase() + visibility.slice(1)}
              </button>
            ))}
          </div>
          <p className="text-xs text-text-tertiary mt-2">
            {profile.profile_visibility === 'public' && 'Your profile is visible to everyone'}
            {profile.profile_visibility === 'team' && 'Only your team members can see your profile'}
            {profile.profile_visibility === 'private' && 'Your profile is only visible to you'}
          </p>
        </div>

        {/* Public profile URL (unique per user, stored in backend) */}
        <div className="pt-4 mt-4 border-t border-border">
          <h3 className="text-sm font-serif text-text-primary mb-2 flex items-center gap-2">
            <Link2 className="w-4 h-4" />
            Public profile link
          </h3>
          <p className="text-xs text-text-secondary mb-3">
            When enabled, anyone signed in can view your profile, published analyses, and results at this URL.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={publicProfileEnabled}
                disabled={updatingPublicProfile || !publicProfileId}
                onChange={async () => {
                  setUpdatingPublicProfile(true);
                  setError(null);
                  try {
                    const { data: { user } } = await supabase.auth.getUser();
                    if (!user) return;
                    const { error: updateError } = await (supabase.from('users') as any)
                      .update({ public_profile_enabled: !publicProfileEnabled })
                      .eq('id', user.id);
                    if (updateError) throw updateError;
                    setPublicProfileEnabled(!publicProfileEnabled);
                    setSuccess(true);
                  } catch (e: unknown) {
                    setError(e instanceof Error ? e.message : 'Failed to update');
                  } finally {
                    setUpdatingPublicProfile(false);
                  }
                }}
                className="rounded border-border bg-background text-accent focus:ring-accent"
              />
              <span className="text-sm text-text-primary">Enable public profile</span>
            </label>
            {updatingPublicProfile && <Loader2 className="w-4 h-4 animate-spin text-text-tertiary" />}
          </div>
          {publicProfileId && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="text"
                readOnly
                value={typeof window !== 'undefined' ? `${window.location.origin}/profile/${publicProfileId}` : `/profile/${publicProfileId}`}
                className="flex-1 min-w-[200px] px-3 py-2 bg-background border border-border rounded-lg text-sm text-text-primary font-mono"
              />
              <button
                type="button"
                onClick={() => {
                  const url = typeof window !== 'undefined' ? `${window.location.origin}/profile/${publicProfileId}` : '';
                  if (url && navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(url);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }
                }}
                className="inline-flex items-center gap-2 px-3 py-2 bg-background border border-border rounded-lg text-sm text-text-primary hover:bg-surface transition-colors"
              >
                {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          )}
          {!publicProfileId && !loading && (
            <p className="text-xs text-text-tertiary mt-2">Your unique profile ID is generated when you save; refresh the page if you don’t see it yet.</p>
          )}
        </div>
      </div>

      {/* Institution & Team */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4 flex items-center gap-2">
          <Building2 className="w-5 h-5" />
          Institution & Team
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">
              Institution
            </label>
            <InstitutionAutocomplete
              value={profile.institution}
              onChange={(value) => setProfile({ ...profile, institution: value })}
              required={false}
              placeholder="Search for your institution..."
            />
          </div>

          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">
              Department / Lab Name
            </label>
            <input
              type="text"
              value={profile.department_lab}
              onChange={(e) => setProfile({ ...profile, department_lab: e.target.value })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="e.g., Cancer Biology Lab"
            />
          </div>

          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2 flex items-center gap-2">
              <Briefcase className="w-4 h-4" />
              Team Role
            </label>
            <select
              value={profile.team_role}
              onChange={(e) => setProfile({ ...profile, team_role: e.target.value })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">Select role...</option>
              {TEAM_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2 flex items-center gap-2">
              Timezone
              <button
                onClick={() => {
                  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
                  setProfile({ ...profile, timezone: detected });
                }}
                className="text-xs text-accent hover:underline"
                type="button"
              >
                Auto-detect
              </button>
            </label>
            <select
              value={profile.timezone}
              onChange={(e) => setProfile({ ...profile, timezone: e.target.value })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <p className="text-xs text-text-tertiary mt-1">
              Current: {Intl.DateTimeFormat('en-US', { timeZone: profile.timezone, timeStyle: 'short' }).format(new Date())}
            </p>
          </div>
        </div>
      </div>

      {/* ORCID Integration */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4 flex items-center gap-2">
          <GraduationCap className="w-5 h-5" />
          ORCID Integration
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">
              ORCID iD
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={profile.orcid_id}
                onChange={(e) => setProfile({ ...profile, orcid_id: e.target.value })}
                className="flex-1 px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="0000-0000-0000-0000"
              />
              {orcidVerified ? (
                <div className="flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/20 rounded-lg text-green-500">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="text-sm">Verified</span>
                </div>
              ) : (
                <Button onClick={verifyOrcid} disabled={!profile.orcid_id} variant="secondary">
                  Verify
                </Button>
              )}
              {profile.orcid_id && (
                <a
                  href={`https://orcid.org/${profile.orcid_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center px-3 py-2 border border-border rounded-lg text-text-secondary hover:bg-background transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
            <p className="text-xs text-text-tertiary mt-1.5">
              Connect your ORCID to sync publications and enhance discoverability
            </p>
          </div>
        </div>
      </div>

      {/* Research Areas */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Research Areas</h3>
        <p className="text-sm text-text-secondary mb-4">
          Select all areas relevant to your research (multi-select)
        </p>

        <div className="flex flex-wrap gap-2">
          {RESEARCH_AREAS.map((area) => (
            <button
              key={area}
              onClick={() => toggleResearchArea(area)}
              className={`px-4 py-2 rounded-lg text-sm font-serif transition-colors ${
                profile.research_areas.includes(area)
                  ? 'bg-accent text-text-primary'
                  : 'bg-background border border-border text-text-secondary hover:bg-surface'
              }`}
            >
              {area}
            </button>
          ))}
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end pt-4 border-t border-border">
        <Button onClick={saveProfile} disabled={saving} size="lg">
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save profile
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
