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

export async function getAuthToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("splicr_auth_token");
}

async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const token = await getAuthToken();
  const headers = {
    ...options.headers,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(url, { ...options, headers });

  // Handle 401 Unauthorized by potentially redirecting to login (or let caller handle)
  if (res.status === 401 && typeof window !== "undefined") {
    // Optional: Redirect to login or clear token
  }

  return res;
}

export async function getUploadUrl(filename: string): Promise<UploadUrlResponse> {
  const response = await fetchWithAuth(`${API_V1}/upload/presigned-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, file_type: "application/octet-stream" }) // Added file_type
  });
  if (!response.ok) {
    throw new Error("Failed to get upload URL");
  }
  return response.json();
}

export async function submitAnalysis(request: AnalysisRequest): Promise<AnalysisResponse> {
  const response = await fetchWithAuth(`${API_V1}/analysis/submit`, { // Fixed URL to API_V1
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      file_keys: request.fileKeys, // CamelCase to snake_case mapping
      library_type: request.libraryType,
      sample_names: request.sampleNames,
      algorithm: "mageck", // Default or passed
      parameters: {}
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to submit analysis");
  }
  return response.json();
}

export async function getAnalysisStatus(analysisId: string): Promise<StatusResponse> {
  const response = await fetchWithAuth(`${API_V1}/analysis/${analysisId}/status`);
  if (!response.ok) {
    throw new Error("Failed to get analysis status");
  }
  return response.json();
}

// --- API Key Management ---

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  key?: string; // Only on creation
}

export async function listApiKeys(): Promise<ApiKey[]> {
  const response = await fetchWithAuth(`${API_V1}/api-keys/`);
  if (!response.ok) throw new Error("Failed to fetch API keys");
  return response.json();
}

export async function createApiKey(name: string, scopes: string[] = ["*"]): Promise<ApiKey> {
  const response = await fetchWithAuth(`${API_V1}/api-keys/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, scopes }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to create API key");
  }
  return response.json();
}

export async function revokeApiKey(keyId: string): Promise<void> {
  const response = await fetchWithAuth(`${API_V1}/api-keys/${keyId}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("Failed to revoke API key");
}
