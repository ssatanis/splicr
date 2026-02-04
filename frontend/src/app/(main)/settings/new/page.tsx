"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  User,
  Bell,
  Sliders,
  Shield,
  Database,
  Users,
  Zap,
  FileText,
  GitBranch,
  Palette,
  Key,
} from "lucide-react";
import { NotificationSettings } from "@/components/settings/notification-settings";
import { AnalysisDefaultsSettings } from "@/components/settings/AnalysisDefaultsSettings";
import { QualityControlSettings } from "@/components/settings/QualityControlSettings";
import { DataManagementSettings } from "@/components/settings/DataManagementSettings";

type SettingsTab =
  | "profile"
  | "notifications"
  | "analysis-defaults"
  | "quality-control"
  | "data-management"
  | "collaboration"
  | "privacy-security"
  | "compute-performance"
  | "reproducibility"
  | "appearance"
  | "developer-api";

interface Tab {
  id: SettingsTab;
  label: string;
  icon: React.ReactNode;
  badge?: string;
  description: string;
}

const tabs: Tab[] = [
  {
    id: "profile",
    label: "Profile",
    icon: <User className="w-4 h-4" />,
    description: "Manage your personal information",
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: <Bell className="w-4 h-4" />,
    description: "Email and in-app alerts",
  },
  {
    id: "analysis-defaults",
    label: "Analysis Defaults",
    icon: <Sliders className="w-4 h-4" />,
    badge: "Essential",
    description: "Save time with preset parameters",
  },
  {
    id: "quality-control",
    label: "Quality Control",
    icon: <Shield className="w-4 h-4" />,
    badge: "Essential",
    description: "QC thresholds and automated checks",
  },
  {
    id: "data-management",
    label: "Data Management",
    icon: <Database className="w-4 h-4" />,
    description: "Auto-save, retention, and exports",
  },
  {
    id: "collaboration",
    label: "Collaboration",
    icon: <Users className="w-4 h-4" />,
    description: "Labs, sharing, and teamwork",
  },
  {
    id: "privacy-security",
    label: "Privacy & Security",
    icon: <Shield className="w-4 h-4" />,
    description: "2FA, sessions, and compliance",
  },
  {
    id: "compute-performance",
    label: "Compute & Performance",
    icon: <Zap className="w-4 h-4" />,
    description: "Resource allocation and caching",
  },
  {
    id: "reproducibility",
    label: "Reproducibility",
    icon: <GitBranch className="w-4 h-4" />,
    badge: "Publication",
    description: "Versioning and methods generation",
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: <Palette className="w-4 h-4" />,
    description: "Theme and visual preferences",
  },
  {
    id: "developer-api",
    label: "Developer & API",
    icon: <Key className="w-4 h-4" />,
    description: "API keys and webhooks",
  },
];

