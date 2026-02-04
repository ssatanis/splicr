const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const API_V1 = `${API_URL}/api/v1`;

export interface AuthUser {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: AuthUser;
}

export async function register(email: string, password: string, displayName?: string): Promise<TokenResponse> {
  const res = await fetch(`${API_V1}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, display_name: displayName || null }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Registration failed");
  }
  return res.json();
}

export async function login(email: string, password: string): Promise<TokenResponse> {
  const res = await fetch(`${API_V1}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Invalid email or password");
  }
  return res.json();
}

export async function getMe(token: string): Promise<AuthUser> {
  const res = await fetch(`${API_V1}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Not authenticated");
  return res.json();
}

export interface UploadUrlResponse {
  uploadUrl: string;
  fileKey: string;
}

export interface AnalysisRequest {
  fileKeys: string[];
  libraryType: string;
  sampleNames: string[];
}

export interface AnalysisResponse {
  analysisId: string;
  status: string;
}

export interface StatusResponse {
  status: "queued" | "running" | "complete" | "failed";
  progress: number;
  currentStep: string;
}

export async function getUploadUrl(filename: string): Promise<UploadUrlResponse> {
  const response = await fetch(`${API_V1}/upload/presigned-url?filename=${filename}`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("Failed to get upload URL");
  }
  return response.json();
}

export async function submitAnalysis(request: AnalysisRequest): Promise<AnalysisResponse> {
  const response = await fetch(`${API_URL}/analysis/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error("Failed to submit analysis");
  }
  return response.json();
}

export async function getAnalysisStatus(analysisId: string): Promise<StatusResponse> {
  const response = await fetch(`${API_V1}/analysis/${analysisId}/status`);
  if (!response.ok) {
    throw new Error("Failed to get analysis status");
  }
  return response.json();
}
