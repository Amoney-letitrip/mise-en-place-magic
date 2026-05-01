import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, Send, X, Sparkles, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useIsMobile } from '@/hooks/use-mobile';
import { useDailySummary } from '@/hooks/use-inventory-data';
import { sendChatMessage } from '@/lib/chat-assistant';
import { generateBriefing } from '@/lib/daily-briefing';
import type { InventoryContext, ChatHistoryEntry } from '@/lib/chat-assistant';
import type { TabId } from '@/lib/types';

interface QuickAction {
  icon: string;
  label: string;
  tab: TabId;
}

interface AIChatDrawerProps {
  open: boolean;
  onClose: () => void;
  setTab: (tab: TabId) => void;
  context: InventoryContext;
  // Alert counts for quick-action pills
  lowItems: number;
  stockoutRisk: number;
  expiredLots: number;
  ordersDue: number;
  flaggedSales: number;
  draftRecipes: number;
}

const STALE_HOURS = 8;

function isStale(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() > STALE_HOURS * 3_600_000;
}

export const AIChatDrawer = ({
  open,
  onClose,
  setTab,
  context,
  lowItems,
  stockoutRisk,
  expiredLots,
  ordersDue,
  flaggedSales,
  draftRecipes,
}: AIChatDrawerProps) => {
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const { data: dailySummary, isLoading: isSummaryLoading } = useDailySummary();

  const [messages, setMessages] = useState<ChatHistoryEntry[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Build quick-action pills from live alert counts
  const quickActions: QuickAction[] = [
    ordersDue > 0 && { icon: '📦', label: `${ordersDue} order${ordersDue !== 1 ? 's' : ''} due`, tab: 'orders' as TabId },
    expiredLots > 0 && { icon: '🗑', label: `${expiredLots} expired`, tab: 'inventory' as TabId },
    lowItems > 0 && { icon: '📉', label: `${lowItems} low stock`, tab: 'inventory' as TabId },
    flaggedSales > 0 && { icon: '⚠️', label: `${flaggedSales} flagged sales`, tab: 'sales' as TabId },
    draftRecipes > 0 && { icon: '📋', label: `${draftRecipes} draft recipe${draftRecipes !== 1 ? 's' : ''}`, tab: 'recipes' as TabId },
  ].filter(Boolean) as QuickAction[];

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (messages.length > 0) scrollToBottom();
  }, [messages, scrollToBottom]);

  // Focus input when open
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const runGenerate = useCallback(async () => {
    setIsGenerating(true);
    try {
      const { summary } = await generateBriefing(context);
      setMessages([{ role: 'model', text: summary }]);
      qc.invalidateQueries({ queryKey: ['daily_summary'] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[AIChatDrawer] generate-daily-briefing failed:', msg);
      setMessages([{
        role: 'model',
        text: `Briefing unavailable: ${msg}. You can still ask me questions about your inventory.`,
      }]);
    } finally {
      setIsGenerating(false);
    }
  }, [context, qc]);

  // Initialize when drawer opens (runs once per open session)
  useEffect(() => {
    if (!open || hasInitialized || isSummaryLoading) return;
    setHasInitialized(true);

    if (dailySummary && !isStale(dailySummary.created_at)) {
      setMessages([{ role: 'model', text: dailySummary.summary_text }]);
    } else {
      runGenerate();
    }
  }, [open, hasInitialized, isSummaryLoading, dailySummary, runGenerate]);

  // Reset init state when drawer closes so next open re-checks freshness
  useEffect(() => {
    if (!open) setHasInitialized(false);
  }, [open]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isSending || isGenerating) return;
    setInput('');

    const newMessages: ChatHistoryEntry[] = [...messages, { role: 'user', text }];
    setMessages(newMessages);
    setIsSending(true);

    try {
      // Pass history = all messages before this new user message
      const { reply } = await sendChatMessage(text, messages, context);
      setMessages([...newMessages, { role: 'model', text: reply }]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to get a response');
      setMessages(newMessages); // keep user message, don't add error bubble
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleRegenerateClick = () => {
    setMessages([]);
    setHasInitialized(false);
    // useEffect will re-run on next render when hasInitialized flips
    setTimeout(() => setHasInitialized(false), 0);
    runGenerate();
  };

  // ── Panel geometry ────────────────────────────────────────────────────────
  const panelClass = isMobile
    ? `inset-x-0 bottom-0 h-[78vh] rounded-t-[24px] transition-transform duration-300 ${open ? 'translate-y-0' : 'translate-y-full'}`
    : `right-0 inset-y-0 w-[380px] transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`;

  return (
    <div
      className={`fixed inset-0 z-50 transition-opacity duration-200 ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      aria-modal="true"
      role="dialog"
      aria-label="Shift Assistant"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`absolute flex flex-col shadow-2xl border border-white/10 ${panelClass}`}
        style={{ background: '#1c1410' }}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-amber-400" />
            </div>
            <div>
              <p className="font-black text-white text-[15px] leading-tight">Shift Assistant</p>
              <p className="text-[10px] text-white/35 font-medium">Powered by Gemini</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRegenerateClick}
              disabled={isGenerating}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/10 transition-colors"
              title="Regenerate briefing"
              aria-label="Regenerate briefing"
            >
              <RotateCcw className={`h-4 w-4 ${isGenerating ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/10 transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Messages ───────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
          {/* Loading state */}
          {(isSummaryLoading || isGenerating) && messages.length === 0 && (
            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Sparkles className="h-3.5 w-3.5 text-amber-400 animate-pulse" />
              </div>
              <div className="rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%]" style={{ background: 'rgba(255,255,255,0.07)' }}>
                <div className="flex gap-1 items-center h-5">
                  <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          {/* Message bubbles */}
          {messages.map((msg, i) => {
            const isModel = msg.role === 'model';
            const isFirst = i === 0 && isModel;
            return (
              <div key={i}>
                <div className={`flex items-start gap-2.5 ${isModel ? '' : 'flex-row-reverse'}`}>
                  {isModel && (
                    <div className="w-7 h-7 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                    </div>
                  )}
                  <div
                    className={`rounded-2xl px-4 py-3 text-[13px] leading-relaxed text-white max-w-[85%] ${
                      isModel
                        ? 'rounded-tl-sm'
                        : 'rounded-tr-sm'
                    }`}
                    style={{
                      background: isModel
                        ? 'rgba(255,255,255,0.07)'
                        : 'rgba(255,255,255,0.14)',
                    }}
                  >
                    {msg.text}
                  </div>
                </div>

                {/* Quick action pills — shown after the first briefing message */}
                {isFirst && quickActions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2.5 ml-9">
                    {quickActions.map((action) => (
                      <button
                        key={action.tab + action.label}
                        onClick={() => { setTab(action.tab); onClose(); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-white/80 border border-white/15 hover:border-white/30 hover:bg-white/10 transition-colors"
                        style={{ background: 'rgba(255,255,255,0.06)' }}
                      >
                        <span>{action.icon}</span>
                        {action.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Typing indicator while AI responds */}
          {isSending && (
            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              </div>
              <div className="rounded-2xl rounded-tl-sm px-4 py-3" style={{ background: 'rgba(255,255,255,0.07)' }}>
                <div className="flex gap-1 items-center h-5">
                  <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* ── Input ──────────────────────────────────────────────────────── */}
        <div className="px-4 pb-5 pt-3 border-t border-white/10 flex-shrink-0">
          <div
            className="flex items-end gap-2 rounded-2xl border border-white/15 px-3 py-2"
            style={{ background: 'rgba(255,255,255,0.06)' }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              placeholder="Ask about your inventory…"
              className="flex-1 bg-transparent text-white text-[13px] placeholder:text-white/30 resize-none focus:outline-none leading-relaxed"
              style={{ maxHeight: '96px', overflowY: 'auto' }}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isGenerating}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || isSending || isGenerating}
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all disabled:opacity-30 hover:scale-110"
              style={{ background: '#d97706' }}
              aria-label="Send"
            >
              <Send className="h-4 w-4 text-white" />
            </button>
          </div>
          <p className="text-[10px] text-white/20 text-center mt-2">
            Shift + Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
};

// ── Floating trigger button ───────────────────────────────────────────────────

interface AIChatButtonProps {
  onClick: () => void;
  hasAlerts: boolean;
}

export const AIChatButton = ({ onClick, hasAlerts }: AIChatButtonProps) => (
  <button
    onClick={onClick}
    className="relative flex items-center justify-center w-11 h-11 rounded-full border border-white/20 bg-black/55 backdrop-blur-sm shadow-2xl hover:scale-110 focus:scale-110 focus:outline-none focus:ring-2 focus:ring-white/40 transition-transform"
    aria-label="Open Shift Assistant"
  >
    <MessageCircle className="h-5 w-5 text-white" />
    {hasAlerts && (
      <span className="absolute top-0.5 right-0.5 w-2.5 h-2.5 rounded-full bg-amber-400 border-2 border-black" />
    )}
  </button>
);