export default function NewSettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

  const renderTabContent = () => {
    switch (activeTab) {
      case "profile":
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-serif text-text-primary mb-2">Profile</h2>
              <p className="text-sm text-text-secondary">
                Manage your personal information
              </p>
            </div>
            <div className="bg-surface border border-border rounded-xl p-6">
              <p className="text-text-secondary">
                Profile settings (existing implementation to be integrated)
              </p>
            </div>
          </div>
        );
      
      case "notifications":
        return <NotificationSettings />;
      
      case "analysis-defaults":
        return <AnalysisDefaultsSettings />;
      
      case "quality-control":
        return <QualityControlSettings />;
      
      case "data-management":
        return <DataManagementSettings />;
      
      case "collaboration":
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-serif text-text-primary mb-2 flex items-center gap-2">
                <Users className="w-6 h-6" />
                Collaboration
              </h2>
              <p className="text-sm text-text-secondary">
                Labs, sharing permissions, and team management
              </p>
            </div>
            <div className="bg-surface border border-border rounded-xl p-6">
              <p className="text-text-secondary">
                Collaboration settings (coming soon)
              </p>
            </div>
          </div>
        );
      
      case "privacy-security":
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-serif text-text-primary mb-2 flex items-center gap-2">
                <Shield className="w-6 h-6" />
                Privacy & Security
              </h2>
              <p className="text-sm text-text-secondary">
                2FA, active sessions, and data visibility
              </p>
            </div>
            <div className="bg-surface border border-border rounded-xl p-6">
              <p className="text-text-secondary">
                Privacy & security settings (coming soon)
              </p>
            </div>
          </div>
        );
      
      case "compute-performance":
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-serif text-text-primary mb-2 flex items-center gap-2">
                <Zap className="w-6 h-6" />
                Compute & Performance
              </h2>
              <p className="text-sm text-text-secondary">
                Resource allocation, priorities, and caching
              </p>
            </div>
            <div className="bg-surface border border-border rounded-xl p-6">
              <p className="text-text-secondary">
                Compute & performance settings (coming soon)
              </p>
            </div>
          </div>
        );
      
      case "reproducibility":
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-serif text-text-primary mb-2 flex items-center gap-2">
                <GitBranch className="w-6 h-6" />
                Reproducibility
              </h2>
              <p className="text-sm text-text-secondary">
                Versioning, methods generation, and provenance tracking
              </p>
            </div>
            <div className="bg-surface border border-border rounded-xl p-6">
              <p className="text-text-secondary">
                Reproducibility settings (coming soon)
              </p>
            </div>
          </div>
        );
      
      case "appearance":
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-serif text-text-primary mb-2 flex items-center gap-2">
                <Palette className="w-6 h-6" />
                Appearance
              </h2>
              <p className="text-sm text-text-secondary">
                Theme, colors, and display preferences
              </p>
            </div>
            <div className="bg-surface border border-border rounded-xl p-6">
              <p className="text-text-secondary">
                Appearance settings (coming soon)
              </p>
            </div>
          </div>
        );
      
      case "developer-api":
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-serif text-text-primary mb-2 flex items-center gap-2">
                <Key className="w-6 h-6" />
                Developer & API
              </h2>
              <p className="text-sm text-text-secondary">
                API keys, webhooks, and SDK access
              </p>
            </div>
            <div className="bg-surface border border-border rounded-xl p-6">
              <p className="text-text-secondary">
                Developer & API settings (existing implementation to be integrated)
              </p>
            </div>
          </div>
        );
      
      default:
        return <div>Select a tab</div>;
    }
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-[1400px] mx-auto px-8 py-12">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-12"
        >
          <h1 className="text-6xl font-serif text-text-primary mb-2">Settings</h1>
          <p className="text-lg text-text-secondary">
            Production-grade controls for your research platform
          </p>
        </motion.div>

        {/* Layout: Sidebar + Content */}
        <div className="flex gap-8">
          {/* Sidebar Navigation */}
          <motion.aside
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="w-64 flex-shrink-0"
          >
            <div className="sticky top-8 space-y-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    w-full text-left px-4 py-3 rounded-xl transition-all
                    flex items-center gap-3 group
                    ${
                      activeTab === tab.id
                        ? "bg-accent text-text-primary shadow-sm"
                        : "text-text-secondary hover:bg-surface hover:text-text-primary"
                    }
                  `}
                >
                  <span className={activeTab === tab.id ? "text-text-primary" : "text-text-tertiary group-hover:text-text-secondary"}>
                    {tab.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-serif truncate">{tab.label}</span>
                      {tab.badge && (
                        <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-accent/20 text-accent rounded">
                          {tab.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-text-tertiary truncate">{tab.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </motion.aside>

          {/* Main Content */}
          <motion.main
            key={activeTab}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="flex-1 min-w-0"
          >
            {renderTabContent()}
          </motion.main>
        </div>

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-16 pt-8 border-t border-border/50"
        >
          <div className="flex flex-col items-center justify-center gap-3 text-center">
            <p className="text-xs text-text-tertiary font-serif max-w-2xl leading-relaxed">
              Your privacy and security are important to us. SplicR is committed to protecting your data and maintaining the highest standards of security.
            </p>
            <div className="flex items-center gap-4 text-xs">
              <a
                href="https://splicr.org/privacy-and-security"
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-tertiary hover:text-text-primary transition-colors font-serif underline decoration-text-tertiary/30 hover:decoration-text-primary/50 underline-offset-2"
              >
                Privacy & Security
              </a>
              <span className="text-border">•</span>
              <a
                href="https://splicr.org/terms-and-conditions"
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-tertiary hover:text-text-primary transition-colors font-serif underline decoration-text-tertiary/30 hover:decoration-text-primary/50 underline-offset-2"
              >
                Terms & Conditions
              </a>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
