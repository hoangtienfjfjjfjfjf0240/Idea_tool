'use client';
import React, { useState, useEffect } from 'react';
import { LoginScreen } from '@/components/LoginScreen';
import { NavBar } from '@/components/NavBar';
import { Dashboard } from '@/components/Dashboard';
import { AppDetail } from '@/components/AppDetail';
import { FilterGenerator } from '@/components/FilterGenerator';
import { HookLibrary } from '@/components/HookLibrary';
import { ChatAgent } from '@/components/ChatAgent';

import { supabase } from '@/lib/supabase';
import type { AppProject, ScreenType } from '@/types/database';
import { getHooks, getFilterOptions } from '@/lib/db';
import { Loader2 } from 'lucide-react';

export default function Home() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userName, setUserName] = useState('');
  const [currentScreen, setCurrentScreen] = useState<ScreenType>('f1');
  const [selectedApp, setSelectedApp] = useState<AppProject | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Check existing session on mount
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const name = session.user.user_metadata?.display_name || session.user.email?.split('@')[0] || 'User';
        setUserName(name);
        setIsLoggedIn(true);
      }
      setCheckingAuth(false);
    };
    checkSession();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const name = session.user.user_metadata?.display_name || session.user.email?.split('@')[0] || 'User';
        setUserName(name);
        setIsLoggedIn(true);
      } else {
        setIsLoggedIn(false);
        setUserName('');
        setCurrentScreen('f1');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogin = (name: string) => {
    setUserName(name);
    setIsLoggedIn(true);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsLoggedIn(false);
    setUserName('');
    setCurrentScreen('f1');
    setSelectedApp(null);
  };

  const handleAppSelect = (app: AppProject) => {
    setSelectedApp(app);
    setCurrentScreen('f2');
  };

  const handleAppUpdated = (updatedApp: AppProject) => {
    setSelectedApp(updatedApp);
  };

  // Loading state while checking auth
  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-indigo-950 to-purple-950">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
      </div>
    );
  }

  if (!isLoggedIn) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  const renderScreen = () => {
    if (currentScreen === 'f1') {
      return <Dashboard onSelectApp={handleAppSelect} />;
    }

    if (currentScreen === 'f2') {
      if (!selectedApp) return <Dashboard onSelectApp={handleAppSelect} />;
      return (
        <AppDetail
          app={selectedApp}
          onBack={() => setCurrentScreen('f1')}
          onNavigate={(path) => setCurrentScreen(path as ScreenType)}
          onAppUpdated={handleAppUpdated}
        />
      );
    }

    // Filter Generator flow (f2.1 → f2.1.1 → f2.1.2)
    if (currentScreen.startsWith('f2.1') && selectedApp) {
      return (
        <FilterGenerator
          app={selectedApp}
          currentScreen={currentScreen}
          setScreen={setCurrentScreen}
        />
      );
    }

    // Hook Library flow (f2.2 → f2.2.1)
    if (currentScreen.startsWith('f2.2')) {
      return (
        <HookLibrary
          setScreen={setCurrentScreen}
          currentScreen={currentScreen}
          app={selectedApp}
        />
      );
    }



    return <Dashboard onSelectApp={handleAppSelect} />;
  };

  // Build app context for ChatAgent
  const [chatHooks, setChatHooks] = useState<import('@/types/database').Hook[]>([]);
  const [chatFilters, setChatFilters] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (selectedApp) {
      getHooks(selectedApp.id).then(setChatHooks).catch(() => {});
      getFilterOptions(selectedApp).then(setChatFilters).catch(() => {});
    }
  }, [selectedApp?.id]);

  const handleOpenIdeas = () => {
    if (selectedApp) {
      setCurrentScreen('f2.1.2');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
      <NavBar currentScreen={currentScreen} setCurrentScreen={setCurrentScreen} userName={userName} onLogout={handleLogout} />
      <main className="py-4">
        {renderScreen()}
      </main>

      {/* Global Chat Agent - always visible */}
      {selectedApp && (
        <ChatAgent
          app={selectedApp}
          appContext={{
            name: selectedApp.name,
            category: selectedApp.category,
            features: [],
            storeLink: selectedApp.store_link || undefined,
            appKnowledge: selectedApp.app_knowledge || undefined,
            hooks: chatHooks,
            filters: chatFilters,
          }}
          onOpenIdeas={handleOpenIdeas}
        />
      )}
    </div>
  );
}
