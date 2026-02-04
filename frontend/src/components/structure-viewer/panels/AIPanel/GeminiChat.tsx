'use client';

import { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, Loader2 } from 'lucide-react';
import type { ChatMessage } from '@/types/ai.types';

interface SuggestedPromptProps {
  children: string;
  onClick: (text: string) => void;
}

function SuggestedPrompt({ children, onClick }: SuggestedPromptProps) {
  return (
    <button
      type="button"
      onClick={() => onClick(children.replace(/^["']|["']$/g, '').trim())}
      className="block w-full text-left px-3 py-2 rounded-lg border border-border/50 bg-white hover:bg-accent/5 hover:border-accent/30 hover:shadow-sm text-xs text-text-secondary font-serif transition-all"
    >
      {children}
    </button>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[85%] rounded-xl px-3.5 py-2 text-sm font-serif shadow-sm ${
          isUser
            ? 'bg-gradient-to-br from-accent to-accent/90 text-white'
            : 'bg-white border border-border/50 text-text-primary'
        }`}
      >
        <div className="whitespace-pre-wrap break-words leading-relaxed">
          {message.content || '…'}
        </div>
      </div>
    </div>
  );
}

interface GeminiChatProps {
  structureContext: string;
}

export function GeminiChat({ structureContext }: GeminiChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;

    const userMessage: ChatMessage = { role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setStreaming(true);

    const placeholder: ChatMessage = { role: 'assistant', content: '' };
    setMessages((prev) => [...prev, placeholder]);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMessage],
          currentStructure: structureContext,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Unable to connect to AI service. Please try again.');
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let full = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = { role: 'assistant', content: full };
            return next;
          });
        }
      }
    } catch (err) {
      let errorMessage = 'Sorry, something went wrong. Please try again.';
      
      if (err instanceof Error) {
        if (err.message.includes('rate limit') || err.message.includes('quota')) {
          errorMessage = 'The AI service is temporarily at capacity. Please try again in a few moments.';
        } else if (err.message.includes('configured') || err.message.includes('support')) {
          errorMessage = err.message;
        } else if (err.message) {
          errorMessage = err.message;
        }
      }
      
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: 'assistant', content: `⚠️ ${errorMessage}` };
        return next;
      });
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {messages.length === 0 && (
        <div className="flex-1 flex items-center justify-center px-4 py-6">
          <div className="text-center max-w-xs">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent/10 to-accent/5 flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-8 h-8 text-accent" />
            </div>
            <h3 className="text-base font-semibold text-text-primary mb-2 font-serif">
              Ready to help!
            </h3>
            <p className="text-xs text-text-secondary mb-4 font-serif">
              Ask about {structureContext} or CRISPR mechanisms
            </p>
            <div className="space-y-1.5">
              <SuggestedPrompt onClick={setInput}>
                &quot;Explain the HNH domain&apos;s role in cleavage&quot;
              </SuggestedPrompt>
              <SuggestedPrompt onClick={setInput}>
                &quot;How does PAM recognition work?&quot;
              </SuggestedPrompt>
              <SuggestedPrompt onClick={setInput}>
                &quot;Compare this to Cas12a mechanism&quot;
              </SuggestedPrompt>
            </div>
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-1 py-2 min-h-0"
      >
        {messages.map((msg, idx) => (
          <MessageBubble key={idx} message={msg} />
        ))}
      </div>

      <div className="border-t border-border/50 p-3 flex-shrink-0 bg-white/80 backdrop-blur-sm">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Ask about structure, function, mutations..."
            className="flex-1 px-3 py-2 border border-border/50 rounded-lg focus:ring-2 focus:ring-accent/30 focus:border-accent/50 bg-white text-text-primary placeholder:text-text-tertiary font-serif text-sm transition-all"
            disabled={streaming}
            aria-label="Chat input"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={streaming || !input.trim()}
            className="px-3 py-2 bg-gradient-to-br from-accent to-accent/90 text-white rounded-lg hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            aria-label="Send"
          >
            {streaming ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
        <p className="text-xs text-text-tertiary mt-2 font-serif">
          Responses may contain errors. Verify critical information independently.
        </p>
      </div>
    </div>
  );
}
