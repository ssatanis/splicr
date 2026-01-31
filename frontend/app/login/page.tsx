"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { login } from "@/lib/api";

const AUTH_TOKEN_KEY = "splicr_auth_token";
const AUTH_USER_KEY = "splicr_auth_user";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await login(email, password);
      if (typeof window !== "undefined") {
        localStorage.setItem(AUTH_TOKEN_KEY, data.access_token);
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
        const stored = localStorage.getItem("splicr_user_data");
        const userData = stored ? JSON.parse(stored) : { userId: "", analyses: [], favorites: [], notes: {} };
        userData.userId = data.user.id;
        userData.email = data.user.email;
        localStorage.setItem("splicr_user_data", JSON.stringify(userData));
        if (data.user.display_name)
          localStorage.setItem("splicr_display_name", data.user.display_name);
      }
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Link href="/dashboard" className="block mb-12 w-fit hover:opacity-90 transition-opacity">
          <Image src="/logo.jpeg" alt="SplicR" width={140} height={48} className="h-12 w-auto object-contain" priority />
        </Link>
        <h1 className="text-4xl font-serif text-text-primary mb-2">Sign in</h1>
        <p className="text-text-secondary font-serif mb-8">
          Sign in to access your screen analyses and data.
        </p>
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-4 bg-error/10 border border-error/30 rounded-xl text-error text-sm font-serif">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 bg-surface border border-border rounded-xl font-serif text-text-primary focus:outline-none focus:ring-2 focus:ring-text-primary"
              placeholder="you@institution.edu"
            />
          </div>
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-3 bg-surface border border-border rounded-xl font-serif text-text-primary focus:outline-none focus:ring-2 focus:ring-text-primary"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-accent text-text-primary font-serif rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="mt-8 text-text-secondary font-serif text-sm">
          No account?{" "}
          <Link href="/register" className="text-text-primary underline hover:text-accent">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
