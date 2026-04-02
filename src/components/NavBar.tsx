'use client';
import React from 'react';
import { Sparkles, Home, ArrowLeft, LogOut } from 'lucide-react';
import type { ScreenType } from '@/types/database';

interface NavBarProps {
  currentScreen: ScreenType;
  setCurrentScreen: (s: ScreenType) => void;
  userName: string;
  onLogout?: () => void;
}

export const NavBar: React.FC<NavBarProps> = ({ currentScreen, setCurrentScreen, userName, onLogout }) => {
  const isHome = currentScreen === 'f1';

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
