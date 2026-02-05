'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface Comment {
  id: string;
  analysisId: string;
  userId: string;
  parentCommentId?: string | null;
  targetType: 'gene' | 'plot' | 'analysis' | 'result_row';
  targetId?: string | null;
  content: string;
  mentions: Array<{ user_id: string; display_name: string }>;
  isResolved: boolean;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  user: {
    displayName: string;
    avatarUrl: string | null;
  };
  replies: Comment[];
  reactions: Array<{ reaction: string; count: number; users: string[] }>;
}

export function useComments(analysisId: string, targetType?: string, targetId?: string) {
  const { user } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchComments = useCallback(async () => {
    if (!analysisId) return;
    setLoading(true);

    try {
      let query = supabase
        .from('analysis_comments')
        .select('*')
        .eq('analysis_id', analysisId)
        .order('created_at', { ascending: false });

      if (targetType) query = query.eq('target_type', targetType);
      if (targetId) query = query.eq('target_id', targetId);

      const { data: allComments, error } = await query;

      if (error) {
        setComments([]);
        setLoading(false);
        return;
      }

      const list = allComments ?? [];

    const mapUserFromRow = (row: any) => ({
      displayName: row?.user?.display_name ?? row?.user?.email ?? 'User',
      avatarUrl: row?.user?.avatar_url ?? null,
    });

    const mapRow = (row: any, replies: any[] = []): Comment => ({
      id: row.id,
      analysisId: row.analysis_id,
      userId: row.user_id,
      parentCommentId: row.parent_comment_id,
      targetType: row.target_type ?? 'analysis',
      targetId: row.target_id,
      content: row.content ?? '',
      mentions: Array.isArray(row.mentions) ? row.mentions : [],
      isResolved: !!row.is_resolved,
      resolvedBy: row.resolved_by,
      resolvedAt: row.resolved_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? row.created_at,
      edited: !!row.edited,
      user: mapUserFromRow(row),
      replies: replies.map((r: any) => mapRow(r, [])),
      reactions: Array.isArray(row.reactions) ? row.reactions : [],
    });

    // Separate top-level comments and replies
    const topLevelComments = list.filter((c: any) => !c.parent_comment_id);
    const repliesMap = new Map<string, any[]>();

    // Group replies by parent comment ID
    list
      .filter((c: any) => c.parent_comment_id)
      .forEach((reply: any) => {
        if (!repliesMap.has(reply.parent_comment_id)) {
          repliesMap.set(reply.parent_comment_id, []);
        }
        repliesMap.get(reply.parent_comment_id)!.push(reply);
      });

    // Sort replies chronologically (oldest first) within each parent
    repliesMap.forEach((replies) => {
      replies.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    });

    // Build comment tree with replies
    const commentsWithReplies = topLevelComments.map((comment: any) => {
      const replies = repliesMap.get(comment.id) ?? [];
      return mapRow(comment, replies);
    });

      setComments(commentsWithReplies);
    } catch {
      setComments([]);
    }
    setLoading(false);
  }, [analysisId, targetType, targetId]);

  useEffect(() => {
    if (!analysisId) return;
    fetchComments();

    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`comments:${analysisId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'analysis_comments',
            filter: `analysis_id=eq.${analysisId}`,
          },
          () => fetchComments()
        )
        .subscribe();
    } catch {
      // Table may not exist or realtime unavailable
    }

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [analysisId, targetType, targetId, fetchComments]);

  const addComment = useCallback(
    async (
      content: string,
      targetType: Comment['targetType'],
      targetId?: string,
      parentCommentId?: string
    ) => {
      if (!user) return null;

      try {
        const mentionRegex = /@(\w+)/g;
        const mentions: Array<{ user_id: string; display_name: string }> = [];
        let match;
        while ((match = mentionRegex.exec(content)) !== null) {
          mentions.push({ user_id: '', display_name: match[1] });
        }

        const { data, error } = await (supabase.from('analysis_comments') as any)
          .insert({
            analysis_id: analysisId,
            user_id: user.id,
            parent_comment_id: parentCommentId ?? null,
            target_type: targetType,
            target_id: targetId ?? null,
            content,
            mentions,
          })
          .select()
          .single();

        if (error) return null;

        try {
          await (supabase.from('analysis_activity') as any).insert({
            analysis_id: analysisId,
            user_id: user.id,
            activity_type: 'comment_added',
            description: `Commented on ${targetType}${targetId ? `: ${targetId}` : ''}`,
            metadata: { comment_id: data.id, target_type: targetType, target_id: targetId },
          });
        } catch {
          // activity table may not exist
        }
        return data;
      } catch {
        return null;
      }
    },
    [analysisId, user]
  );

  const updateComment = useCallback(
    async (commentId: string, content: string) => {
      if (!user) return;
      try {
        await (supabase.from('analysis_comments') as any)
          .update({ content, edited: true, updated_at: new Date().toISOString() })
          .eq('id', commentId)
          .eq('user_id', user.id);
      } catch {
        // Table may not exist
      }
    },
    [user]
  );

  const deleteComment = useCallback(
    async (commentId: string) => {
      if (!user) return;
      try {
        await (supabase.from('analysis_comments') as any).delete().eq('id', commentId).eq('user_id', user.id);
      } catch {
        // Table may not exist
      }
    },
    [user]
  );

  const resolveComment = useCallback(
    async (commentId: string) => {
      if (!user) return;
      try {
        await (supabase.from('analysis_comments') as any)
          .update({
            is_resolved: true,
            resolved_by: user.id,
            resolved_at: new Date().toISOString(),
          })
          .eq('id', commentId);

        try {
          await (supabase.from('analysis_activity') as any).insert({
            analysis_id: analysisId,
            user_id: user.id,
            activity_type: 'comment_resolved',
            description: 'Resolved a comment',
            metadata: { comment_id: commentId },
          });
        } catch {
          // activity table may not exist
        }
      } catch {
        // Table may not exist
      }
    },
    [analysisId, user]
  );

  const addReaction = useCallback(
    async (commentId: string, reaction: string) => {
      if (!user) return;
      try {
        await (supabase.from('comment_reactions') as any).upsert({
          comment_id: commentId,
          user_id: user.id,
          reaction,
        });
      } catch {
        // Table may not exist
      }
    },
    [user]
  );

  const removeReaction = useCallback(
    async (commentId: string, reaction: string) => {
      if (!user) return;
      try {
        await supabase
          .from('comment_reactions')
          .delete()
          .eq('comment_id', commentId)
          .eq('user_id', user.id)
          .eq('reaction', reaction);
      } catch {
        // Table may not exist
      }
    },
    [user]
  );

  return {
    comments,
    loading,
    addComment,
    updateComment,
    deleteComment,
    resolveComment,
    addReaction,
    removeReaction,
    refetch: fetchComments,
  };
}
