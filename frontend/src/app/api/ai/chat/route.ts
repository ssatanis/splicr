import { NextRequest } from 'next/server';
import { streamGeminiChat, type ChatMessage, AIServiceError } from '@/lib/ai/gemini-client';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const messages = Array.isArray(body.messages) ? body.messages as ChatMessage[] : [];
    const currentStructure = typeof body.currentStructure === 'string' ? body.currentStructure.trim() : '';

    if (!currentStructure) {
      return new Response(
        JSON.stringify({ error: 'Structure context is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamGeminiChat(messages, currentStructure)) {
            controller.enqueue(encoder.encode(chunk));
          }
        } catch (err) {
          if (err instanceof AIServiceError) {
            // Send user-friendly error message as part of the stream
            controller.enqueue(encoder.encode(err.userMessage || err.message));
          } else {
            controller.enqueue(encoder.encode('An unexpected error occurred. Please try again.'));
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (err) {
    if (err instanceof AIServiceError) {
      return new Response(
        JSON.stringify({ error: err.userMessage || err.message }),
        { status: err.statusCode, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({ error: 'An unexpected error occurred. Please try again.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
