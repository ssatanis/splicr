'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  MessageSquare,
  Activity,
  Bell,
  X,
  Send,
  MoreVertical,
  Check,
  Edit2,
  Trash2,
} from 'lucide-react';
import { usePresence } from '@/lib/collaboration/usePresence';
import { useComments, type Comment } from '@/lib/collaboration/useComments';
import { useActivity } from '@/lib/collaboration/useActivity';
import { useNotifications } from '@/lib/collaboration/useNotifications';
import { formatDistanceToNow } from 'date-fns';
import Button from '@/components/Button';

interface CollaborationSidebarProps {
  analysisId: string;
  targetType?: 'gene' | 'plot' | 'analysis';
  targetId?: string;
  isOpen: boolean;
  onClose: () => void;
}

type SidebarTab = 'presence' | 'comments' | 'activity' | 'notifications';

export default function CollaborationSidebar({
  analysisId,
  targetType = 'analysis',
  targetId,
  isOpen,
  onClose,
}: CollaborationSidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('comments');
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);

  const { activeUsers } = usePresence(analysisId);
  const { comments, loading: commentsLoading, addComment, resolveComment, addReaction } = useComments(
    analysisId,
    targetType,
    targetId
  );
  const { activities } = useActivity(analysisId);
  const { notifications, markAsRead } = useNotifications();

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    await addComment(newComment, targetType, targetId, replyTo ?? undefined);
    setNewComment('');
    setReplyTo(null);
  };

  const tabs: { id: SidebarTab; label: string; icon: typeof Users; count: number }[] = [
    { id: 'presence', label: 'Online', icon: Users, count: activeUsers.length },
    { id: 'comments', label: 'Comments', icon: MessageSquare, count: comments.length },
    { id: 'activity', label: 'Activity', icon: Activity, count: activities.length },
    {
      id: 'notifications',
      label: 'Alerts',
      icon: Bell,
      count: notifications.filter((n) => !n.read).length,
    },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ x: 400 }}
          animate={{ x: 0 }}
          exit={{ x: 400 }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className="fixed right-0 top-0 h-full w-96 bg-surface dark:bg-gray-900 shadow-elevated z-50 flex flex-col border-l border-border dark:border-gray-800"
        >
          <div className="flex items-center justify-between p-4 border-b border-border dark:border-gray-800">
            <h2 className="text-lg font-serif font-semibold text-text-primary">Collaboration</h2>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-background dark:hover:bg-gray-800 text-text-secondary transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" strokeWidth={2} />
            </button>
          </div>

          <div className="flex border-b border-border dark:border-gray-800">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex-1 flex items-center justify-center gap-2 py-3 transition ${
                  activeTab === tab.id
                    ? 'text-[#6ABF36] border-b-2 border-[#6ABF36] bg-[#6ABF36]/5'
                    : 'text-text-secondary hover:text-text-primary dark:hover:text-gray-300'
                }`}
              >
                <tab.icon className="w-4 h-4" strokeWidth={1.5} />
                <span className="text-sm font-medium">{tab.label}</span>
                {tab.count > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-[#6ABF36] text-white text-xs rounded-full flex items-center justify-center">
                    {tab.count > 99 ? '99+' : tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {activeTab === 'presence' && (
              <div className="p-4 space-y-3">
                <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wide">
                  Currently viewing
                </h3>
                {activeUsers.length === 0 ? (
                  <p className="text-sm text-text-secondary font-serif">
                    No one else is viewing this analysis
                  </p>
                ) : (
                  activeUsers.map((user) => (
                    <motion.div
                      key={user.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-3 p-3 bg-background dark:bg-gray-800 rounded-xl border border-border dark:border-gray-700"
                    >
                      <div className="relative shrink-0">
                        <img
                          src={
                            user.avatarUrl ||
                            `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName)}&background=6ABF36&color=fff`
                          }
                          alt=""
                          className="w-10 h-10 rounded-full object-cover"
                        />
                        <div className="absolute bottom-0 right-0 w-3 h-3 bg-[#6ABF36] border-2 border-surface dark:border-gray-900 rounded-full" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-text-primary truncate">
                          {user.displayName}
                        </p>
                        <p className="text-xs text-text-tertiary">
                          {user.currentView === 'volcano_plot' && 'Viewing Volcano Plot'}
                          {user.currentView === 'results_table' && 'Viewing Results Table'}
                          {user.currentView === 'qc_plots' && 'Viewing QC Plots'}
                          {!['volcano_plot', 'results_table', 'qc_plots'].includes(user.currentView) &&
                            user.currentView}
                        </p>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'comments' && (
              <div className="p-4 space-y-4">
                <div className="sticky top-0 bg-surface dark:bg-gray-900 pb-4 border-b border-border dark:border-gray-800 z-10">
                  {replyTo && (
                    <div className="flex items-center justify-between mb-2 p-2 bg-[#6ABF36]/10 rounded-lg border border-[#6ABF36]/20">
                      <span className="text-sm text-[#6ABF36] font-medium">Replying to comment</span>
                      <button
                        type="button"
                        onClick={() => setReplyTo(null)}
                        className="text-text-secondary hover:text-text-primary"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <textarea
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder="Add a comment... Use @name to mention"
                      className="flex-1 p-3 border border-border dark:border-gray-700 rounded-xl resize-none focus:ring-2 focus:ring-[#6ABF36] focus:border-transparent bg-background dark:bg-gray-800 text-text-primary font-serif text-sm"
                      rows={3}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          handleAddComment();
                        }
                      }}
                    />
                  </div>
                  <div className="flex justify-between items-center mt-2">
                    <span className="text-xs text-text-tertiary">Cmd+Enter to send</span>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleAddComment}
                      disabled={!newComment.trim()}
                    >
                      <Send className="w-4 h-4 mr-2" strokeWidth={2} />
                      Send
                    </Button>
                  </div>
                </div>

                {commentsLoading ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <div className="w-8 h-8 border-2 border-[#6ABF36]/30 border-t-[#6ABF36] rounded-full animate-spin" />
                    <p className="text-sm text-text-tertiary mt-3 font-serif">Loading comments…</p>
                  </div>
                ) : comments.length === 0 ? (
                  <div className="text-center py-12">
                    <MessageSquare className="w-12 h-12 mx-auto text-border dark:text-gray-600 mb-3" />
                    <p className="text-sm text-text-secondary font-serif">No comments yet</p>
                    <p className="text-xs text-text-tertiary mt-1">Be the first to comment!</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {comments.map((comment) => (
                      <CommentCard
                        key={comment.id}
                        comment={comment}
                        onReply={() => setReplyTo(comment.id)}
                        onResolve={() => resolveComment(comment.id)}
                        onReact={(reaction) => addReaction(comment.id, reaction)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'activity' && (
              <div className="p-4 space-y-3">
                {activities.length === 0 ? (
                  <div className="text-center py-12">
                    <Activity className="w-12 h-12 mx-auto text-border dark:text-gray-600 mb-3" />
                    <p className="text-sm text-text-secondary font-serif">No activity yet</p>
                  </div>
                ) : (
                  activities.map((activity, index) => (
                    <motion.div
                      key={activity.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="flex items-start gap-3 p-3 hover:bg-background dark:hover:bg-gray-800 rounded-xl transition border border-transparent hover:border-border dark:hover:border-gray-700"
                    >
                      <div className="w-8 h-8 rounded-full bg-[#6ABF36]/10 flex items-center justify-center shrink-0">
                        {activity.activityType === 'comment_added' && (
                          <MessageSquare className="w-4 h-4 text-[#6ABF36]" strokeWidth={1.5} />
                        )}
                        {activity.activityType === 'analysis_updated' && (
                          <Activity className="w-4 h-4 text-[#6ABF36]" strokeWidth={1.5} />
                        )}
                        {activity.activityType === 'threshold_changed' && (
                          <Edit2 className="w-4 h-4 text-[#6ABF36]" strokeWidth={1.5} />
                        )}
                        {!['comment_added', 'analysis_updated', 'threshold_changed'].includes(
                          activity.activityType
                        ) && (
                          <Activity className="w-4 h-4 text-[#6ABF36]" strokeWidth={1.5} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-text-primary font-serif">{activity.description}</p>
                        <p className="text-xs text-text-tertiary mt-1">
                          {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'notifications' && (
              <div className="divide-y divide-border dark:divide-gray-800">
                {notifications.length === 0 ? (
                  <div className="text-center py-12">
                    <Bell className="w-12 h-12 mx-auto text-border dark:text-gray-600 mb-3" />
                    <p className="text-sm text-text-secondary font-serif">No notifications</p>
                  </div>
                ) : (
                  notifications.map((notification) => (
                    <motion.div
                      key={notification.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className={`p-4 cursor-pointer transition ${
                        notification.read
                          ? 'bg-surface dark:bg-gray-900'
                          : 'bg-[#6ABF36]/5 dark:bg-[#6ABF36]/10'
                      }`}
                      onClick={() => markAsRead(notification.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-text-primary">
                            {notification.title}
                          </p>
                          <p className="text-sm text-text-secondary mt-1 font-serif">
                            {notification.message}
                          </p>
                          <p className="text-xs text-text-tertiary mt-2">
                            {formatDistanceToNow(new Date(notification.createdAt), {
                              addSuffix: true,
                            })}
                          </p>
                        </div>
                        {!notification.read && (
                          <div className="w-2 h-2 bg-[#6ABF36] rounded-full mt-1.5 shrink-0" />
                        )}
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function CommentCard({
  comment,
  onReply,
  onResolve,
  onReact,
}: {
  comment: Comment;
  onReply: () => void;
  onResolve: () => void;
  onReact: (reaction: string) => void;
}) {
  const [showActions, setShowActions] = useState(false);

  return (
    <div
      className={`p-4 rounded-xl border ${
        comment.isResolved
          ? 'border-[#6ABF36]/30 bg-[#6ABF36]/5 dark:bg-[#6ABF36]/10'
          : 'border-border dark:border-gray-700 bg-background dark:bg-gray-800/50'
      }`}
    >
      <div className="flex items-start gap-3">
        <img
          src={
            comment.user.avatarUrl ||
            `https://ui-avatars.com/api/?name=${encodeURIComponent(comment.user.displayName)}&background=6ABF36&color=fff`
          }
          alt=""
          className="w-8 h-8 rounded-full object-cover shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium text-sm text-text-primary truncate">
              {comment.user.displayName}
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-text-tertiary">
                {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
              </span>
              <button
                type="button"
                onClick={() => setShowActions(!showActions)}
                className="p-1 rounded hover:bg-background dark:hover:bg-gray-700 text-text-tertiary"
              >
                <MoreVertical className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>

          <p className="text-sm mt-2 whitespace-pre-wrap text-text-primary font-serif">
            {comment.content}
          </p>

          <div className="flex items-center flex-wrap gap-2 mt-3">
            {['👍', '❤️', '🎉', '🤔', '👀'].map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onReact(emoji)}
                className="px-2 py-1 rounded-lg text-sm hover:bg-background dark:hover:bg-gray-700 transition"
              >
                {emoji}
              </button>
            ))}
            <button
              type="button"
              onClick={onReply}
              className="text-xs text-[#6ABF36] hover:underline font-medium"
            >
              Reply
            </button>
            {!comment.isResolved && (
              <button
                type="button"
                onClick={onResolve}
                className="text-xs text-[#6ABF36] hover:underline font-medium"
              >
                Resolve
              </button>
            )}
          </div>

          {comment.reactions && comment.reactions.length > 0 && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {comment.reactions.map((r: any) => (
                <span
                  key={r.reaction}
                  className="text-xs px-2 py-1 bg-background dark:bg-gray-700 rounded-full text-text-secondary"
                >
                  {r.reaction} {r.count}
                </span>
              ))}
            </div>
          )}

          {comment.replies && comment.replies.length > 0 && (
            <div className="mt-3 pl-4 border-l-2 border-border dark:border-gray-700 space-y-3">
              {comment.replies.map((reply: Comment) => (
                <div key={reply.id} className="flex items-start gap-2">
                  <img
                    src={
                      reply.user.avatarUrl ||
                      `https://ui-avatars.com/api/?name=${encodeURIComponent(reply.user.displayName)}&background=6ABF36&color=fff`
                    }
                    alt=""
                    className="w-6 h-6 rounded-full object-cover shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-xs text-text-primary">{reply.user.displayName}</p>
                    <p className="text-sm mt-1 text-text-secondary font-serif">{reply.content}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {comment.isResolved && (
        <div className="flex items-center gap-2 mt-3 text-[#6ABF36] text-xs">
          <Check className="w-4 h-4" strokeWidth={2} />
          <span>Resolved</span>
        </div>
      )}
    </div>
  );
}
