"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import Button from "@/components/Button";
import APIKeyManager from "@/components/APIKeyManager";
import { useUser } from "@/lib/context/UserContext";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import {
  User,
  Mail,
  Key,
  Bell,
  Database,
  Save,
  Shield,
  LogOut,
  Building2,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Trash2,
} from "lucide-react";
import InstitutionAutocomplete from "@/components/InstitutionAutocomplete";

type ProfileSaveStatus = "idle" | "saving" | "success" | "error";
type ClearDataStatus = "idle" | "confirming" | "clearing" | "success" | "error";

export default function SettingsPage() {
  const router = useRouter();
  const { userData } = useUser();
  const [displayName, setDisplayName] = useState("Researcher");
  const [email, setEmail] = useState(userData?.email || "user@example.com");
  const [institution, setInstitution] = useState("");
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [profileSaveStatus, setProfileSaveStatus] = useState<ProfileSaveStatus>("idle");
  const [profileSaveError, setProfileSaveError] = useState<string | null>(null);
  const [notificationSaveSuccess, setNotificationSaveSuccess] = useState(false);
  const [hasAuth, setHasAuth] = useState(false);
  const [isSupabaseAuth, setIsSupabaseAuth] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [clearDataStatus, setClearDataStatus] = useState<ClearDataStatus>("idle");
  const [clearDataError, setClearDataError] = useState<string | null>(null);

  const loadUserData = useCallback(async () => {
    if (typeof window === "undefined") return;
    setProfileLoading(true);
    setProfileSaveError(null);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        setHasAuth(true);
        setIsSupabaseAuth(true);
        setEmail(user.email || "user@example.com");

        const { data: profileRow } = await (supabase
          .from("profiles") as any)
          .select("full_name, institution")
          .eq("id", user.id)
          .single();

        const profile = profileRow as { full_name?: string | null; institution?: string | null } | null;
        if (profile && (profile.full_name != null || profile.institution != null)) {
          setDisplayName(profile.full_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "Researcher");
          setInstitution(profile.institution ?? "");
        } else {
          const fullName = user.user_metadata?.full_name;
          const displayNameMeta = user.user_metadata?.display_name;
          setDisplayName(fullName || displayNameMeta || user.email?.split("@")[0] || "Researcher");
          setInstitution((user.user_metadata?.institution as string) ?? "");
        }
        return;
      }
    } catch (_) {
      // Supabase not configured or error, fall through to localStorage
    }

    setHasAuth(!!localStorage.getItem("splicr_auth_token"));
    const stored = localStorage.getItem("splicr_user_data");
    if (stored) {
      try {
        const data = JSON.parse(stored);
        if (data.email) setEmail(data.email);
        if (data.institution) setInstitution(data.institution);
      } catch (_) {}
    }
    const name = localStorage.getItem("splicr_display_name");
    if (name) setDisplayName(name);
    const inst = localStorage.getItem("splicr_institution");
    if (inst !== null) setInstitution(inst);
    const notif = localStorage.getItem("splicr_email_notifications");
    if (notif !== null) setEmailNotifications(notif === "true");
  }, []);

  useEffect(() => {
    loadUserData().finally(() => setProfileLoading(false));
  }, [loadUserData, userData?.email]);

  const handleSaveProfile = async () => {
    if (typeof window === "undefined") return;
    setProfileSaveError(null);

    if (isSupabaseAuth) {
      setProfileSaveStatus("saving");
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setProfileSaveError("Session expired. Please sign in again.");
          setProfileSaveStatus("error");
          return;
        }

        const fullName = displayName.trim() || null;
        const institutionValue = institution.trim() || null;

        const { error: profileError } = await (supabase.from("profiles") as any).upsert(
          {
            id: user.id,
            email: user.email ?? "",
            full_name: fullName,
            institution: institutionValue,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" }
        );

        if (profileError) throw profileError;

        const { error: authError } = await supabase.auth.updateUser({
          data: {
            full_name: fullName ?? undefined,
            institution: institutionValue ?? undefined,
          },
        });

        if (authError) throw authError;

        setProfileSaveStatus("success");
        setTimeout(() => setProfileSaveStatus("idle"), 3000);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to save profile. Please try again.";
        setProfileSaveError(message);
        setProfileSaveStatus("error");
        console.error("Profile save error:", e);
      }
      return;
    }

    localStorage.setItem("splicr_display_name", displayName);
    localStorage.setItem("splicr_institution", institution);
    const stored = localStorage.getItem("splicr_user_data");
    const data = stored ? JSON.parse(stored) : { userId: "", analyses: [], favorites: [], notes: {} };
    data.email = email;
    data.institution = institution;
    localStorage.setItem("splicr_user_data", JSON.stringify(data));
    setProfileSaveStatus("success");
    setTimeout(() => setProfileSaveStatus("idle"), 3000);
  };

  const handleSaveNotifications = () => {
    if (typeof window === "undefined") return;
    localStorage.setItem("splicr_email_notifications", String(emailNotifications));
    setNotificationSaveSuccess(true);
    setTimeout(() => setNotificationSaveSuccess(false), 3000);
  };

  const handleClearDataClick = () => {
    setClearDataError(null);
    setClearDataStatus("confirming");
  };

  const handleClearDataConfirm = async () => {
    if (typeof window === "undefined") return;
    setClearDataError(null);
    setClearDataStatus("clearing");
    try {
      if (isSupabaseAuth) {
        const res = await fetch("/api/settings/clear-data", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setClearDataError(data.message || "Failed to clear data.");
          setClearDataStatus("error");
          return;
        }
      }
      // Clear local storage keys (analyses cache, user data, etc.)
      localStorage.removeItem("splicr_user_data");
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith("splicr_analysis_") || key.startsWith("splicr_"))) {
          if (!["splicr_auth_token", "splicr_auth_user", "splicr_display_name", "splicr_institution", "splicr_email_notifications"].includes(key)) {
            keysToRemove.push(key);
          }
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
      setClearDataStatus("success");
      setTimeout(() => {
        setClearDataStatus("idle");
        router.refresh();
      }, 2000);
    } catch (e) {
      setClearDataError(e instanceof Error ? e.message : "Failed to clear data.");
      setClearDataStatus("error");
    }
  };

  // Derive booleans before JSX so TypeScript doesn't narrow clearDataStatus inside conditionals (avoids "types have no overlap" errors).
  const isClearDataConfirmingOrClearing =
    clearDataStatus === "confirming" || clearDataStatus === "clearing";
  const isClearDataClearing = clearDataStatus === "clearing";

  return (
      <div className="min-h-screen">
        <div className="max-w-[800px] mx-auto px-8 py-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-16"
          >
            <h1 className="text-6xl font-serif text-text-primary mb-2">Settings</h1>
            <p className="text-lg text-text-secondary">
              Account, preferences, and data.
            </p>
          </motion.div>

          {/* Profile */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-surface rounded-2xl p-8 shadow-card border border-border mb-8"
          >
            <h2 className="text-2xl font-serif text-text-primary mb-6 flex items-center gap-3">
              <User className="w-6 h-6" strokeWidth={1.5} />
              Profile
              {profileLoading && (
                <Loader2 className="w-5 h-5 animate-spin text-text-tertiary" strokeWidth={1.5} />
              )}
            </h2>
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-serif text-text-secondary mb-2">Display name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-4 py-3 bg-background border border-border rounded-xl font-serif text-text-primary focus:outline-none focus:ring-2 focus:ring-text-primary"
                  placeholder="e.g. Lab PI"
                />
              </div>
              <div>
                <label className="block text-sm font-serif text-text-secondary mb-2 flex items-center gap-2">
                  <Mail className="w-4 h-4" strokeWidth={1.5} />
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => !isSupabaseAuth && setEmail(e.target.value)}
                  readOnly={isSupabaseAuth}
                  className={`w-full px-4 py-3 bg-background border border-border rounded-xl font-serif text-text-primary focus:outline-none focus:ring-2 focus:ring-text-primary ${isSupabaseAuth ? "opacity-90 cursor-not-allowed" : ""}`}
                  placeholder="researcher@institution.edu"
                />
                {isSupabaseAuth && (
                  <p className="text-xs text-text-tertiary mt-1.5">Email is managed by your account and saved in the database.</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-serif text-text-secondary mb-2 flex items-center gap-2">
                  <Building2 className="w-4 h-4" strokeWidth={1.5} />
                  Institution
                </label>
                <InstitutionAutocomplete
                  value={institution}
                  onChange={setInstitution}
                  placeholder="Search for your college or university…"
                  required={false}
                />
              </div>
              {profileSaveError && (
                <div className="flex items-center gap-2 text-error text-sm font-serif">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {profileSaveError}
                </div>
              )}
              <Button
                variant="primary"
                size="md"
                onClick={handleSaveProfile}
                disabled={profileSaveStatus === "saving" || profileLoading}
              >
                {profileSaveStatus === "saving" ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" strokeWidth={1.5} />
                    Saving…
                  </>
                ) : profileSaveStatus === "success" ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" strokeWidth={1.5} />
                    Saved
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" strokeWidth={1.5} />
                    Save profile
                  </>
                )}
              </Button>
              {isSupabaseAuth && (
                <p className="text-xs text-text-tertiary">Profile is stored in the database and synced with your account.</p>
              )}
            </div>
          </motion.section>

          {/* Notifications */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-surface rounded-2xl p-8 shadow-card border border-border mb-8"
          >
            <h2 className="text-2xl font-serif text-text-primary mb-6 flex items-center gap-3">
              <Bell className="w-6 h-6" strokeWidth={1.5} />
              Notifications
            </h2>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-serif text-text-primary">Email when analysis completes</p>
                <p className="text-sm text-text-tertiary mt-1">Receive an email when a screen run finishes.</p>
              </div>
              <input
                type="checkbox"
                checked={emailNotifications}
                onChange={(e) => setEmailNotifications(e.target.checked)}
                className="w-5 h-5 rounded border-border accent-accent"
              />
            </div>
            <div className="flex items-center gap-3 mt-6">
              <Button variant="secondary" size="md" onClick={handleSaveNotifications}>
                Save preferences
              </Button>
              {notificationSaveSuccess && (
                <span className="flex items-center gap-1.5 text-success text-sm font-serif">
                  <CheckCircle2 className="w-4 h-4" /> Saved
                </span>
              )}
            </div>
          </motion.section>

          {/* Data & storage */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-surface rounded-2xl p-8 shadow-card border border-border mb-8"
          >
            <h2 className="text-2xl font-serif text-text-primary mb-6 flex items-center gap-3">
              <Database className="w-6 h-6" strokeWidth={1.5} />
              Data & storage
            </h2>
            <p className="text-text-secondary font-serif mb-4">
              When signed in, analyses, notes, and profile are stored in the database and persist across devices and sessions.
            </p>
            {isClearDataConfirmingOrClearing ? (
              <div className="rounded-xl border border-border bg-background p-4 space-y-3">
                <p className="font-serif text-text-primary">
                  Clear all your analyses, notes, shared links, and activity from the database and this device. This cannot be undone.
                </p>
                <div className="flex items-center gap-3">
                  <Button
                    variant="primary"
                    size="md"
                    onClick={handleClearDataConfirm}
                    disabled={isClearDataClearing}
                  >
                    {isClearDataClearing ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" strokeWidth={1.5} />
                        Clearing…
                      </>
                    ) : (
                      "Yes, clear all data"
                    )}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => setClearDataStatus("idle")}
                    disabled={isClearDataClearing}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm text-text-tertiary font-serif mb-4">
                  Export and backup of analysis metadata can be added in a future release.
                </p>
                {clearDataError && (
                  <div className="flex items-center gap-2 text-error text-sm font-serif mb-3">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {clearDataError}
                  </div>
                )}
                {clearDataStatus === "success" && (
                  <div className="flex items-center gap-2 text-success text-sm font-serif mb-3">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    All data cleared. Refreshing…
                  </div>
                )}
                <Button
                  variant="secondary"
                  size="md"
                  onClick={handleClearDataClick}
                  disabled={clearDataStatus === "success"}
                >
                  <Trash2 className="w-4 h-4 mr-2" strokeWidth={1.5} />
                  Clear previous data
                </Button>
              </>
            )}
          </motion.section>

          {/* API & developer */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="mb-8 space-y-6"
          >
            <h2 className="text-2xl font-serif text-text-primary flex items-center gap-3">
              <Key className="w-6 h-6" strokeWidth={1.5} />
              Developer & API
            </h2>
            <APIKeyManager />
          </motion.section>

          {/* Security & sign out */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-surface rounded-2xl p-8 shadow-card border border-border"
          >
            <h2 className="text-2xl font-serif text-text-primary mb-6 flex items-center gap-3">
              <Shield className="w-6 h-6" strokeWidth={1.5} />
              Security
            </h2>
            <p className="text-text-secondary font-serif mb-4">
              {hasAuth
                ? "You are signed in."
                : "Create an account to save your analyses and access them from any device."}
            </p>
            {hasAuth ? (
              <button
                type="button"
                onClick={async () => {
                  if (typeof window === "undefined") return;
                  // Sign out from Supabase if using Supabase auth
                  if (isSupabaseAuth) {
                    try {
                      const supabase = createClient();
                      await supabase.auth.signOut();
                    } catch (_) {}
                  }
                  // Clear legacy localStorage auth
                  localStorage.removeItem("splicr_auth_token");
                  localStorage.removeItem("splicr_auth_user");
                  router.push("/auth/sign-in");
                  router.refresh();
                }}
                className="flex items-center gap-2 px-4 py-2 border border-border rounded-xl font-serif text-text-secondary hover:bg-background hover:text-text-primary transition-colors"
              >
                <LogOut className="w-4 h-4" strokeWidth={1.5} />
                Sign out
              </button>
            ) : (
              <div className="flex items-center gap-4">
                <Link href="/auth/sign-up">
                  <button className="px-4 py-2 bg-accent text-text-primary font-serif rounded-xl hover:opacity-90">
                    Create account
                  </button>
                </Link>
                <Link href="/auth/sign-in">
                  <button className="px-4 py-2 border border-border font-serif text-text-primary rounded-xl hover:bg-background">
                    Sign in
                  </button>
                </Link>
              </div>
            )}
          </motion.section>

          {profileSaveStatus === "success" && profileSaveError === null && (
            <motion.p
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 flex items-center gap-2 text-success font-serif text-sm"
            >
              <CheckCircle2 className="w-4 h-4" />
              Profile saved to database.
            </motion.p>
          )}
        </div>
      </div>
  );
}
