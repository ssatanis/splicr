/**
 * SplicR AI: Google Gemini 2.0 Flash client for structure intelligence.
 * Server-side only — used by API routes. Keep GEMINI_API_KEY in env (no NEXT_PUBLIC).
 */

import { GoogleGenerativeAI, type Content, type Part } from '@google/generative-ai';

const MODEL = 'gemini-2.0-flash';

function getClient(): GoogleGenerativeAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key?.trim()) return null;
  return new GoogleGenerativeAI(key);
}

/**
 * Custom error class for user-facing AI errors
 */
export class AIServiceError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public userMessage?: string
  ) {
    super(message);
    this.name = 'AIServiceError';
  }
}

/**
 * Handle and format API errors for user consumption
 */
function handleAPIError(error: unknown): AIServiceError {
  if (error instanceof AIServiceError) {
    return error;
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  
  // Rate limit errors
  if (errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('Too Many Requests')) {
    return new AIServiceError(
      'Rate limit exceeded',
      429,
      'The AI service is temporarily unavailable due to rate limits. Please try again in a few moments.'
    );
  }
  
  // Authentication errors
  if (errorMessage.includes('401') || errorMessage.includes('403') || errorMessage.includes('API key')) {
    return new AIServiceError(
      'Authentication failed',
      503,
      'The AI service is not properly configured. Please contact support.'
    );
  }
  
  // Timeout errors
  if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
    return new AIServiceError(
      'Request timeout',
      504,
      'The AI service took too long to respond. Please try again.'
    );
  }
  
  // Network errors
  if (errorMessage.includes('network') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch')) {
    return new AIServiceError(
      'Network error',
      503,
      'Unable to connect to the AI service. Please check your connection and try again.'
    );
  }
  
  // Generic error
  return new AIServiceError(
    errorMessage,
    500,
    'An unexpected error occurred. Please try again or contact support if the issue persists.'
  );
}

export interface PDBMetadata {
  title?: string | null;
  organism?: string | null;
  method?: string | null;
  resolution?: number | null;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Generate a one-shot structure explanation. */
export async function explainStructure(
  pdbId: string,
  metadata: PDBMetadata,
  userQuestion?: string
): Promise<string> {
  const genAI = getClient();
  if (!genAI) {
    throw new AIServiceError(
      'GEMINI_API_KEY is not configured',
      503,
      'The AI service is not properly configured. Please contact support.'
    );
  }

  const prompt = `You are a structural biologist explaining CRISPR protein structures to researchers.

Structure: ${pdbId}
Title: ${metadata.title ?? '—'}
Organism: ${metadata.organism ?? '—'}
Method: ${metadata.method ?? '—'}
Resolution: ${metadata.resolution != null ? `${metadata.resolution}Å` : '—'}

${userQuestion ? `User asks: "${userQuestion}"` : 'Provide a comprehensive explanation.'}

Focus on:
1. Biological function and mechanism
2. Key structural features (domains, active sites)
3. CRISPR-specific context (PAM recognition, guide RNA binding, cleavage mechanism)
4. Implications for genome editing applications
5. Known mutations and their functional effects

Be scientifically rigorous but accessible. Use analogies when helpful.`;

  try {
    const model = genAI.getGenerativeModel({ model: MODEL });
    const result = await model.generateContent(prompt);
    const response = result.response;
    return response.text() ?? '';
  } catch (error) {
    throw handleAPIError(error);
  }
}

/** Stream chat responses with structure context. */
export async function* streamGeminiChat(
  conversationHistory: ChatMessage[],
  currentStructure: string
): AsyncGenerator<string, void, unknown> {
  const genAI = getClient();
  if (!genAI) {
    throw new AIServiceError(
      'GEMINI_API_KEY is not configured',
      503,
      'The AI service is not properly configured. Please contact support.'
    );
  }

  const history: Content[] = conversationHistory.slice(0, -1).map((msg) => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.content }],
  }));

  const lastMessage = conversationHistory[conversationHistory.length - 1];
  const userContent =
    lastMessage?.role === 'user'
      ? `Current structure in viewer: ${currentStructure}. ${lastMessage.content}`
      : `Current structure in viewer: ${currentStructure}. Please introduce yourself as the AI Structure Assistant.`;

  try {
    const model = genAI.getGenerativeModel({
      model: MODEL,
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 2048,
      },
    });

    const chat = model.startChat({ history });
    const result = await chat.sendMessageStream(userContent);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) yield text;
    }
  } catch (error) {
    throw handleAPIError(error);
  }
}

