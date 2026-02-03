/** AI panel: chat and structure intelligence */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface PDBMetadataForAI {
  title?: string | null;
  organism?: string | null;
  method?: string | null;
  resolution?: number | null;
}

export type AIPanelTab = 'chat' | 'explain' | 'mutate' | 'drug';

/** PubMed literature article */
export interface PubMedArticle {
  pmid: string;
  title: string;
  authors?: string;
  journal?: string;
  year?: number;
  citationCount?: number;
  doi?: string;
  abstract?: string;
}
