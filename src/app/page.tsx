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

import { isAuthDisabled } from '@/lib/authMode';
import { getMissingBrowserSupabaseEnvVars, supabase } from '@/lib/supabase';
import type { AppProject, FilterState, ScreenType } from '@/types/database';
import { getApp, getHooks, getFilterOptions, getFeatures, getRecentIdeas } from '@/lib/db';
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

function isChatAgentHiddenScreen(screen: ScreenType) {
  return screen === 'f2.1'
    || screen === 'f2.1.1'
    || screen === 'f2.2.1'
    || screen === 'f2.2.2'
    || screen === 'f2.4';
}

export default function Home() {
  const authDisabled = isAuthDisabled();
  const missingSupabaseEnvVars = getMissingBrowserSupabaseEnvVars();
  const hasSupabaseConfig = missingSupabaseEnvVars.length === 0;
  const [initialNavState] = useState<NavState>(() => readSavedNavState());
  const [hasHydrated, setHasHydrated] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(authDisabled);
  const [userName, setUserName] = useState(authDisabled ? 'Guest' : '');
  const [currentScreen, setCurrentScreen] = useState<ScreenType>(initialNavState.screen);
  const [selectedApp, setSelectedApp] = useState<AppProject | null>(null);
  const [pendingAppId, setPendingAppId] = useState<string | null>(initialNavState.appId);
  const [restoringNav, setRestoringNav] = useState(
    Boolean(hasSupabaseConfig && initialNavState.appId && initialNavState.screen !== 'f1')
  );
  const [prefillFilters, setPrefillFilters] = useState<Partial<FilterState> | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(!authDisabled && hasSupabaseConfig);
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

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  // Check existing session on mount
  useEffect(() => {
    if (!hasHydrated) return;
    if (!hasSupabaseConfig || authDisabled) return;

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
  }, [authDisabled, hasHydrated, hasSupabaseConfig]);

  useEffect(() => {
    let cancelled = false;

    const restoreSelectedApp = async () => {
      if (!hasHydrated) {
        setRestoringNav(false);
        return;
      }

      if (!hasSupabaseConfig) {
        setRestoringNav(false);
        return;
      }

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
  }, [currentScreen, hasHydrated, hasSupabaseConfig, pendingAppId, selectedApp?.id]);

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
    if (!hasHydrated) return;
    if (!hasSupabaseConfig || !selectedApp) return;
    if (isChatAgentHiddenScreen(currentScreen)) return;

    if (selectedApp) {
      Promise.all([
        getHooks(selectedApp.id),
        getFilterOptions(selectedApp),
        getFeatures(selectedApp.id),
        getRecentIdeas(selectedApp.id, 24),
      ]).then(([hooks, filters, features, ideas]) => {
        setChatHooks(hooks);
        setChatFilters(filters);
        setChatFeatures(features.map(feature => feature.name));
        setChatRecentIdeas(ideas);
      }).catch(() => {});
    }
  }, [currentScreen, hasHydrated, hasSupabaseConfig, selectedApp?.id]);

  const handleLogin = (name: string) => {
    setUserName(name);
    setIsLoggedIn(true);
  };

  const handleLogout = async () => {
    if (authDisabled) {
      setCurrentScreen('f1');
      setSelectedApp(null);
      setPendingAppId(null);
      localStorage.removeItem(NAV_STATE_KEY);
      return;
    }

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

  if (!hasHydrated || checkingAuth || restoringNav) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
      </div>
    );
  }

  if (!hasSupabaseConfig) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6">
        <div className="w-full max-w-3xl rounded-3xl border border-white/10 bg-white/5 backdrop-blur p-8 md:p-10 shadow-2xl">
          <p className="text-sm uppercase tracking-[0.24em] text-amber-300 mb-3">Local setup required</p>
          <h1 className="text-3xl md:text-4xl font-semibold mb-4">App dang khong chay vi thieu env cua Supabase</h1>
          <p className="text-slate-300 leading-7">
            Dev server van chay, nhung frontend dang dung o buoc ket noi du lieu.
            Ban can tao file <code className="rounded bg-white/10 px-2 py-1 text-sm">.env.local</code> tu
            <code className="rounded bg-white/10 px-2 py-1 text-sm ml-2">.env.example</code> va dien cac bien ben duoi.
          </p>

          <div className="mt-6 rounded-2xl bg-black/30 border border-white/10 p-5">
            <p className="text-sm text-slate-300 mb-3">Missing vars</p>
            <div className="space-y-2">
              {missingSupabaseEnvVars.map((name) => (
                <div key={name} className="font-mono text-sm rounded-lg bg-amber-400/10 border border-amber-300/20 px-3 py-2 text-amber-200">
                  {name}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 rounded-2xl bg-black/30 border border-white/10 p-5 font-mono text-sm leading-7 text-slate-200 overflow-x-auto">
            <div>cp .env.example .env.local</div>
            <div>npm run dev</div>
          </div>

          <p className="mt-6 text-sm text-slate-400">
            Bat buoc: <code className="rounded bg-white/10 px-2 py-1">NEXT_PUBLIC_SUPABASE_URL</code>,
            <code className="rounded bg-white/10 px-2 py-1 ml-2">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>,
            <code className="rounded bg-white/10 px-2 py-1 ml-2">SUPABASE_SERVICE_ROLE_KEY</code>.
          </p>
        </div>
      </div>
    );
  }

  if (!authDisabled && !isLoggedIn) {
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

  const shouldHideChatAgent = isChatAgentHiddenScreen(currentScreen);

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
      <NavBar
        currentScreen={currentScreen}
        setCurrentScreen={setCurrentScreen}
        userName={userName}
        onLogout={authDisabled ? undefined : handleLogout}
        selectedModel={selectedModel}
        onModelChange={handleModelChange}
      />
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
          forceHidden={shouldHideChatAgent}
        />
      )}
    </div>
  );
}
