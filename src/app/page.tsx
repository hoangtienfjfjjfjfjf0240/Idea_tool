'use client';
import React, { useState, useEffect } from 'react';
import { LoginScreen } from '@/components/LoginScreen';
import { NavBar, type AIModel } from '@/components/NavBar';
import { Dashboard } from '@/components/Dashboard';
import { AppDetail } from '@/components/AppDetail';
import { FilterGenerator } from '@/components/FilterGenerator';
import { HookLibrary } from '@/components/HookLibrary';
import { StrategyHistory } from '@/components/StrategyHistory';
import { StrategyMap } from '@/components/StrategyMap';
import { ChatAgent } from '@/components/ChatAgent';

import { supabase } from '@/lib/supabase';
import type { AppProject, FilterState, ScreenType } from '@/types/database';
import { getApp, getHooks, getFilterOptions, getFeatures, getIdeas } from '@/lib/db';
import { Loader2 } from 'lucide-react';

const NAV_STATE_KEY = 'ideagen_nav_state';
const SCREEN_VALUES: ScreenType[] = ['f1', 'f2', 'f2.1', 'f2.1.1', 'f2.1.2', 'f2.2', 'f2.2.1', 'f2.2.2', 'f2.3', 'f2.4'];

type NavState = {
  screen: ScreenType;
  appId: string | null;
};

function isScreenType(value: string | null | undefined): value is ScreenType {
  return Boolean(value && SCREEN_VALUES.includes(value as ScreenType));
}