/** Predict functional effect of a mutation. */
export async function predictMutationEffect(
  pdbId: string,
  residue: string,
  mutation: string,
  structuralContext: string
): Promise<string> {
  const genAI = getClient();
  if (!genAI) {
    throw new AIServiceError(
      'GEMINI_API_KEY is not configured',
      503,
      'The AI service is not properly configured. Please contact support.'
    );
  }

  const prompt = `Predict the functional effect of mutation ${residue}→${mutation} in ${pdbId}.

Structural context:
${structuralContext}

Analyze:
1. Location (active site, interface, core, surface?)
2. Chemical property changes (charge, size, hydrophobicity)
3. Likely structural impact (destabilization, altered binding, etc.)
4. Functional consequences for CRISPR activity
5. Literature precedent if known

Provide confidence score (low/medium/high) and reasoning.`;

  try {
    const model = genAI.getGenerativeModel({ model: MODEL });
    const result = await model.generateContent(prompt);
    return result.response.text() ?? '';
  } catch (error) {
    throw handleAPIError(error);
  }
}

/** Assess druggability of a binding pocket. */
export interface PocketGeometry {
  volume?: number;
  surfaceArea?: number;
  hpRatio?: string;
  residues?: string[];
}

export async function assessDruggability(
  pdbId: string,
  targetResidue: string,
  pocketGeometry: PocketGeometry
): Promise<string> {
  const genAI = getClient();
  if (!genAI) {
    throw new AIServiceError(
      'GEMINI_API_KEY is not configured',
      503,
      'The AI service is not properly configured. Please contact support.'
    );
  }

  const prompt = `Assess druggability of binding pocket near ${targetResidue} in ${pdbId}.

Pocket characteristics:
- Volume: ${pocketGeometry.volume ?? '—'} Å³
- Surface area: ${pocketGeometry.surfaceArea ?? '—'} Å²
- Hydrophobic/hydrophilic ratio: ${pocketGeometry.hpRatio ?? '—'}
- Residue composition: ${(pocketGeometry.residues ?? []).join(', ') || '—'}

Evaluate:
1. Geometric suitability (size, shape, depth)
2. Chemical tractability (polarity, charge distribution)
3. Accessibility (surface exposure, steric hindrances)
4. Similar known drug targets
5. Potential scaffold molecules

Provide druggability score (1-10) and recommendations.`;

  try {
    const model = genAI.getGenerativeModel({ model: MODEL });
    const result = await model.generateContent(prompt);
    return result.response.text() ?? '';
  } catch (error) {
    throw handleAPIError(error);
  }
}

/** Generate educational narrative for a structure. */
export type UserLevel = 'undergraduate' | 'graduate' | 'expert';

export async function generateEducationalNarrative(
  pdbId: string,
  userLevel: UserLevel
): Promise<string> {
  const genAI = getClient();
  if (!genAI) {
    throw new AIServiceError(
      'GEMINI_API_KEY is not configured',
      503,
      'The AI service is not properly configured. Please contact support.'
    );
  }

  const levelContext: Record<UserLevel, string> = {
    undergraduate:
      'Use analogies, avoid jargon, explain basic concepts.',
    graduate:
      'Assume molecular biology background, use technical terms with brief explanations.',
    expert:
      'Full technical detail, cite mechanisms, discuss nuances.',
  };

  const prompt = `Create an educational narrative about ${pdbId} for ${userLevel} level.

${levelContext[userLevel]}

Structure as a story:
1. Discovery context (why was this structure solved?)
2. Architectural tour (walk through the structure region by region)
3. Mechanism in action (how does it work?)
4. Why it matters (applications, implications)
5. Open questions (what don't we know yet?)

Make it engaging and memorable.`;

  try {
    const model = genAI.getGenerativeModel({ model: MODEL });
    const result = await model.generateContent(prompt);
    return result.response.text() ?? '';
  } catch (error) {
    throw handleAPIError(error);
  }
}
