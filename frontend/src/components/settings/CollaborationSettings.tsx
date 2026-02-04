'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/Button';
import {
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Users,
  Mail,
  Trash2,
  UserPlus,
  Crown,
  Shield,
  Eye,
  Edit,
  Globe,
  Send,
} from 'lucide-react';

interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  access_level: 'full' | 'edit' | 'view';
  joined_at: string;
  invited_by: string;
  status: 'active' | 'pending' | 'inactive';
}

interface CollaborationSettings {
  default_sharing_permission: 'private' | 'team_view' | 'team_edit';
  screen_sharing_notifications: boolean;
  allow_team_comments: boolean;
  public_profile_discoverable: boolean;
  show_research_interests: boolean;
  allow_contact: boolean;
  team_members: TeamMember[];
}

const ROLE_ICONS = {
  owner: Crown,
  admin: Shield,
  member: Users,
  viewer: Eye,
};

const ROLE_DESCRIPTIONS = {
  owner: 'Full access, can manage team and billing',
  admin: 'Can manage team members and settings',
  member: 'Can create and edit analyses',
  viewer: 'Can view shared analyses only',
};

export function CollaborationSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<TeamMember['role']>('member');
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [requestAccessEmail, setRequestAccessEmail] = useState('');
  const [requestAccessMessage, setRequestAccessMessage] = useState('');
  const [requestAccessSending, setRequestAccessSending] = useState(false);
  const [requestAccessSent, setRequestAccessSent] = useState(false);

  const [settings, setSettings] = useState<CollaborationSettings>({
    default_sharing_permission: 'private',
    screen_sharing_notifications: true,
    allow_team_comments: true,
    public_profile_discoverable: false,
    show_research_interests: true,
    allow_contact: true,
    team_members: [],
  });

  const supabase = createClient();

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  async function loadSettings() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('collaboration_settings')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading settings:', error);
        return;
      }

      if (data) {
        setSettings(prev => ({ ...prev, ...(data as Partial<CollaborationSettings>) } as CollaborationSettings));
      }

      // Load team members
      const { data: members } = await supabase
        .from('team_members')
        .select('*')
        .eq('team_owner_id', user.id)
        .order('joined_at', { ascending: false });

      if (members) {
        setSettings(prev => ({ ...prev, team_members: members }));
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    setSaving(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await (supabase
        .from('collaboration_settings') as any)
        .upsert({
          user_id: user.id,
          default_sharing_permission: settings.default_sharing_permission,
          screen_sharing_notifications: settings.screen_sharing_notifications,
          allow_team_comments: settings.allow_team_comments,
          public_profile_discoverable: settings.public_profile_discoverable,
          show_research_interests: settings.show_research_interests,
          allow_contact: settings.allow_contact,
          updated_at: new Date().toISOString(),
        });

      if (error) throw error;
      setSuccess(true);
    } catch (error: any) {
      console.error('Error saving settings:', error);
      setError(error.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  async function inviteTeamMember() {
    if (!inviteEmail) return;

    setSaving(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Send invitation
      const { error } = await (supabase
        .from('team_invitations') as any)
        .insert({
          team_owner_id: user.id,
          invitee_email: inviteEmail,
          role: inviteRole,
          status: 'pending',
          invited_at: new Date().toISOString(),
        });

      if (error) throw error;

      setSuccess(true);
      setInviteEmail('');
      setShowInviteForm(false);
      setInviteRole('member');
    } catch (error: any) {
      console.error('Error inviting member:', error);
      setError(error.message || 'Failed to send invitation');
    } finally {
      setSaving(false);
    }
  }

  async function removeMember(memberId: string) {
    try {
      const { error } = await supabase
        .from('team_members')
        .delete()
        .eq('id', memberId);

      if (error) throw error;

      setSettings(prev => ({
        ...prev,
        team_members: prev.team_members.filter(m => m.id !== memberId),
      }));
    } catch (error) {
      console.error('Error removing member:', error);
      setError('Failed to remove team member');
    }
  }

  async function sendAccessRequest() {
    const email = requestAccessEmail.trim();
    if (!email || !email.includes('@')) {
      setError('Please enter a valid PI email address.');
      return;
    }
    setRequestAccessSending(true);
    setError(null);
    setRequestAccessSent(false);
    try {
      const res = await fetch('/api/access-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pi_email: email,
          message: requestAccessMessage.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to send request');
      setRequestAccessSent(true);
      setRequestAccessEmail('');
      setRequestAccessMessage('');
      setSuccess(true);
      setTimeout(() => setRequestAccessSent(false), 5000);
    } catch (e: any) {
      setError(e.message || 'Failed to send access request');
    } finally {
      setRequestAccessSending(false);
    }
  }

  async function updateMemberRole(memberId: string, newRole: TeamMember['role']) {
    try {
      const { error } = await (supabase
        .from('team_members') as any)
        .update({ role: newRole })
        .eq('id', memberId);

      if (error) throw error;

      setSettings(prev => ({
        ...prev,
        team_members: prev.team_members.map(m =>
          m.id === memberId ? { ...m, role: newRole } : m
        ),
      }));
    } catch (error) {
      console.error('Error updating role:', error);
      setError('Failed to update member role');
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
          <Users className="w-6 h-6" />
          Collaboration & Sharing
        </h2>
        <p className="text-sm text-text-secondary">
          Manage team members, sharing permissions, and collaboration settings
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
          <CheckCircle2 className="w-5 h-5" />
          <span className="text-sm">Settings saved successfully!</span>
        </div>
      )}

      {/* Team Members */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-serif text-text-primary">Team Members</h3>
          <Button
            onClick={() => setShowInviteForm(!showInviteForm)}
            variant="secondary"
            size="sm"
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Invite member
          </Button>
        </div>

        {showInviteForm && (
          <div className="mb-6 p-4 bg-background rounded-lg border border-border">
            <h4 className="text-sm font-serif text-text-primary mb-3">Invite Team Member</h4>
            <div className="flex gap-2 mb-3">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@university.edu"
                className="flex-1 px-4 py-2 bg-surface border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as TeamMember['role'])}
                className="px-4 py-2 bg-surface border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
            <div className="flex gap-2">
              <Button onClick={inviteTeamMember} disabled={!inviteEmail || saving} size="sm">
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}
                Send invitation
              </Button>
              <Button onClick={() => setShowInviteForm(false)} variant="secondary" size="sm">
                Cancel
              </Button>
            </div>
          </div>
        )}

        {settings.team_members.length > 0 ? (
          <div className="space-y-2">
            {settings.team_members.map((member) => {
              const RoleIcon = ROLE_ICONS[member.role];
              return (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-4 bg-background rounded-lg border border-border"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center">
                      <RoleIcon className="w-5 h-5 text-accent" />
                    </div>
                    <div>
                      <h4 className="font-serif text-text-primary font-medium">{member.name || member.email}</h4>
                      <div className="flex items-center gap-2 text-xs text-text-tertiary">
                        <span>{member.email}</span>
                        <span>•</span>
                        <span className="capitalize">{member.role}</span>
                        <span>•</span>
                        <span className={member.status === 'active' ? 'text-green-500' : 'text-yellow-500'}>
                          {member.status}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {member.role !== 'owner' && (
                      <>
                        <select
                          value={member.role}
                          onChange={(e) => updateMemberRole(member.id, e.target.value as TeamMember['role'])}
                          className="px-3 py-1 bg-surface border border-border rounded text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                        >
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                          <option value="viewer">Viewer</option>
                        </select>
                        <button
                          onClick={() => removeMember(member.id)}
                          className="p-2 text-text-secondary hover:text-error transition-colors"
                          title="Remove member"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-text-tertiary">
            <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No team members yet. Invite colleagues to collaborate!</p>
          </div>
        )}
      </div>

      {/* Request Access (notify PI) */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4 flex items-center gap-2">
          <Send className="w-5 h-5" />
          Request access
        </h3>
        <p className="text-sm text-text-secondary mb-4">
          Send a request to a PI or lab owner. They will receive an in-app notification and an email (if email is configured).
        </p>
        <div className="space-y-3 max-w-md">
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">PI or lab owner email</label>
            <input
              type="email"
              value={requestAccessEmail}
              onChange={(e) => setRequestAccessEmail(e.target.value)}
              placeholder="pi@university.edu"
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Message (optional)</label>
            <textarea
              value={requestAccessMessage}
              onChange={(e) => setRequestAccessMessage(e.target.value)}
              placeholder="I would like to request access to..."
              rows={2}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent resize-none"
            />
          </div>
          <Button
            onClick={sendAccessRequest}
            disabled={requestAccessSending || !requestAccessEmail.trim()}
            size="sm"
          >
            {requestAccessSending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
            Send request
          </Button>
          {requestAccessSent && (
            <p className="text-sm text-green-600 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              Request sent. The PI will be notified.
            </p>
          )}
        </div>
      </div>

      {/* Sharing Permissions */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Default Sharing Permissions</h3>

        <div className="grid grid-cols-3 gap-3 mb-4">
          {(['private', 'team_view', 'team_edit'] as const).map((permission) => (
            <button
              key={permission}
              onClick={() => setSettings({ ...settings, default_sharing_permission: permission })}
              className={`p-4 rounded-lg border-2 transition-all ${
                settings.default_sharing_permission === permission
                  ? 'border-accent bg-accent/5'
                  : 'border-border hover:border-accent/50'
              }`}
            >
              <div className="text-center">
                {permission === 'private' && <Shield className="w-6 h-6 mx-auto mb-2 text-text-primary" />}
                {permission === 'team_view' && <Eye className="w-6 h-6 mx-auto mb-2 text-text-primary" />}
                {permission === 'team_edit' && <Edit className="w-6 h-6 mx-auto mb-2 text-text-primary" />}
                <h4 className="text-sm font-medium text-text-primary capitalize">
                  {permission.replace('_', ' ')}
                </h4>
              </div>
            </button>
          ))}
        </div>

        <p className="text-xs text-text-tertiary">
          New analyses will default to this sharing permission. You can change it for individual analyses.
        </p>
      </div>

      {/* Collaboration Preferences */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Collaboration Preferences</h3>

        <div className="space-y-3">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-medium text-text-primary">Screen sharing notifications</p>
              <p className="text-xs text-text-tertiary">Get notified when someone shares an analysis with you</p>
            </div>
            <button
              onClick={() => setSettings({ ...settings, screen_sharing_notifications: !settings.screen_sharing_notifications })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.screen_sharing_notifications ? 'bg-accent' : 'bg-border'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                settings.screen_sharing_notifications ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-medium text-text-primary">Allow team comments</p>
              <p className="text-xs text-text-tertiary">Team members can comment on shared analyses</p>
            </div>
            <button
              onClick={() => setSettings({ ...settings, allow_team_comments: !settings.allow_team_comments })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.allow_team_comments ? 'bg-accent' : 'bg-border'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                settings.allow_team_comments ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </label>
        </div>
      </div>

      {/* Public Profile */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4 flex items-center gap-2">
          <Globe className="w-5 h-5" />
          Public Profile
        </h3>

        <div className="space-y-3">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-medium text-text-primary">Make profile discoverable</p>
              <p className="text-xs text-text-tertiary">Allow other researchers to find your profile</p>
            </div>
            <button
              onClick={() => setSettings({ ...settings, public_profile_discoverable: !settings.public_profile_discoverable })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.public_profile_discoverable ? 'bg-accent' : 'bg-border'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                settings.public_profile_discoverable ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </label>

          {settings.public_profile_discoverable && (
            <>
              <label className="flex items-center justify-between cursor-pointer ml-6">
                <div>
                  <p className="text-sm font-medium text-text-primary">Show research interests</p>
                  <p className="text-xs text-text-tertiary">Display your research areas publicly</p>
                </div>
                <button
                  onClick={() => setSettings({ ...settings, show_research_interests: !settings.show_research_interests })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings.show_research_interests ? 'bg-accent' : 'bg-border'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.show_research_interests ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </label>

              <label className="flex items-center justify-between cursor-pointer ml-6">
                <div>
                  <p className="text-sm font-medium text-text-primary">Allow contact</p>
                  <p className="text-xs text-text-tertiary">Let others send collaboration requests</p>
                </div>
                <button
                  onClick={() => setSettings({ ...settings, allow_contact: !settings.allow_contact })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings.allow_contact ? 'bg-accent' : 'bg-border'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.allow_contact ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </label>
            </>
          )}
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end pt-4 border-t border-border">
        <Button onClick={saveSettings} disabled={saving} size="lg">
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save collaboration settings
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
