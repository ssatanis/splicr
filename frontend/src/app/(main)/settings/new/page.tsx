"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
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
  Palette,
  Search,
  CreditCard,
  FlaskConical,
  ChevronRight,
} from "lucide-react";
import { ProfileSettings } from "@/components/settings/ProfileSettings";
import { NotificationSettings } from "@/components/settings/notification-settings";
import { AnalysisDefaultsSettings } from "@/components/settings/AnalysisDefaultsSettings";
import { QualityControlSettings } from "@/components/settings/QualityControlSettings";
import { DataManagementSettings } from "@/components/settings/DataManagementSettings";
import { LibraryManagementSettings } from "@/components/settings/LibraryManagementSettings";
import { CollaborationSettings } from "@/components/settings/CollaborationSettings";
import { PrivacySecuritySettings } from "@/components/settings/PrivacySecuritySettings";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { ComputePerformanceSettings } from "@/components/settings/ComputePerformanceSettings";
import { BillingUsageSettings } from "@/components/settings/BillingUsageSettings";
import { AdvancedSettings } from "@/components/settings/AdvancedSettings";
import { LabManagementSettings } from "@/components/settings/LabManagementSettings";

type SettingsTab =
  | "profile"
  | "notifications"
  | "analysis-defaults"
  | "quality-control"
  | "library-management"
  | "data-management"
  | "lab-management"
  | "collaboration"
  | "privacy-security"
  | "compute-performance"
  | "appearance"
  | "billing"
  | "advanced";

interface Tab {
  id: SettingsTab;
  label: string;
  icon: React.ReactNode;
  badge?: string;
  description: string;
}

const tabs: Tab[] = [
  { id: "profile", label: "Profile", icon: <User className="w-4 h-4" />, description: "Personal information and display" },
  { id: "notifications", label: "Notifications", icon: <Bell className="w-4 h-4" />, description: "Email and in-app alerts" },
  { id: "analysis-defaults", label: "Analysis Defaults", icon: <Sliders className="w-4 h-4" />, description: "MAGeCK, BAGEL2, presets" },
  { id: "quality-control", label: "Quality Control", icon: <Shield className="w-4 h-4" />, description: "QC thresholds and checks" },
  { id: "library-management", label: "Library Management", icon: <FileText className="w-4 h-4" />, description: "sgRNA libraries and gene sets" },
  { id: "data-management", label: "Data Management", icon: <Database className="w-4 h-4" />, description: "Retention, export, backup" },
  { id: "lab-management", label: "Lab & Team", icon: <Users className="w-4 h-4" />, description: "Join or create research labs" },
  { id: "collaboration", label: "Collaboration", icon: <Users className="w-4 h-4" />, description: "Team and sharing" },
  { id: "privacy-security", label: "Privacy & Security", icon: <Shield className="w-4 h-4" />, description: "2FA, sessions, compliance" },
  { id: "compute-performance", label: "Compute & Performance", icon: <Zap className="w-4 h-4" />, description: "Priority and resources" },
  { id: "appearance", label: "Appearance", icon: <Palette className="w-4 h-4" />, description: "Theme and visual preferences" },
  { id: "billing", label: "Billing & Usage", icon: <CreditCard className="w-4 h-4" />, description: "Plan and usage stats" },
  { id: "advanced", label: "Advanced", icon: <FlaskConical className="w-4 h-4" />, description: "Experimental and developer" },
];

export default function NewSettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [searchQuery, setSearchQuery] = useState("");

  const renderTabContent = () => {
    switch (activeTab) {
      case "profile":
        return <ProfileSettings />;
      
      case "notifications":
        return <NotificationSettings />;
      
      case "analysis-defaults":
        return <AnalysisDefaultsSettings />;
      
      case "quality-control":
        return <QualityControlSettings />;

      case "library-management":
        return <LibraryManagementSettings />;

      case "data-management":
        return <DataManagementSettings />;

      case "lab-management":
        return <LabManagementSettings />;

      case "collaboration":
        return <CollaborationSettings />;
      
      case "privacy-security":
        return <PrivacySecuritySettings />;
      
      case "compute-performance":
        return <ComputePerformanceSettings />;
      
      case "appearance":
        return <AppearanceSettings />;
      case "billing":
        return <BillingUsageSettings />;
      case "advanced":
        return <AdvancedSettings />;
      default:
        return <div>Select a tab</div>;
    }
  };

  const activeTabLabel = tabs.find((t) => t.id === activeTab)?.label ?? "Settings";
  const filteredTabs = useMemo(() => {
    if (!searchQuery.trim()) return tabs;
    const q = searchQuery.toLowerCase();
    return tabs.filter(
      (t) =>
        t.label.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  return (
    <div className="min-h-screen">
      <div className="max-w-[1400px] mx-auto px-8 py-12">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-text-tertiary mb-4" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-text-secondary transition-colors">Home</Link>
          <ChevronRight className="w-4 h-4" />
          <Link href="/settings" className="hover:text-text-secondary transition-colors">Settings</Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-text-primary">{activeTabLabel}</span>
        </nav>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 className="text-5xl md:text-6xl font-serif text-text-primary mb-2">Settings</h1>
          <p className="text-lg text-text-secondary">
            Customize your settings and preferences
          </p>
        </motion.div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-tertiary" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search settings..."
              className="w-full pl-10 pr-4 py-2.5 bg-surface border border-border rounded-xl text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent"
              aria-label="Search settings"
            />
          </div>
        </div>

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
              {filteredTabs.map((tab) => (
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
              {filteredTabs.length === 0 && (
                <p className="px-4 py-3 text-sm text-text-tertiary">No matching sections</p>
              )}
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
      </div>
    </div>
  );
}
