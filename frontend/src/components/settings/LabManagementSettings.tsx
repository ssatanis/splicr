'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/Button';
import {
  Users, Loader2, CheckCircle2, AlertCircle, Copy, Plus, LogOut,
  RefreshCw, Trash2, Shield, Crown, Eye, ChevronDown, ChevronUp,
  ExternalLink, Mail, Calendar
} from 'lucide-react';
import type {
  LabMembershipInfo, Lab, LabMember, CreateLabRequest,
  JoinLabRequest, LabRole
} from '@/lib/types';

type TabType = 'info' | 'members' | 'analyses';

export function LabManagementSettings() {
  // State management
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [membership, setMembership] = useState<LabMembershipInfo | null>(null);
  const [members, setMembers] = useState<LabMember[]>([]);
  const [labAnalyses, setLabAnalyses] = useState<any[]>([]);

  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('info');

  // Join lab form
  const [joinCode, setJoinCode] = useState('');
  const [joinTitle, setJoinTitle] = useState('');
  const [joiningLab, setJoiningLab] = useState(false);

  // Create lab form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createLabForm, setCreateLabForm] = useState<CreateLabRequest>({
    name: '',
    department: '',
    institution: '',
    lab_website: '',
  });
  const [creatingLab, setCreatingLab] = useState(false);

  // Confirmation dialogs
  const [confirmAction, setConfirmAction] = useState<{
    type: 'leave' | 'remove' | 'regenerate' | null;
    data?: any;
  }>({ type: null });

  const supabase = createClient();

  // Auto-dismiss success messages
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  // Load membership on mount
  useEffect(() => {
    loadMembership();
  }, []);

  // Load members and analyses when in lab
  useEffect(() => {
    if (membership?.inLab && membership.lab) {
      loadMembers();
      loadAnalyses();
    }
  }, [membership?.inLab, membership?.lab?.id]);

  async function loadMembership() {
    try {
      setLoading(true);
      const response = await fetch('/api/labs/me');
      const data = await response.json();

      if (response.ok) {
        setMembership(data);
      } else {
        setError(data.error || 'Failed to load lab membership');
      }
    } catch (error) {
      console.error('Load membership error:', error);
      setError('Failed to load lab membership');
    } finally {
      setLoading(false);
    }
  }

  async function loadMembers() {
    if (!membership?.lab?.id) return;

    try {
      const response = await fetch(`/api/labs/${membership.lab.id}/members`);
      const data = await response.json();

      if (response.ok) {
        setMembers(data.members || []);
      }
    } catch (error) {
      console.error('Load members error:', error);
    }
  }

  async function loadAnalyses() {
    if (!membership?.lab?.id) return;

    try {
      const response = await fetch(`/api/labs/${membership.lab.id}/analyses`);
      const data = await response.json();

      if (response.ok) {
        setLabAnalyses(data.analyses || []);
      }
    } catch (error) {
      console.error('Load analyses error:', error);
    }
  }

  async function handleJoinLab() {
    setError(null);
    setJoiningLab(true);

    try {
      const response = await fetch('/api/labs/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invite_code: joinCode.trim(),
          title: joinTitle.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess(`Successfully joined ${data.lab.name}!`);
        setJoinCode('');
        setJoinTitle('');
        await loadMembership();
      } else {
        setError(data.error || 'Failed to join lab');
      }
    } catch (error) {
      console.error('Join lab error:', error);
      setError('Failed to join lab');
    } finally {
      setJoiningLab(false);
    }
  }

  async function handleCreateLab() {
    setError(null);
    setCreatingLab(true);

    try {
      const response = await fetch('/api/labs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createLabForm),
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess(data.message);
        setShowCreateForm(false);
        setCreateLabForm({ name: '', department: '', institution: '', lab_website: '' });
        await loadMembership();
      } else {
        setError(data.error || 'Failed to create lab');
      }
    } catch (error) {
      console.error('Create lab error:', error);
      setError('Failed to create lab');
    } finally {
      setCreatingLab(false);
    }
  }

  async function handleLeaveLab() {
    setError(null);
    setSaving(true);

    try {
      const response = await fetch('/api/labs/leave', { method: 'DELETE' });
      const data = await response.json();

      if (response.ok) {
        setSuccess(data.message);
        setConfirmAction({ type: null });
        await loadMembership();
      } else {
        setError(data.error || 'Failed to leave lab');
      }
    } catch (error) {
      console.error('Leave lab error:', error);
      setError('Failed to leave lab');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateMemberRole(userId: string, newRole: LabRole) {
    setError(null);
    setSaving(true);

    try {
      const response = await fetch(`/api/labs/${membership?.lab?.id}/members/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess('Member role updated');
        await loadMembers();
      } else {
        setError(data.error || 'Failed to update role');
      }
    } catch (error) {
      console.error('Update role error:', error);
      setError('Failed to update role');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveMember(userId: string) {
    setError(null);
    setSaving(true);

    try {
      const response = await fetch(`/api/labs/${membership?.lab?.id}/members/${userId}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess('Member removed from lab');
        setConfirmAction({ type: null });
        await loadMembers();
      } else {
        setError(data.error || 'Failed to remove member');
      }
    } catch (error) {
      console.error('Remove member error:', error);
      setError('Failed to remove member');
    } finally {
      setSaving(false);
    }
  }

  async function handleRegenerateCode() {
    setError(null);
    setSaving(true);

    try {
      const response = await fetch(`/api/labs/${membership?.lab?.id}/regenerate-code`, {
        method: 'POST',
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess(`New invite code: ${data.invite_code}`);
        setConfirmAction({ type: null });
        await loadMembership();
      } else {
        setError(data.error || 'Failed to regenerate code');
      }
    } catch (error) {
      console.error('Regenerate code error:', error);
      setError('Failed to regenerate code');
    } finally {
      setSaving(false);
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setSuccess('Copied to clipboard!');
  }

  function getRoleBadgeColor(role: LabRole) {
    switch (role) {
      case 'pi':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'admin':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'member':
        return 'bg-gray-100 text-gray-800 border-gray-200';
      case 'guest':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  }

  function getRoleIcon(role: LabRole) {
    switch (role) {
      case 'pi':
        return <Crown className="w-3 h-3" />;
      case 'admin':
        return <Shield className="w-3 h-3" />;
      case 'member':
        return <Users className="w-3 h-3" />;
      case 'guest':
        return <Eye className="w-3 h-3" />;
      default:
        return <Users className="w-3 h-3" />;
    }
  }

  const canManageMembers = membership?.role === 'pi' || membership?.role === 'admin';

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
        <h2 className="text-2xl font-serif text-text-primary mb-2">Lab & Team</h2>
        <p className="text-sm text-text-secondary">
          {membership?.inLab
            ? 'Manage your lab, invite members, and collaborate on analyses'
            : 'Join a research lab or create your own to collaborate with your team'}
        </p>
      </div>

      {/* Toast Messages */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 p-4 bg-green-500/10 border border-green-500/20 rounded-xl text-green-500">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">{success}</span>
        </div>
      )}

      {/* NOT IN LAB VIEW */}
      {!membership?.inLab && (
        <div className="space-y-6">
          {/* Join Lab Card */}
          <div className="bg-surface rounded-xl p-6 border border-border">
            <h3 className="text-lg font-serif text-text-primary mb-4 flex items-center gap-2">
              <Users className="w-5 h-5" />
              Join a Lab
            </h3>
            <p className="text-sm text-text-secondary mb-4">
              Enter a 6-character invite code to join your research team
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-serif text-text-secondary mb-2">
                  Invite Code
                </label>
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary uppercase focus:outline-none focus:ring-2 focus:ring-accent"
                  placeholder="ABC123"
                />
              </div>

              <div>
                <label className="block text-sm font-serif text-text-secondary mb-2">
                  Your Title <span className="text-text-tertiary">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={joinTitle}
                  onChange={(e) => setJoinTitle(e.target.value)}
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                  placeholder="e.g., Postdoc, PhD Student"
                />
              </div>

              <Button
                onClick={handleJoinLab}
                disabled={!joinCode.trim() || joinCode.length !== 6 || joiningLab}
                className="w-full"
              >
                {joiningLab ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Joining...
                  </>
                ) : (
                  <>
                    <Users className="w-4 h-4 mr-2" />
                    Join Lab
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Create Lab Card */}
          <div className="bg-surface rounded-xl p-6 border border-border">
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="w-full flex items-center justify-between text-left"
            >
              <div>
                <h3 className="text-lg font-serif text-text-primary mb-1 flex items-center gap-2">
                  <Plus className="w-5 h-5" />
                  Create Your Lab
                </h3>
                <p className="text-sm text-text-secondary">
                  Start a new lab and invite your team members
                </p>
              </div>
              {showCreateForm ? (
                <ChevronUp className="w-5 h-5 text-text-tertiary" />
              ) : (
                <ChevronDown className="w-5 h-5 text-text-tertiary" />
              )}
            </button>

            {showCreateForm && (
              <div className="mt-6 space-y-4 pt-6 border-t border-border">
                <div>
                  <label className="block text-sm font-serif text-text-secondary mb-2">
                    Lab Name <span className="text-error">*</span>
                  </label>
                  <input
                    type="text"
                    value={createLabForm.name}
                    onChange={(e) => setCreateLabForm({ ...createLabForm, name: e.target.value })}
                    maxLength={200}
                    className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                    placeholder="Smith Lab"
                  />
                </div>

                <div>
                  <label className="block text-sm font-serif text-text-secondary mb-2">
                    Department
                  </label>
                  <input
                    type="text"
                    value={createLabForm.department}
                    onChange={(e) => setCreateLabForm({ ...createLabForm, department: e.target.value })}
                    className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                    placeholder="Molecular Biology"
                  />
                </div>

                <div>
                  <label className="block text-sm font-serif text-text-secondary mb-2">
                    Institution
                  </label>
                  <input
                    type="text"
                    value={createLabForm.institution}
                    onChange={(e) => setCreateLabForm({ ...createLabForm, institution: e.target.value })}
                    className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                    placeholder="Cornell University"
                  />
                </div>

                <div>
                  <label className="block text-sm font-serif text-text-secondary mb-2">
                    Lab Website
                  </label>
                  <input
                    type="url"
                    value={createLabForm.lab_website}
                    onChange={(e) => setCreateLabForm({ ...createLabForm, lab_website: e.target.value })}
                    className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                    placeholder="https://smithlab.cornell.edu"
                  />
                </div>

                <Button
                  onClick={handleCreateLab}
                  disabled={!createLabForm.name.trim() || creatingLab}
                  className="w-full"
                >
                  {creatingLab ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating Lab...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4 mr-2" />
                      Create Lab
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* IN LAB VIEW */}
      {membership?.inLab && membership.lab && (
        <div className="space-y-6">
          {/* Tab Navigation */}
          <div className="border-b border-border">
            <div className="flex gap-6">
              <button
                onClick={() => setActiveTab('info')}
                className={`pb-3 px-1 text-sm font-serif transition-colors border-b-2 ${
                  activeTab === 'info'
                    ? 'border-accent text-accent'
                    : 'border-transparent text-text-secondary hover:text-text-primary'
                }`}
              >
                Lab Info
              </button>
              <button
                onClick={() => setActiveTab('members')}
                className={`pb-3 px-1 text-sm font-serif transition-colors border-b-2 ${
                  activeTab === 'members'
                    ? 'border-accent text-accent'
                    : 'border-transparent text-text-secondary hover:text-text-primary'
                }`}
              >
                Members ({members.length})
              </button>
              <button
                onClick={() => setActiveTab('analyses')}
                className={`pb-3 px-1 text-sm font-serif transition-colors border-b-2 ${
                  activeTab === 'analyses'
                    ? 'border-accent text-accent'
                    : 'border-transparent text-text-secondary hover:text-text-primary'
                }`}
              >
                Lab Analyses ({labAnalyses.length})
              </button>
            </div>
          </div>

          {/* INFO TAB */}
          {activeTab === 'info' && (
            <div className="space-y-6">
              {/* Lab Details */}
              <div className="bg-surface rounded-xl p-6 border border-border">
                <h3 className="text-lg font-serif text-text-primary mb-4">Lab Information</h3>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-text-tertiary mb-1">Lab Name</p>
                    <p className="text-text-primary font-serif">{membership.lab.name}</p>
                  </div>
                  {membership.lab.department && (
                    <div>
                      <p className="text-sm text-text-tertiary mb-1">Department</p>
                      <p className="text-text-primary">{membership.lab.department}</p>
                    </div>
                  )}
                  {membership.lab.institution && (
                    <div>
                      <p className="text-sm text-text-tertiary mb-1">Institution</p>
                      <p className="text-text-primary">{membership.lab.institution}</p>
                    </div>
                  )}
                  {membership.lab.lab_website && (
                    <div>
                      <p className="text-sm text-text-tertiary mb-1">Website</p>
                      <a
                        href={membership.lab.lab_website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline inline-flex items-center gap-1"
                      >
                        {membership.lab.lab_website}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-text-tertiary mb-1">Your Role</p>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border ${getRoleBadgeColor(
                        membership.role!
                      )}`}
                    >
                      {getRoleIcon(membership.role!)}
                      {membership.role?.toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Invite Code */}
              <div className="bg-surface rounded-xl p-6 border border-border">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-serif text-text-primary mb-1">Invite Code</h3>
                    <p className="text-sm text-text-secondary">Share this code to invite team members</p>
                  </div>
                  {canManageMembers && (
                    <button
                      onClick={() => setConfirmAction({ type: 'regenerate' })}
                      className="text-sm text-text-tertiary hover:text-accent transition-colors flex items-center gap-1"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Regenerate
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-background border border-border rounded-lg px-4 py-3">
                    <p className="text-2xl font-mono font-bold text-text-primary tracking-widest">
                      {membership.lab.invite_code}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => copyToClipboard(membership.lab!.invite_code)}
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    Copy
                  </Button>
                </div>

                <p className="text-xs text-text-tertiary mt-3">
                  {members.length} member{members.length !== 1 ? 's' : ''} joined with this code
                </p>
              </div>

              {/* Leave Lab (Danger Zone) */}
              <div className="bg-red-50 border border-red-200 rounded-xl p-6">
                <h3 className="text-lg font-serif text-red-800 mb-2">Leave Lab</h3>
                <p className="text-sm text-red-700 mb-4">
                  {membership.role === 'pi'
                    ? 'As PI, you cannot leave the lab. Transfer ownership first or delete the lab.'
                    : 'Once you leave, you will lose access to all lab analyses and need a new invite code to rejoin.'}
                </p>
                <Button
                  variant="secondary"
                  onClick={() => setConfirmAction({ type: 'leave' })}
                  disabled={membership.role === 'pi'}
                  className="bg-red-100 border-red-300 text-red-700 hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Leave Lab
                </Button>
              </div>
            </div>
          )}

          {/* MEMBERS TAB */}
          {activeTab === 'members' && (
            <div className="bg-surface rounded-xl border border-border overflow-hidden">
              <table className="w-full">
                <thead className="bg-background border-b border-border">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-serif text-text-tertiary uppercase tracking-wider">
                      Member
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-serif text-text-tertiary uppercase tracking-wider">
                      Role
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-serif text-text-tertiary uppercase tracking-wider">
                      Title
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-serif text-text-tertiary uppercase tracking-wider">
                      Joined
                    </th>
                    {canManageMembers && (
                      <th className="px-6 py-3 text-right text-xs font-serif text-text-tertiary uppercase tracking-wider">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {members.map((member) => (
                    <tr key={member.id} className="hover:bg-background/50 transition-colors">
                      <td className="px-6 py-4">
                        <div>
                          <p className="text-sm font-medium text-text-primary">
                            {member.display_name || member.full_name || 'Unknown'}
                          </p>
                          <p className="text-xs text-text-tertiary">{member.email}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {canManageMembers && member.role !== 'pi' ? (
                          <select
                            value={member.role}
                            onChange={(e) => handleUpdateMemberRole(member.user_id, e.target.value as LabRole)}
                            disabled={saving}
                            className="text-xs border border-border rounded-md px-2 py-1 bg-background text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                          >
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                            <option value="guest">Guest</option>
                          </select>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border ${getRoleBadgeColor(
                              member.role
                            )}`}
                          >
                            {getRoleIcon(member.role)}
                            {member.role.toUpperCase()}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-text-secondary">{member.title || '—'}</td>
                      <td className="px-6 py-4 text-sm text-text-tertiary">
                        {new Date(member.joined_at).toLocaleDateString()}
                      </td>
                      {canManageMembers && (
                        <td className="px-6 py-4 text-right">
                          {member.role !== 'pi' && (
                            <button
                              onClick={() => setConfirmAction({ type: 'remove', data: member })}
                              className="text-red-600 hover:text-red-700 transition-colors"
                              title="Remove member"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>

              {members.length === 0 && (
                <div className="text-center py-12">
                  <Users className="w-12 h-12 text-text-tertiary mx-auto mb-4" />
                  <p className="text-text-secondary">No members yet</p>
                </div>
              )}
            </div>
          )}

          {/* ANALYSES TAB */}
          {activeTab === 'analyses' && (
            <div className="bg-surface rounded-xl border border-border overflow-hidden">
              <table className="w-full">
                <thead className="bg-background border-b border-border">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-serif text-text-tertiary uppercase tracking-wider">
                      Analysis
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-serif text-text-tertiary uppercase tracking-wider">
                      Created By
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-serif text-text-tertiary uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-serif text-text-tertiary uppercase tracking-wider">
                      Created
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {labAnalyses.map((analysis) => (
                    <tr key={analysis.id} className="hover:bg-background/50 transition-colors">
                      <td className="px-6 py-4">
                        <a
                          href={`/results/${analysis.id}`}
                          className="text-sm font-medium text-accent hover:underline"
                        >
                          {analysis.name}
                        </a>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center text-xs font-medium"
                            title={analysis.ownerName}
                          >
                            {analysis.ownerName?.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-sm text-text-secondary">{analysis.ownerName}</span>
                          {analysis.isOwner && (
                            <span className="text-xs text-text-tertiary">(You)</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-block px-2 py-1 rounded-md text-xs font-medium ${
                            analysis.status === 'complete'
                              ? 'bg-green-100 text-green-800'
                              : analysis.status === 'failed'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}
                        >
                          {analysis.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-text-tertiary">
                        {new Date(analysis.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {labAnalyses.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-text-secondary">No analyses yet</p>
                  <p className="text-xs text-text-tertiary mt-1">
                    Lab analyses will appear here once members create them
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modals */}
      {confirmAction.type === 'leave' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h3 className="text-lg font-serif text-text-primary mb-2">Leave Lab?</h3>
            <p className="text-sm text-text-secondary mb-6">
              You will lose access to all lab analyses. You&apos;ll need a new invite code to rejoin.
            </p>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => setConfirmAction({ type: null })}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleLeaveLab}
                disabled={saving}
                className="flex-1 bg-red-600 hover:bg-red-700"
              >
                {saving ? 'Leaving...' : 'Leave Lab'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmAction.type === 'remove' && confirmAction.data && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h3 className="text-lg font-serif text-text-primary mb-2">Remove Member?</h3>
            <p className="text-sm text-text-secondary mb-6">
              Remove <strong>{confirmAction.data.display_name || confirmAction.data.email}</strong> from
              the lab? They will lose access to all lab analyses.
            </p>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => setConfirmAction({ type: null })}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={() => handleRemoveMember(confirmAction.data.user_id)}
                disabled={saving}
                className="flex-1 bg-red-600 hover:bg-red-700"
              >
                {saving ? 'Removing...' : 'Remove'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmAction.type === 'regenerate' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h3 className="text-lg font-serif text-text-primary mb-2">Regenerate Invite Code?</h3>
            <p className="text-sm text-text-secondary mb-6">
              The current code will be invalidated immediately. Any pending invites with the old code will
              no longer work.
            </p>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => setConfirmAction({ type: null })}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleRegenerateCode}
                disabled={saving}
                className="flex-1"
              >
                {saving ? 'Regenerating...' : 'Regenerate'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