function readSavedNavState(): NavState {
  if (typeof window === 'undefined') return { screen: 'f1', appId: null };

  const params = new URLSearchParams(window.location.search);
  const urlScreen = params.get('screen');
  const urlAppId = params.get('app');

  let savedScreen: ScreenType = 'f1';
  let savedAppId: string | null = null;

  try {
    const raw = window.localStorage.getItem(NAV_STATE_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<NavState> : null;
    if (isScreenType(parsed?.screen)) savedScreen = parsed.screen;
    if (typeof parsed?.appId === 'string' && parsed.appId.trim()) savedAppId = parsed.appId;
  } catch {
    // Ignore corrupt saved navigation state.
  }

  const screen = isScreenType(urlScreen) ? urlScreen : savedScreen;
  const appId = urlAppId || savedAppId;
  return screen === 'f1' ? { screen, appId: null } : { screen, appId };
}

export default function Home() {
  const [initialNavState] = useState<NavState>(() => readSavedNavState());
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userName, setUserName] = useState('');
  const [currentScreen, setCurrentScreen] = useState<ScreenType>(initialNavState.screen);
  const [selectedApp, setSelectedApp] = useState<AppProject | null>(null);
  const [pendingAppId, setPendingAppId] = useState<string | null>(initialNavState.appId);
  const [restoringNav, setRestoringNav] = useState(Boolean(initialNavState.appId && initialNavState.screen !== 'f1'));
  const [prefillFilters, setPrefillFilters] = useState<Partial<FilterState> | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [chatHooks, setChatHooks] = useState<import('@/types/database').Hook[]>([]);
  const [chatFeatures, setChatFeatures] = useState<string[]>([]);
  const [chatRecentIdeas, setChatRecentIdeas] = useState<import('@/types/database').GeneratedIdea[]>([]);
  const [chatFilters, setChatFilters] = useState<Record<string, string[]>>({});
  const [selectedModel, setSelectedModel] = useState<AIModel>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ideagen_model') as AIModel | null;
      return saved === 'gemini-3-pro' || saved === 'gpt-5.4' ? saved : 'gemini-3-pro';
    }
    return 'gemini-3-pro';
  });

  const handleModelChange = (model: AIModel) => {
    setSelectedModel(model);
    localStorage.setItem('ideagen_model', model);
  };

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
        setSelectedApp(null);
        setPendingAppId(null);
        window.localStorage.removeItem(NAV_STATE_KEY);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const restoreSelectedApp = async () => {
      if (currentScreen === 'f1' || !pendingAppId) {
        setRestoringNav(false);
        return;
      }

      if (selectedApp?.id === pendingAppId) {
        setRestoringNav(false);
        return;
      }

      setRestoringNav(true);
      const app = await getApp(pendingAppId);
      if (cancelled) return;

      if (app) {
        setSelectedApp(app);
      } else {
        setCurrentScreen('f1');
        setPendingAppId(null);
      }
      setRestoringNav(false);
    };

    restoreSelectedApp();

    return () => {
      cancelled = true;
    };
  }, [currentScreen, pendingAppId, selectedApp?.id]);

  useEffect(() => {
    if (typeof window === 'undefined' || restoringNav) return;

    const navState: NavState = {
      screen: currentScreen,
      appId: currentScreen === 'f1' ? null : selectedApp?.id || pendingAppId || null,
    };

    window.localStorage.setItem(NAV_STATE_KEY, JSON.stringify(navState));

    const url = new URL(window.location.href);
    if (navState.screen === 'f1') {
      url.searchParams.delete('screen');
      url.searchParams.delete('app');
    } else {
      url.searchParams.set('screen', navState.screen);
      if (navState.appId) url.searchParams.set('app', navState.appId);
      else url.searchParams.delete('app');
    }
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, [currentScreen, pendingAppId, restoringNav, selectedApp?.id]);

  // Load ChatAgent context when app is selected
  useEffect(() => {
    if (selectedApp) {
      Promise.all([
        getHooks(selectedApp.id),
        getFilterOptions(selectedApp),
        getFeatures(selectedApp.id),
        getIdeas(selectedApp.id),
      ]).then(([hooks, filters, features, ideas]) => {
        setChatHooks(hooks);
        setChatFilters(filters);
        setChatFeatures(features.map(feature => feature.name));
        setChatRecentIdeas(ideas.slice(0, 24));
      }).catch(() => {});
    }
  }, [selectedApp?.id]);

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
    setPendingAppId(null);
    localStorage.removeItem(NAV_STATE_KEY);
  };

  const handleAppSelect = (app: AppProject) => {
    setSelectedApp(app);
    setPendingAppId(app.id);
    setCurrentScreen('f2');
  };

  const handleAppUpdated = (updatedApp: AppProject) => {
    setSelectedApp(updatedApp);
  };

  // Skip auth - go straight to app
  if (checkingAuth || restoringNav) {
    // Still check in background for user name display
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
      </div>
    );
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
          onCreateFromBranch={(filters) => {
            setPrefillFilters(filters);
            setCurrentScreen('f2.1');
          }}
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
          selectedModel={selectedModel}
          prefillFilters={prefillFilters}
          onPrefillConsumed={() => setPrefillFilters(null)}
          onAppKnowledgeUpdated={(knowledge) => {
            setSelectedApp(prev => prev ? { ...prev, app_knowledge: knowledge } : prev);
          }}
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
          selectedModel={selectedModel}
        />
      );
    }
    // Strategy History (f2.3)
    if (currentScreen === 'f2.3' && selectedApp) {
      return (
        <StrategyHistory
          app={selectedApp}
          onBack={() => setCurrentScreen('f2')}
        />
      );
    }

    // Strategy Map (f2.4)
    if (currentScreen === 'f2.4' && selectedApp) {
      return (
        <StrategyMap
          app={selectedApp}
          onBack={() => setCurrentScreen('f2')}
          onCreateFromBranch={(filters) => {
            setPrefillFilters(filters);
            setCurrentScreen('f2.1');
          }}
        />
      );
    }



    return <Dashboard onSelectApp={handleAppSelect} />;
  };

  const handleOpenIdeas = () => {
    if (selectedApp) {
      setCurrentScreen('f2.1.2');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
      <NavBar currentScreen={currentScreen} setCurrentScreen={setCurrentScreen} userName={userName} onLogout={handleLogout} selectedModel={selectedModel} onModelChange={handleModelChange} />
      <main className="py-4">
        {renderScreen()}
      </main>

      {/* Global Chat Agent - always visible */}
      {selectedApp && (
        <ChatAgent
          key={selectedApp.id}
          app={selectedApp}
          selectedModel={selectedModel}
          appContext={{
            name: selectedApp.name,
            category: selectedApp.category,
            features: chatFeatures,
            storeLink: selectedApp.store_link || undefined,
            appKnowledge: selectedApp.app_knowledge || undefined,
            recentIdeas: chatRecentIdeas,
            hooks: chatHooks,
            filters: chatFilters,
          }}
          onIdeasGenerated={(ideas) => {
            setChatRecentIdeas(prev => [...ideas, ...prev].slice(0, 24));
          }}
          onAppKnowledgeUpdated={(knowledge) => {
            setSelectedApp(prev => prev ? { ...prev, app_knowledge: knowledge } : prev);
          }}
          onOpenIdeas={handleOpenIdeas}
        />
      )}
    </div>
  );
}
