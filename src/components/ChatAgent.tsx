'use client';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, Send, X, Bot, User, Loader2, Sparkles, ChevronDown, Lightbulb, TrendingUp, Target, Zap, ExternalLink } from 'lucide-react';
import type { AppProject, Hook, GeneratedIdea, IdeaContent } from '@/types/database';
import type { AIModel } from '@/components/NavBar';
import * as dbService from '@/lib/db';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  ideas?: GeneratedIdea[];
}

interface AppContextData {
  name: string;
  category: string;
  features: string[];
  storeLink?: string;
  appKnowledge?: string;
  recentIdeas?: GeneratedIdea[];
  hooks?: Hook[];
  filters?: Record<string, string[]>;
}

interface ChatAgentProps {
  app: AppProject;
  appContext: AppContextData;
  selectedModel?: AIModel;
  onIdeasGenerated?: (ideas: GeneratedIdea[]) => void;
  onAppKnowledgeUpdated?: (knowledge: string) => void;
  onOpenIdeas?: () => void;
}

const QUICK_PROMPTS = [
  { icon: <Lightbulb size={14} />, text: 'Tạo 3 ideas creative mới', color: '#f59e0b' },
  { icon: <TrendingUp size={14} />, text: 'Phân tích chiến lược cho app này', color: '#10b981' },
  { icon: <Target size={14} />, text: 'Đối tượng nào convert tốt nhất?', color: '#6366f1' },
  { icon: <Zap size={14} />, text: 'Gợi ý hook viral cho app', color: '#ef4444' },
];

