'use client';
import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Home, ArrowLeft, LogOut, ChevronDown, Cpu } from 'lucide-react';
import type { ScreenType } from '@/types/database';

export type AIModel = 'gemini-3-pro' | 'gemini-3.1-flash' | 'gemini-2.5-flash' | 'gpt-5.4';

const MODEL_OPTIONS: { value: AIModel; label: string; provider: string; badge: string; color: string }[] = [
  { value: 'gemini-3-pro', label: 'Gemini 3 Pro', provider: 'Google', badge: 'G3', color: 'from-blue-600 to-indigo-500' },
  { value: 'gemini-3.1-flash', label: 'Gemini 3.1 Flash', provider: 'Google', badge: '3F', color: 'from-cyan-600 to-blue-500' },
  { value: 'gemini-2.5-flash', label: 'Gemini Flash', provider: 'Google', badge: 'F', color: 'from-sky-500 to-cyan-500' },
  { value: 'gpt-5.4', label: 'GPT-5.4', provider: 'OpenAI', badge: 'O', color: 'from-emerald-600 to-teal-500' },
];

interface NavBarProps {
  currentScreen: ScreenType;
  setCurrentScreen: (s: ScreenType) => void;
  userName: string;
  onLogout?: () => void;
  selectedModel: AIModel;
  onModelChange: (model: AIModel) => void;
}

export const NavBar: React.FC<NavBarProps> = ({ currentScreen, setCurrentScreen, userName, onLogout, selectedModel, onModelChange }) => {
  const isHome = currentScreen === 'f1';
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = MODEL_OPTIONS.find(m => m.value === selectedModel) || MODEL_OPTIONS[0];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-gray-100/50">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {!isHome && (
            <button onClick={() => setCurrentScreen('f1')}
              className="p-2 hover:bg-gray-100 rounded-xl transition-colors mr-1">
              <ArrowLeft className="w-5 h-5 text-gray-500" />
            </button>
          )}
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => setCurrentScreen('f1')}>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              IdeaGen
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* AI Model Selector */}
          <div ref={ref} className="relative">
            <button
              onClick={() => setOpen(!open)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all hover:shadow-md ${
                open ? 'border-indigo-300 bg-indigo-50 shadow-md' : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <Cpu className="w-3.5 h-3.5 text-gray-500" />
              <span className="hidden sm:inline">{current.badge}</span>
              <span className="text-gray-700">{current.label}</span>
              <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
              <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Chọn AI Model</p>
                </div>
                {MODEL_OPTIONS.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => { onModelChange(m.value); setOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                      selectedModel === m.value
                        ? 'bg-indigo-50 border-l-2 border-indigo-500'
                        : 'hover:bg-gray-50 border-l-2 border-transparent'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${m.color} flex items-center justify-center text-white text-sm shadow-sm`}>
                      {m.badge}
                    </div>
                    <div>
                      <p className={`text-sm font-semibold ${selectedModel === m.value ? 'text-indigo-700' : 'text-gray-800'}`}>
                        {m.label}
                      </p>
                      <p className="text-[10px] text-gray-400">{m.provider}</p>
                    </div>
                    {selectedModel === m.value && (
                      <div className="ml-auto w-2 h-2 rounded-full bg-indigo-500" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="hidden sm:flex items-center gap-2 text-sm text-gray-500 bg-gray-50 px-3 py-1.5 rounded-full">
            <Home className="w-4 h-4" />
            <span className="font-medium">{userName}</span>
          </div>
          {onLogout && (
            <button onClick={onLogout}
              className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors" title="Đăng xuất">
              <LogOut className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </nav>
  );
};
