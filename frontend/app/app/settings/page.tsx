"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Sidebar from "@/components/Sidebar";
import Button from "@/components/Button";
import APIKeyManager from "@/components/APIKeyManager";
import TemplateLibrary from "@/components/TemplateLibrary";
import { useUser } from "@/lib/context/UserContext";
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
} from "lucide-react";

export default function SettingsPage() {
  const { userData } = useUser();
  const [displayName, setDisplayName] = useState("Researcher");
  const [email, setEmail] = useState(userData?.email || "user@example.com");
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [hasAuth, setHasAuth] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setHasAuth(!!localStorage.getItem("splicr_auth_token"));
      const stored = localStorage.getItem("splicr_user_data");
      if (stored) {
        try {
          const data = JSON.parse(stored);
          if (data.email) setEmail(data.email);
        } catch (_) {}
      }
      const name = localStorage.getItem("splicr_display_name");
      if (name) setDisplayName(name);
      const notif = localStorage.getItem("splicr_email_notifications");
      if (notif !== null) setEmailNotifications(notif === "true");
    }
  }, [userData?.email]);

  const handleSaveProfile = () => {
    if (typeof window === "undefined") return;
    localStorage.setItem("splicr_display_name", displayName);
    const stored = localStorage.getItem("splicr_user_data");
    const data = stored ? JSON.parse(stored) : { userId: "", analyses: [], favorites: [], notes: {} };
    data.email = email;
    localStorage.setItem("splicr_user_data", JSON.stringify(data));
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  const handleSaveNotifications = () => {
    if (typeof window === "undefined") return;
    localStorage.setItem("splicr_email_notifications", String(emailNotifications));
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="ml-[260px] min-h-screen">
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
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-background border border-border rounded-xl font-serif text-text-primary focus:outline-none focus:ring-2 focus:ring-text-primary"
                  placeholder="researcher@institution.edu"
                />
              </div>
              <Button variant="primary" size="md" onClick={handleSaveProfile}>
                <Save className="w-4 h-4 mr-2" strokeWidth={1.5} />
                Save profile
              </Button>
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
            <Button variant="secondary" size="md" onClick={handleSaveNotifications} className="mt-6">
              Save preferences
            </Button>
          </motion.section>

          {/* Data & privacy */}
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
              Analyses and notes are stored locally in this browser. For persistent, cross-device data, sign in when backend auth is enabled.
            </p>
            <p className="text-sm text-text-tertiary font-serif">
              Export and backup of analysis metadata can be added in a future release.
            </p>
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
            <TemplateLibrary />
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
                ? "You are signed in. Your data is stored on the backend."
                : "Create an account to save your analyses to the backend and access them from any device."}
            </p>
            {hasAuth ? (
              <button
                type="button"
                onClick={() => {
                  if (typeof window === "undefined") return;
                  localStorage.removeItem("splicr_auth_token");
                  localStorage.removeItem("splicr_auth_user");
                  window.location.href = "/app/dashboard";
                }}
                className="flex items-center gap-2 px-4 py-2 border border-border rounded-xl font-serif text-text-secondary hover:bg-background hover:text-text-primary transition-colors"
              >
                <LogOut className="w-4 h-4" strokeWidth={1.5} />
                Sign out
              </button>
            ) : (
              <div className="flex items-center gap-4">
                <Link href="/register">
                  <button className="px-4 py-2 bg-accent text-text-primary font-serif rounded-xl hover:opacity-90">
                    Create account
                  </button>
                </Link>
                <Link href="/login">
                  <button className="px-4 py-2 border border-border font-serif text-text-primary rounded-xl hover:bg-background">
                    Sign in
                  </button>
                </Link>
              </div>
            )}
          </motion.section>

          {saveSuccess && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-6 text-success font-serif text-sm"
            >
              Settings saved.
            </motion.p>
          )}
        </div>
      </main>
    </div>
  );
}
