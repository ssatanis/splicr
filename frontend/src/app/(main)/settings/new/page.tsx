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
  Activity,
  Target,
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
  | "advanced"
  | "tea-settings"
  | "txscore-settings";

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
  { id: "tea-settings", label: "TEA Settings", icon: <Activity className="w-4 h-4" />, description: "Editability Atlas configuration" },
  { id: "txscore-settings", label: "TxScore Settings", icon: <Target className="w-4 h-4" />, description: "Therapeutic translation weights & thresholds" },
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
      case "tea-settings":
        return <TEASettingsPanel />;
      case "txscore-settings":
        return <TxScoreSettingsPanel />;
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

// ─── Tool-Specific Settings Panels ──────────────────────────────────────────

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-5 border-b border-border last:border-0">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-serif font-medium text-text-primary">{label}</div>
        {description && <div className="text-xs text-text-tertiary font-serif mt-0.5">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SelectInput({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-background border border-border rounded-lg px-3 py-2 text-sm font-serif text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${checked ? "bg-accent" : "bg-border"}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

function TEASettingsPanel() {
  const [editor, setEditor] = useState("base-editor");
  const [pam, setPam] = useState("ngg");
  const [tissue, setTissue] = useState("generic");
  const [offTargetStringency, setOffTargetStringency] = useState("moderate");
  const [showPatientVCF, setShowPatientVCF] = useState(false);
  const [autoAnalyze, setAutoAnalyze] = useState(false);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-serif text-text-primary mb-1">Editability Atlas (TEA) Settings</h2>
        <p className="text-text-secondary text-sm font-serif">Configure default parameters for EDIT score calculations and off-target analysis.</p>
      </div>

      <div className="bg-surface border border-border rounded-2xl p-6">
        <h3 className="text-sm font-serif font-medium text-text-secondary uppercase tracking-wider mb-4">Editor Configuration</h3>
        <div className="divide-y divide-border">
          <SettingRow label="Default Editor Type" description="Primary editing strategy for new analyses">
            <SelectInput value={editor} onChange={setEditor} options={[
              { value: "base-editor", label: "Base Editor (ABE/CBE)" },
              { value: "prime-editor", label: "Prime Editor (PE2/PE3)" },
              { value: "nuclease", label: "CRISPR Nuclease (Cas9)" },
              { value: "auto", label: "Auto-select best strategy" },
            ]} />
          </SettingRow>
          <SettingRow label="PAM Variant" description="SpCas9 (NGG) is most commonly used">
            <SelectInput value={pam} onChange={setPam} options={[
              { value: "ngg", label: "SpCas9 (NGG)" },
              { value: "nngrrt", label: "SaCas9 (NNGRRT)" },
              { value: "ng", label: "Cas9-NG (NG)" },
              { value: "xcas9", label: "xCas9 (flexible)" },
            ]} />
          </SettingRow>
          <SettingRow label="Default Tissue Context" description="Tissue used for chromatin accessibility and delivery scoring">
            <SelectInput value={tissue} onChange={setTissue} options={[
              { value: "generic", label: "Generic (tissue-agnostic)" },
              { value: "hspc", label: "Hematopoietic Stem Cells" },
              { value: "liver", label: "Liver (Hepatocytes)" },
              { value: "lung", label: "Lung Epithelium" },
              { value: "cns", label: "CNS (Neurons)" },
              { value: "muscle", label: "Skeletal Muscle" },
            ]} />
          </SettingRow>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-2xl p-6">
        <h3 className="text-sm font-serif font-medium text-text-secondary uppercase tracking-wider mb-4">Off-Target Analysis</h3>
        <div className="divide-y divide-border">
          <SettingRow label="Off-Target Stringency" description="Maximum mismatches allowed when searching for off-target sites">
            <SelectInput value={offTargetStringency} onChange={setOffTargetStringency} options={[
              { value: "strict", label: "Strict (0 mismatches)" },
              { value: "moderate", label: "Moderate (≤ 2 mismatches)" },
              { value: "relaxed", label: "Relaxed (≤ 4 mismatches)" },
            ]} />
          </SettingRow>
          <SettingRow label="Enable Patient VCF Input" description="Allow uploading patient genome VCF for personalized off-target analysis">
            <Toggle checked={showPatientVCF} onChange={setShowPatientVCF} />
          </SettingRow>
          <SettingRow label="Auto-analyze on input" description="Automatically run analysis when a sequence is pasted">
            <Toggle checked={autoAnalyze} onChange={setAutoAnalyze} />
          </SettingRow>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          className="px-5 py-2.5 bg-accent text-white rounded-xl text-sm font-serif hover:bg-accent/90 transition-colors"
          onClick={() => {
            if (typeof window !== 'undefined') {
              localStorage.setItem('splicr_tea_settings', JSON.stringify({ editor, pam, tissue, offTargetStringency, showPatientVCF, autoAnalyze }));
            }
          }}
        >
          Save TEA Settings
        </button>
      </div>
    </div>
  );
}

function TxScoreSettingsPanel() {
  const [weights, setWeights] = useState({ efficacy: 30, safety: 25, druggability: 20, precedent: 15, stratification: 10 });
  const [minTvs, setMinTvs] = useState(0.5);
  const [cancerTypes, setCancerTypes] = useState(["pan-cancer"]);
  const [includeDepmap, setIncludeDepmap] = useState(true);
  const [includeGtex, setIncludeGtex] = useState(true);
  const [includeGnomad, setIncludeGnomad] = useState(true);
  const [includeClinvar, setIncludeClinvar] = useState(true);
  const [includeAlphafold, setIncludeAlphafold] = useState(true);

  const totalWeight = Object.values(weights).reduce((s, v) => s + v, 0);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-serif text-text-primary mb-1">Therapeutic Translation (TxScore) Settings</h2>
        <p className="text-text-secondary text-sm font-serif">Customize TVS subscore weights, cancer type defaults, and data source toggles.</p>
      </div>

      {/* Subscore weights */}
      <div className="bg-surface border border-border rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-serif font-medium text-text-secondary uppercase tracking-wider">Subscore Weights</h3>
          <span className={`text-xs font-mono font-medium px-2 py-1 rounded ${totalWeight === 100 ? 'text-green-400 bg-green-400/10' : 'text-amber-400 bg-amber-400/10'}`}>
            Total: {totalWeight}/100
          </span>
        </div>
        <div className="space-y-4">
          {(Object.entries(weights) as [keyof typeof weights, number][]).map(([key, value]) => (
            <div key={key}>
              <div className="flex justify-between text-xs font-serif mb-1">
                <span className="capitalize text-text-secondary">{key}</span>
                <span className="text-text-primary font-medium">{value}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={60}
                value={value}
                onChange={(e) => setWeights(prev => ({ ...prev, [key]: Number(e.target.value) }))}
                className="w-full accent-accent"
              />
            </div>
          ))}
        </div>
        {totalWeight !== 100 && (
          <p className="text-xs text-amber-400 font-serif mt-3">Weights should sum to 100 for balanced scoring.</p>
        )}
      </div>

      {/* Threshold */}
      <div className="bg-surface border border-border rounded-2xl p-6">
        <h3 className="text-sm font-serif font-medium text-text-secondary uppercase tracking-wider mb-4">Display Thresholds</h3>
        <SettingRow label="Minimum TVS to Display" description={`Only show targets with TVS ≥ ${minTvs.toFixed(2)}`}>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={minTvs}
              onChange={(e) => setMinTvs(Number(e.target.value))}
              className="w-32 accent-accent"
            />
            <span className="text-sm font-mono text-text-primary w-10 text-right">{minTvs.toFixed(2)}</span>
          </div>
        </SettingRow>
      </div>

      {/* Data sources */}
      <div className="bg-surface border border-border rounded-2xl p-6">
        <h3 className="text-sm font-serif font-medium text-text-secondary uppercase tracking-wider mb-4">Data Sources</h3>
        <div className="divide-y divide-border">
          <SettingRow label="DepMap (Chronos Essentiality)" description="CRISPR dependency data — required for Efficacy score">
            <Toggle checked={includeDepmap} onChange={setIncludeDepmap} />
          </SettingRow>
          <SettingRow label="GTEx (Tissue Expression)" description="54-tissue expression profiles — required for Safety score">
            <Toggle checked={includeGtex} onChange={setIncludeGtex} />
          </SettingRow>
          <SettingRow label="gnomAD (Constraint Scores)" description="LOEUF and pLI genetic constraint metrics">
            <Toggle checked={includeGnomad} onChange={setIncludeGnomad} />
          </SettingRow>
          <SettingRow label="ClinVar (Pathogenic Variants)" description="Mendelian disease evidence for Precedent score">
            <Toggle checked={includeClinvar} onChange={setIncludeClinvar} />
          </SettingRow>
          <SettingRow label="AlphaFold (Structural Data)" description="Protein structure confidence (pLDDT) for Druggability score">
            <Toggle checked={includeAlphafold} onChange={setIncludeAlphafold} />
          </SettingRow>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          className="px-5 py-2.5 bg-accent text-white rounded-xl text-sm font-serif hover:bg-accent/90 transition-colors"
          onClick={() => {
            if (typeof window !== 'undefined') {
              localStorage.setItem('splicr_txscore_settings', JSON.stringify({ weights, minTvs, cancerTypes, includeDepmap, includeGtex, includeGnomad, includeClinvar, includeAlphafold }));
            }
          }}
        >
          Save TxScore Settings
        </button>
      </div>
    </div>
  );
}
