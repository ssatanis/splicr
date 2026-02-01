"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Button from "./Button";
import {
  X,
  Mail,
  UserPlus,
  Users,
  Trash2,
  Check,
  Clock,
  Eye,
  Edit3,
  Copy,
  CheckCircle,
  Link2,
  Globe,
  Building2,
  Lock,
} from "lucide-react";
import type { ShareVisibility, SharePermission, Collaborator } from "@/lib/types";

interface LinkShareConfig {
  exists: boolean;
  visibility: ShareVisibility;
  link_permission: SharePermission;
  institution_permission: SharePermission;
  institution_domain: string | null;
  shareableUrl: string | null;
}

interface ShareAnalysisModalProps {
  analysisId: string;
  analysisName: string;
  open: boolean;
  onClose: () => void;
}

export default function ShareAnalysisModal({
  analysisId,
  analysisName,
  open,
  onClose,
}: ShareAnalysisModalProps) {
  // State for email collaborators
  const [shares, setShares] = useState<Collaborator[]>([]);
  const [isOwner, setIsOwner] = useState(true);

  // State for link sharing
  const [linkConfig, setLinkConfig] = useState<LinkShareConfig>({
    exists: false,
    visibility: 'private',
    link_permission: 'view',
    institution_permission: 'view',
    institution_domain: null,
    shareableUrl: null,
  });

  // UI state
  const [loading, setLoading] = useState(false);
  const [linkLoading, setLinkLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<SharePermission>("view");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // Fetch email collaborators
  const fetchShares = useCallback(async () => {
    try {
      const response = await fetch(`/api/analysis/${analysisId}/share`);
      const data = await response.json();
      if (response.ok) {
        setShares(data.shares || []);
        setIsOwner(data.owner ?? true);
      }
    } catch (err) {
      console.error("Failed to fetch shares:", err);
    }
  }, [analysisId]);

  // Fetch link share configuration
  const fetchLinkConfig = useCallback(async () => {
    try {
      const response = await fetch(`/api/analysis/${analysisId}/share/link`);
      const data = await response.json();
      if (response.ok) {
        if (data.exists && data.linkShare) {
          setLinkConfig({
            exists: true,
            visibility: data.linkShare.visibility,
            link_permission: data.linkShare.link_permission,
            institution_permission: data.linkShare.institution_permission,
            institution_domain: data.linkShare.institution_domain,
            shareableUrl: data.shareableUrl,
          });
        } else {
          setLinkConfig({
            exists: false,
            visibility: 'private',
            link_permission: 'view',
            institution_permission: 'view',
            institution_domain: null,
            shareableUrl: null,
          });
        }
      }
    } catch (err) {
      console.error("Failed to fetch link config:", err);
    }
  }, [analysisId]);

  useEffect(() => {
    if (open) {
      fetchShares();
      fetchLinkConfig();
    }
  }, [open, fetchShares, fetchLinkConfig]);

  // Update link share configuration
  const handleUpdateLinkSharing = async (updates: Partial<LinkShareConfig>) => {
    setError(null);
    setSuccess(null);
    setLinkLoading(true);

    try {
      const response = await fetch(`/api/analysis/${analysisId}/share/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visibility: updates.visibility || linkConfig.visibility,
          link_permission: updates.link_permission || linkConfig.link_permission,
          institution_permission: updates.institution_permission || linkConfig.institution_permission,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to update sharing settings");
      }

      setSuccess("Sharing settings updated");
      fetchLinkConfig(); // Refresh link config
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update settings");
    } finally {
      setLinkLoading(false);
    }
  };

  // Email invitation handlers
  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/analysis/${analysisId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, permission }),
        credentials: "include",
      });

      let data: { error?: string };
      try {
        data = await response.json();
      } catch {
        throw new Error("Failed to share analysis");
      }

      if (!response.ok) {
        throw new Error(data.error || "Failed to send invitation");
      }

      setSuccess(`Invitation sent to ${email}`);
      setEmail("");
      fetchShares();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send invitation");
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (shareId: string, shareEmail: string) => {
    if (!confirm(`Remove ${shareEmail} from collaborators?`)) return;

    try {
      const response = await fetch(
        `/api/analysis/${analysisId}/share?shareId=${shareId}`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        throw new Error("Failed to remove collaborator");
      }

      setSuccess("Collaborator removed");
      fetchShares();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove");
    }
  };

  const copyShareLink = async () => {
    const link = linkConfig.shareableUrl || `${window.location.origin}/results/${analysisId}`;
    await navigator.clipboard.writeText(link);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm flex items-center justify-center z-50 p-6"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-surface rounded-2xl w-full max-w-2xl shadow-elevated overflow-hidden max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-border sticky top-0 bg-surface z-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-accent/10 rounded-xl flex items-center justify-center">
                <Users className="w-5 h-5 text-accent" strokeWidth={1.5} />
              </div>
              <div>
                <h2 className="text-xl font-serif text-text-primary">Share Analysis</h2>
                <p className="text-sm text-text-secondary truncate max-w-[300px]">
                  {analysisName}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-background rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-text-secondary" strokeWidth={1.5} />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* SECTION 1: Link Sharing */}
            {isOwner && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Link2 className="w-4 h-4 shrink-0 text-text-secondary" strokeWidth={1.5} />
                  <h3 className="m-0 text-sm font-serif text-text-primary font-medium">
                    Share via Link
                  </h3>
                </div>

                {/* Shareable Link Display */}
                <div className="flex items-center gap-2 p-3 bg-background rounded-xl">
                  <input
                    type="text"
                    value={linkConfig.shareableUrl || `${typeof window !== "undefined" ? window.location.origin : ""}/results/${analysisId}`}
                    readOnly
                    className="flex-1 bg-transparent text-sm font-mono text-text-secondary focus:outline-none truncate"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={copyShareLink}
                    className="shrink-0"
                  >
                    {linkCopied ? (
                      <>
                        <CheckCircle className="w-4 h-4 mr-1.5 text-success" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-1.5" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>

                {/* Link Sharing Controls */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Visibility Dropdown */}
                  <div>
                    <label className="block text-xs font-serif text-text-secondary mb-2">
                      Who can access?
                    </label>
                    <select
                      value={linkConfig.visibility}
                      onChange={(e) => handleUpdateLinkSharing({ visibility: e.target.value as ShareVisibility })}
                      disabled={linkLoading}
                      className="w-full px-3 py-2.5 bg-background border border-border rounded-xl text-sm font-serif focus:outline-none focus:border-accent transition-colors disabled:opacity-50"
                    >
                      <option value="private">
                        Only people invited
                      </option>
                      <option value="institution">
                        Anyone at {linkConfig.institution_domain || 'my institution'}
                      </option>
                      <option value="public">
                        Anyone with the link
                      </option>
                    </select>
                  </div>

                  {/* Permission Dropdown */}
                  <div>
                    <label className="block text-xs font-serif text-text-secondary mb-2">
                      {linkConfig.visibility === 'institution' ? 'Institution members can:' : 'People with link can:'}
                    </label>
                    <select
                      value={linkConfig.visibility === 'institution' ? linkConfig.institution_permission : linkConfig.link_permission}
                      onChange={(e) => {
                        const perm = e.target.value as SharePermission;
                        if (linkConfig.visibility === 'institution') {
                          handleUpdateLinkSharing({ institution_permission: perm });
                        } else {
                          handleUpdateLinkSharing({ link_permission: perm });
                        }
                      }}
                      disabled={linkLoading || linkConfig.visibility === 'private'}
                      className="w-full px-3 py-2.5 bg-background border border-border rounded-xl text-sm font-serif focus:outline-none focus:border-accent transition-colors disabled:opacity-50"
                    >
                      <option value="view">👁️ View only</option>
                      <option value="edit">✏️ View and edit</option>
                    </select>
                  </div>
                </div>

                {/* Visibility Explanation */}
                <div className="p-3 bg-info/10 border border-info/20 rounded-xl">
                  <p className="text-xs text-info">
                    {linkConfig.visibility === 'private' && (
                      <>
                        <Lock className="w-3 h-3 inline mr-1" />
                        Only people you invite via email can access this analysis
                      </>
                    )}
                    {linkConfig.visibility === 'institution' && (
                      <>
                        <Building2 className="w-3 h-3 inline mr-1" />
                        Anyone with a <strong>@{linkConfig.institution_domain}</strong> email can access with the link
                      </>
                    )}
                    {linkConfig.visibility === 'public' && (
                      <>
                        <Globe className="w-3 h-3 inline mr-1" />
                        Anyone with the link can access this analysis
                      </>
                    )}
                  </p>
                </div>
              </div>
            )}

            {/* Divider */}
            {isOwner && <div className="border-t border-border" />}

            {/* SECTION 2: Email Invitation */}
            {isOwner && (
              <form onSubmit={handleInvite} className="space-y-4">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 shrink-0 text-text-secondary" strokeWidth={1.5} />
                  <h3 className="m-0 text-sm font-serif text-text-primary font-medium">
                    Invite via Email
                  </h3>
                </div>

                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Mail
                      className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary"
                      strokeWidth={1.5}
                    />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="colleague@institution.com"
                      className="w-full pl-10 pr-4 py-2.5 bg-background border border-border rounded-xl text-sm font-serif focus:outline-none focus:border-accent transition-colors"
                    />
                  </div>
                  <select
                    value={permission}
                    onChange={(e) => setPermission(e.target.value as SharePermission)}
                    className="px-3 py-2 bg-background border border-border rounded-xl text-sm font-serif focus:outline-none focus:border-accent"
                  >
                    <option value="view">Can view</option>
                    <option value="edit">Can edit</option>
                  </select>
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  disabled={loading || !email}
                  className="w-full"
                >
                  <UserPlus className="w-4 h-4 mr-2" strokeWidth={1.5} />
                  {loading ? "Sending..." : "Send Invitation"}
                </Button>
              </form>
            )}

            {/* Messages */}
            {error && (
              <div className="p-3 bg-error/10 border border-error/20 rounded-xl">
                <p className="text-sm text-error">{error}</p>
              </div>
            )}

            {success && (
              <div className="p-3 bg-success/10 border border-success/20 rounded-xl">
                <p className="text-sm text-success">{success}</p>
              </div>
            )}

            {/* Divider */}
            {isOwner && <div className="border-t border-border" />}

            {/* SECTION 3: Collaborators List */}
            <div>
              <h3 className="text-sm font-serif text-text-secondary mb-3">
                Collaborators ({shares.length})
              </h3>

              {shares.length === 0 ? (
                <div className="text-center py-8 text-text-tertiary">
                  <Users className="w-8 h-8 mx-auto mb-2 opacity-50" strokeWidth={1} />
                  <p className="text-sm font-serif">No collaborators yet</p>
                  <p className="text-xs mt-1">Invite team members to collaborate</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {shares.map((share) => (
                    <div
                      key={share.id}
                      className="flex items-center justify-between p-3 bg-background rounded-xl"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-accent/10 rounded-full flex items-center justify-center">
                          <span className="text-xs font-serif text-accent uppercase">
                            {share.email[0]}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm font-serif text-text-primary">
                            {share.email}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {share.status === "pending" ? (
                              <span className="flex items-center gap-1 text-xs text-warning">
                                <Clock className="w-3 h-3" />
                                Pending
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-xs text-success">
                                <Check className="w-3 h-3" />
                                Accepted
                              </span>
                            )}
                            <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                              share.permission === 'edit' ? 'bg-accent/10 text-accent' : 'bg-text-tertiary/10 text-text-tertiary'
                            }`}>
                              {share.permission === "edit" ? (
                                <>
                                  <Edit3 className="w-3 h-3" />
                                  Can edit
                                </>
                              ) : (
                                <>
                                  <Eye className="w-3 h-3" />
                                  Can view
                                </>
                              )}
                            </span>
                          </div>
                        </div>
                      </div>

                      {isOwner && (
                        <button
                          onClick={() => handleRemove(share.id, share.email)}
                          className="p-2 hover:bg-error/10 rounded-lg transition-colors group"
                        >
                          <Trash2
                            className="w-4 h-4 text-text-tertiary group-hover:text-error"
                            strokeWidth={1.5}
                          />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="p-6 pt-0 sticky bottom-0 bg-surface">
            <Button variant="secondary" size="md" onClick={onClose} className="w-full">
              Done
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
