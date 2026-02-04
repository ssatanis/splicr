"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  User,
  Building2,
  FileText,
  ExternalLink,
  Loader2,
  AlertCircle,
  BarChart3,
} from "lucide-react";
import { formatDate } from "@/lib/utils";

interface ProfileUser {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  institution: string | null;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  institution: string | null;
}

interface PublicAnalysis {
  id: string;
  analysis_id: string;
  title: string;
  description: string | null;
  published_at: string;
  views: number;
  likes: number;
}

export default function PublicProfilePage() {
  const params = useParams();
  const publicProfileId = params?.publicProfileId as string;
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [publicAnalyses, setPublicAnalyses] = useState<PublicAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  useEffect(() => {
    if (!publicProfileId) {
      setLoading(false);
      setError("Invalid profile link.");
      return;
    }

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data: userData, error: userError } = await supabase
          .from("users")
          .select("id, full_name, avatar_url, bio, institution")
          .eq("public_profile_id", publicProfileId)
          .eq("public_profile_enabled", true)
          .maybeSingle();

        if (userError) {
          setError("Could not load profile.");
          return;
        }
        if (!userData) {
          setError("Profile not found or not public.");
          return;
        }

        const userRow = userData as { id: string; full_name?: string | null; avatar_url?: string | null; bio?: string | null; institution?: string | null };
        setUser({
          id: userRow.id,
          full_name: userRow.full_name ?? null,
          avatar_url: userRow.avatar_url ?? null,
          bio: userRow.bio ?? null,
          institution: userRow.institution ?? null,
        });

        const { data: profileData } = await supabase
          .from("profiles")
          .select("id, full_name, display_name, avatar_url, institution")
          .eq("id", userRow.id)
          .maybeSingle();

        if (profileData) setProfile(profileData as ProfileRow);

        const { data: analysesData } = await supabase
          .from("public_analyses")
          .select("id, analysis_id, title, description, published_at, views, likes")
          .eq("published_by", userRow.id)
          .order("published_at", { ascending: false });

        setPublicAnalyses((analysesData as PublicAnalysis[] | null) ?? []);
      } catch {
        setError("Something went wrong.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [publicProfileId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-10 h-10 animate-spin text-accent" />
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <AlertCircle className="w-12 h-12 text-text-tertiary mx-auto mb-4" />
        <h1 className="text-xl font-serif text-text-primary mb-2">Profile unavailable</h1>
        <p className="text-text-secondary mb-6">{error ?? "Profile not found or not public."}</p>
        <Link
          href="/"
          className="text-accent hover:underline"
        >
          Back to home
        </Link>
      </div>
    );
  }

  const displayName =
    profile?.display_name || profile?.full_name || user.full_name || "Researcher";
  const avatarUrl = profile?.avatar_url || user.avatar_url;
  const institution = profile?.institution || user.institution;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Profile header */}
      <div className="bg-surface rounded-xl border border-border p-6 mb-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
          <div className="w-20 h-20 rounded-full bg-background border-2 border-border overflow-hidden flex items-center justify-center flex-shrink-0">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={displayName}
                className="w-full h-full object-cover"
              />
            ) : (
              <User className="w-10 h-10 text-text-tertiary" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-serif text-text-primary truncate">
              {displayName}
            </h1>
            {institution && (
              <p className="flex items-center gap-2 text-text-secondary mt-1">
                <Building2 className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{institution}</span>
              </p>
            )}
            {user.bio && (
              <p className="text-sm text-text-secondary mt-2 line-clamp-3">
                {user.bio}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Published analyses */}
      <section>
        <h2 className="text-lg font-serif text-text-primary mb-4 flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          Published analyses
        </h2>
        {publicAnalyses.length === 0 ? (
          <div className="bg-surface rounded-xl border border-border p-8 text-center text-text-secondary">
            <FileText className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p>No published analyses yet.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {publicAnalyses.map((pa) => (
              <li key={pa.id}>
                <Link
                  href={`/results/${pa.analysis_id}`}
                  className="block bg-surface rounded-xl border border-border p-4 hover:border-accent/50 transition-colors group"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-serif text-text-primary group-hover:text-accent truncate">
                        {pa.title || "Untitled analysis"}
                      </h3>
                      {pa.description && (
                        <p className="text-sm text-text-secondary mt-1 line-clamp-2">
                          {pa.description}
                        </p>
                      )}
                      <p className="text-xs text-text-tertiary mt-2">
                        Published {formatDate(pa.published_at)}
                        {typeof pa.views === "number" && (
                          <> · {pa.views} views</>
                        )}
                      </p>
                    </div>
                    <ExternalLink className="w-5 h-5 text-text-tertiary flex-shrink-0 mt-0.5" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