export const ChatAgent: React.FC<ChatAgentProps> = ({ app, appContext, selectedModel, onIdeasGenerated, onAppKnowledgeUpdated, onOpenIdeas }) => {
  const [isOpen, setIsOpen] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const sendMessage = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || loading) return;

    setInput('');

    const userMessage: ChatMessage = { role: 'user', content: msg, timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    setLoading(true);

    try {
      const res = await fetch('/api/chat-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          appContext,
          selectedModel,
          chatHistory: messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        // If ideas were generated, save to DB and add to message
        let savedIdeas: GeneratedIdea[] | undefined;
        if (data.ideas && Array.isArray(data.ideas) && data.ideas.length > 0) {
          const sessionId = crypto.randomUUID();
          const mapped = data.ideas.map((item: Record<string, unknown>) => {
            const selectedFilters = item.selectedFilters as Record<string, string[]> | undefined;
            const hasSelectedFilters = !!selectedFilters && Object.values(selectedFilters).some(
              value => Array.isArray(value) && value.length > 0
            );

            return {
              title: (item.title as string) || 'Ý tưởng AI',
              duration: (item.duration as string) || '30s',
              filtersSnapshot: (hasSelectedFilters ? selectedFilters : {
              coreUser: item.framework && typeof item.framework === 'object' ? [String((item.framework as IdeaContent['framework']).coreUser || '')].filter(Boolean) : [],
              painPoint: item.framework && typeof item.framework === 'object' ? [String((item.framework as IdeaContent['framework']).painpoint || '')].filter(Boolean) : [],
              solution: item.framework && typeof item.framework === 'object' ? [String((item.framework as IdeaContent['framework']).psp || '')].filter(Boolean) : [],
              emotion: item.framework && typeof item.framework === 'object' ? [String((item.framework as IdeaContent['framework']).emotion || '')].filter(Boolean) : [],
              angle: [],
              targetMarket: [],
              visualType: [(item.creativeType as string) || ''],
              }),
              content: {
                creativeType: (item.creativeType as string) || '',
                meta: (item.meta as IdeaContent['meta']) || undefined,
                framework: (item.framework as IdeaContent['framework']) || { coreUser: '', painpoint: '', emotion: '', psp: '' },
                explanation: (item.explanation as string) || '',
                hook: (item.hook as IdeaContent['hook']) || { visual: '', text: '', voice: '' },
                body: (item.body as IdeaContent['body']) || { visual: '', text: '', voice: '' },
                cta: (item.cta as IdeaContent['cta']) || { voice: '', text: '', endCard: '' },
              },
            };
          });
          savedIdeas = await dbService.saveIdeas(app.id, mapped, sessionId);
          if (onIdeasGenerated && savedIdeas) onIdeasGenerated(savedIdeas);

          // Background learn
          fetch('/api/learn-app', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              appId: app.id,
              appName: app.name,
              appCategory: app.category,
              sessionId,
              existingKnowledge: app.app_knowledge || '',
            }),
          }).then(async response => {
            const learnData = await response.json().catch(() => null);
            if (response.ok && learnData?.success && learnData.knowledge && onAppKnowledgeUpdated) {
              onAppKnowledgeUpdated(learnData.knowledge);
            }
          }).catch(() => {});
        }

        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: data.response,
          timestamp: new Date(),
          ideas: savedIdeas,
        };
        setMessages(prev => [...prev, assistantMessage]);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `⚠️ ${data.error || 'Lỗi kết nối AI. Thử lại sau.'}`,
          timestamp: new Date(),
        }]);
      }
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚠️ Không thể kết nối. Kiểm tra lại mạng.',
        timestamp: new Date(),
      }]);
    }

    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatContent = (content: string) => {
    const cleaned = content.replace(/```json[\s\S]*?```/g, '').trim();
    
    return cleaned.split('\n').map((line, i) => {
      if (line.startsWith('###')) return <h3 key={i} style={{ fontSize: 15, fontWeight: 700, margin: '12px 0 4px', color: '#1e293b' }}>{line.replace(/^#+\s*/, '')}</h3>;
      if (line.startsWith('##')) return <h2 key={i} style={{ fontSize: 16, fontWeight: 700, margin: '14px 0 6px', color: '#1e293b' }}>{line.replace(/^#+\s*/, '')}</h2>;
      if (line.startsWith('**') && line.endsWith('**')) return <p key={i} style={{ fontWeight: 600, margin: '8px 0 2px', color: '#334155' }}>{line.replace(/\*\*/g, '')}</p>;
      if (line.startsWith('- ') || line.startsWith('* ')) return <li key={i} style={{ marginLeft: 16, fontSize: 13, lineHeight: 1.6, color: '#475569' }}>{formatInlineText(line.replace(/^[-*]\s*/, ''))}</li>;
      if (line.match(/^\d+\./)) return <li key={i} style={{ marginLeft: 16, fontSize: 13, lineHeight: 1.6, color: '#475569', listStyleType: 'decimal' }}>{formatInlineText(line.replace(/^\d+\.\s*/, ''))}</li>;
      if (!line.trim()) return <br key={i} />;
      return <p key={i} style={{ fontSize: 13, lineHeight: 1.6, color: '#475569', margin: '2px 0' }}>{formatInlineText(line)}</p>;
    });
  };

  const formatInlineText = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} style={{ color: '#1e293b' }}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  // Floating chat button
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 1000,
          width: 60, height: 60, borderRadius: '50%',
          background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)',
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 32px rgba(99, 102, 241, 0.4), 0 0 0 3px rgba(255,255,255,0.2)',
          transition: 'all 0.3s ease',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.boxShadow = '0 12px 40px rgba(99, 102, 241, 0.5)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(99, 102, 241, 0.4)'; }}
      >
        <MessageCircle size={26} color="white" />
        <span style={{
          position: 'absolute', top: -2, right: -2,
          width: 16, height: 16, borderRadius: '50%',
          background: '#22c55e', border: '2px solid white',
        }} />
      </button>
    );
  }

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 1000,
      width: 420, height: 600,
      borderRadius: 20, overflow: 'hidden',
      background: 'white',
      boxShadow: '0 25px 80px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)',
      display: 'flex', flexDirection: 'column',
      animation: 'chatSlideIn 0.3s ease-out',
    }}>
      <style>{`
        @keyframes chatSlideIn { from { opacity: 0; transform: translateY(20px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .chat-scroll::-webkit-scrollbar { width: 4px; }
        .chat-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
      `}</style>

      {/* Header */}
      <div style={{
        padding: '16px 20px',
        background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(10px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Sparkles size={20} color="white" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: 'white', fontWeight: 700, fontSize: 15 }}>Creative Agent</div>
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>{app.name} • Pro Model</div>
        </div>
        <button onClick={() => setIsOpen(false)} style={{
          background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 8,
          width: 32, height: 32, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <X size={16} color="white" />
        </button>
      </div>

      {/* Messages */}
      <div className="chat-scroll" style={{
        flex: 1, overflowY: 'auto', padding: '16px 16px 8px',
        background: '#f8fafc',
      }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🧠</div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#1e293b', marginBottom: 4 }}>
              Creative Agent sẵn sàng!
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 20, lineHeight: 1.5 }}>
              Chat để tạo ideas, phân tích chiến lược,<br/>hoặc hỏi bất cứ điều gì về app.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {QUICK_PROMPTS.map((q, i) => (
                <button key={i} onClick={() => sendMessage(q.text)} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 14px', borderRadius: 12,
                  background: 'white', border: '1px solid #e2e8f0',
                  cursor: 'pointer', fontSize: 13, color: '#475569',
                  transition: 'all 0.2s',
                  textAlign: 'left',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = q.color; e.currentTarget.style.background = `${q.color}08`; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = 'white'; }}
                >
                  <span style={{ color: q.color }}>{q.icon}</span>
                  {q.text}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{
            display: 'flex', gap: 8, marginBottom: 16,
            flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8, flexShrink: 0,
              background: msg.role === 'user' ? '#6366f1' : 'linear-gradient(135deg, #f59e0b, #ef4444)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {msg.role === 'user' ? <User size={14} color="white" /> : <Bot size={14} color="white" />}
            </div>
            <div style={{
              maxWidth: '85%',
              padding: '10px 14px',
              borderRadius: msg.role === 'user' ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
              background: msg.role === 'user' ? '#6366f1' : 'white',
              color: msg.role === 'user' ? 'white' : '#1e293b',
              fontSize: 13, lineHeight: 1.6,
              boxShadow: msg.role === 'assistant' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
              border: msg.role === 'assistant' ? '1px solid #f1f5f9' : 'none',
            }}>
              {msg.role === 'user' ? msg.content : formatContent(msg.content)}
              
              {/* Ideas generated - show summary + Open button */}
              {msg.ideas && msg.ideas.length > 0 && (
                <div style={{ marginTop: 12, padding: '10px 12px', background: '#f0fdf4', borderRadius: 10, border: '1px solid #bbf7d0' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#16a34a', marginBottom: 6 }}>
                    ✨ {msg.ideas.length} Ideas đã tạo & lưu
                  </div>
                  {msg.ideas.slice(0, 3).map((idea: GeneratedIdea, j: number) => (
                    <div key={j} style={{ fontSize: 12, color: '#15803d', padding: '2px 0' }}>
                      {j + 1}. {typeof idea === 'object' && 'title' in idea ? idea.title : String(idea)}
                    </div>
                  ))}
                  {msg.ideas.length > 3 && (
                    <div style={{ fontSize: 11, color: '#86efac', marginTop: 2 }}>+{msg.ideas.length - 3} ideas nữa...</div>
                  )}
                  {onOpenIdeas && (
                    <button onClick={onOpenIdeas} style={{
                      marginTop: 8, width: '100%', padding: '6px 12px',
                      background: '#16a34a', color: 'white',
                      border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#15803d'}
                    onMouseLeave={e => e.currentTarget.style.background = '#16a34a'}
                    >
                      <ExternalLink size={12} /> Mở Ideas đầy đủ
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Bot size={14} color="white" />
            </div>
            <div style={{
              padding: '12px 16px', borderRadius: '4px 16px 16px 16px',
              background: 'white', border: '1px solid #f1f5f9',
              display: 'flex', alignItems: 'center', gap: 8,
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}>
              <Loader2 size={14} className="animate-spin" style={{ color: '#6366f1' }} />
              <span style={{ fontSize: 12, color: '#94a3b8' }}>Đang suy nghĩ (Pro model)...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Scroll to bottom */}
      {messages.length > 3 && (
        <button onClick={scrollToBottom} style={{
          position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          background: 'white', border: '1px solid #e2e8f0', borderRadius: 20,
          padding: '4px 12px', fontSize: 11, color: '#94a3b8', cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        }}>
          <ChevronDown size={12} /> Cuộn xuống
        </button>
      )}

      {/* Input */}
      <div style={{
        padding: '12px 16px', borderTop: '1px solid #f1f5f9',
        background: 'white',
      }}>
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 8,
          background: '#f8fafc', borderRadius: 14,
          border: '1px solid #e2e8f0', padding: '8px 12px',
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Hỏi hoặc yêu cầu tạo ideas..."
            rows={1}
            style={{
              flex: 1, border: 'none', outline: 'none', resize: 'none',
              fontSize: 13, lineHeight: 1.5, background: 'transparent',
              fontFamily: 'inherit', color: '#1e293b',
              maxHeight: 80, minHeight: 20,
            }}
            onInput={e => {
              const t = e.currentTarget;
              t.style.height = 'auto';
              t.style.height = Math.min(t.scrollHeight, 80) + 'px';
            }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={loading || !input.trim()}
            style={{
              width: 32, height: 32, borderRadius: 10,
              background: input.trim() ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : '#e2e8f0',
              border: 'none', cursor: input.trim() ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s',
              flexShrink: 0,
            }}
          >
            <Send size={14} color={input.trim() ? 'white' : '#94a3b8'} />
          </button>
        </div>
        <div style={{ fontSize: 10, color: '#cbd5e1', textAlign: 'center', marginTop: 6 }}>
          Gemini Pro • Creative Agent • {app.name}
        </div>
      </div>
    </div>
  );
};
