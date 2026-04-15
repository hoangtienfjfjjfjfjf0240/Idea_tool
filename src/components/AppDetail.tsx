'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Lightbulb, Film, Pencil, Plus, X, Loader2, RefreshCw, CheckCircle, AlertCircle, BarChart3, Brain, Settings, Sparkles, PenTool } from 'lucide-react';
import type { AppProject, Feature, SyncLog, ScreenType } from '@/types/database';
import { getFeatures, addFeature, updateFeature, updateApp, getSyncLogs, getIdeaSessions, type IdeaSession } from '@/lib/db';
import { StrategyMap } from '@/components/StrategyMap';
import { getProxiedIconUrl } from '@/lib/iconProxy';

type AppTab = 'overview' | 'ideas' | 'hooks' | 'strategy' | 'brain' | 'config';

const TABS: { id: AppTab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'brain', label: 'AI Brain', icon: Brain },
  { id: 'config', label: 'Cấu hình', icon: Settings },
];

interface AppDetailProps {
  app: AppProject;
  onBack: () => void;
  onNavigate: (path: string) => void;
  onAppUpdated?: (app: AppProject) => void;
}

export const AppDetail: React.FC<AppDetailProps> = ({ app, onBack, onNavigate, onAppUpdated }) => {
  const [activeTab, setActiveTab] = useState<AppTab>('overview');
  const [features, setFeatures] = useState<Feature[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFeatureModal, setShowFeatureModal] = useState(false);
  const [featureName, setFeatureName] = useState('');
  const [featureDesc, setFeatureDesc] = useState('');
  const [editingFeature, setEditingFeature] = useState<Feature | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Quick stats
  const [sessions, setSessions] = useState<IdeaSession[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    loadData();
    loadStats();
  }, [app.id]);

  const loadData = async () => {
    setLoading(true);
    const [feats, logs] = await Promise.all([
      getFeatures(app.id), getSyncLogs(app.id, 5),
    ]);
    setFeatures(feats);
    setSyncLogs(logs);
    setLoading(false);
  };

  const loadStats = async () => {
    setStatsLoading(true);
    try {
      const data = await getIdeaSessions(app.id);
      setSessions(data);
    } catch { /* ignore */ }
    setStatsLoading(false);
  };

  const stats = useMemo(() => {
    let totalIdeas = 0, wins = 0, failed = 0;
    sessions.forEach(s => s.ideas.forEach((i: any) => {
      totalIdeas++;
      if (i.result === 'win') wins++;
      if (i.result === 'failed') failed++;
    }));
    const winRate = totalIdeas > 0 ? Math.round((wins / totalIdeas) * 100) : 0;
    return { totalIdeas, wins, failed, winRate, sessions: sessions.length };
  }, [sessions]);

  const handleAddFeature = async () => {
    if (!featureName.trim()) return;
    if (editingFeature) {
      await updateFeature(editingFeature.id, { name: featureName, description: featureDesc });
    } else {
      await addFeature({ app_id: app.id, name: featureName, description: featureDesc });
    }
    await updateApp(app.id, { features_count: features.length + (editingFeature ? 0 : 1) });
    setShowFeatureModal(false); setFeatureName(''); setFeatureDesc(''); setEditingFeature(null);
    await loadData();
  };

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/sync-apps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appId: app.id }) });
      const data = await res.json();
      if (data.success) {
        await loadData();
        if (onAppUpdated && data.results?.[0]?.updated) {
          const updated = { ...app, ...data.results[0].changes };
          onAppUpdated(updated);
        }
      }
    } catch (e) { console.error(e); }
    setSyncing(false);
  };

  const handleTabClick = (tab: AppTab) => {
    setActiveTab(tab);
  };

  // =====================
  //  TAB: Overview
  // =====================
  const renderOverview = () => (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { n: stats.totalIdeas, label: 'Tổng Ideas', icon: '💡', bg: 'from-blue-50 to-indigo-50', border: 'border-blue-100', text: 'text-blue-600' },
          { n: stats.wins, label: 'Winning', icon: '🏆', bg: 'from-emerald-50 to-green-50', border: 'border-emerald-100', text: 'text-emerald-600' },
          { n: `${stats.winRate}%`, label: 'Win Rate', icon: '📈', bg: 'from-purple-50 to-violet-50', border: 'border-purple-100', text: 'text-purple-600' },
          { n: stats.sessions, label: 'Phiên', icon: '📊', bg: 'from-amber-50 to-orange-50', border: 'border-amber-100', text: 'text-amber-600' },
        ].map(s => (
          <div key={s.label} className={`bg-gradient-to-br ${s.bg} border ${s.border} rounded-2xl p-4 text-center`}>
            <span className="text-lg">{s.icon}</span>
            <p className={`text-2xl font-bold ${s.text} mt-1`}>{statsLoading ? '…' : s.n}</p>
            <p className="text-xs text-gray-500 font-medium mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Quick Actions — Hero Buttons */}
      <div className="grid grid-cols-2 gap-4">
        <button onClick={() => onNavigate('f2.1')}
          className="bg-gradient-to-r from-pink-500 via-rose-500 to-orange-500 text-white px-6 py-5 rounded-2xl font-extrabold text-lg hover:shadow-xl hover:shadow-orange-200 hover:scale-[1.02] transition-all flex items-center justify-center gap-3 group">
          <Sparkles size={24} className="group-hover:animate-pulse" /> Tạo Ý Tưởng Mới
        </button>
        <button onClick={() => onNavigate('f2.2')}
          className="bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500 text-white px-6 py-5 rounded-2xl font-extrabold text-lg hover:shadow-xl hover:shadow-indigo-200 hover:scale-[1.02] transition-all flex items-center justify-center gap-3 group">
          <PenTool size={24} className="group-hover:animate-pulse" /> Modify Creative
        </button>
      </div>

      {/* Strategy Map — inline tree diagram */}
      <StrategyMap app={app} onBack={() => {}} inline onCreateFromBranch={(filters) => {
        onNavigate('f2.1');
      }} />
    </div>
  );

  // =====================
  //  TAB: AI Brain
  // =====================
  const renderBrain = () => (
    <div className="space-y-4 animate-in fade-in duration-300">
      <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
              <span className="text-2xl">🧠</span>
            </div>
            <div>
              <h3 className="font-bold text-gray-800 text-lg">Bộ Não AI</h3>
              <p className="text-sm text-gray-500">
                {app.app_knowledge ? 'Đã học — AI hiểu app của bạn' : 'Chưa học — Gen ideas để AI bắt đầu học'}
              </p>
            </div>
          </div>
          <div className={`px-4 py-1.5 rounded-full text-sm font-semibold ${app.app_knowledge ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
            {app.app_knowledge ? '✅ Active' : '⏹ Empty'}
          </div>
        </div>
        {app.app_knowledge ? (
          <div className="p-4 bg-white/70 rounded-xl text-sm text-gray-600 whitespace-pre-wrap max-h-96 overflow-y-auto leading-relaxed border border-emerald-100">
            {app.app_knowledge}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-400">
            <p className="text-sm">AI chưa có kiến thức về app này.</p>
            <p className="text-xs mt-1">Tạo ý tưởng để AI bắt đầu học và cải thiện kết quả.</p>
          </div>
        )}
      </div>
    </div>
  );

  // =====================
  //  TAB: Cấu hình
  // =====================
  const renderConfig = () => (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Sync info */}
      {app.store_link && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-bold text-gray-700">Store Link</h3>
            <button onClick={handleManualSync} disabled={syncing}
              className="px-4 py-2 text-sm bg-green-50 text-green-600 border border-green-100 rounded-xl hover:bg-green-100 transition-colors flex items-center gap-2 disabled:opacity-50">
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
          <a href={app.store_link} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-500 hover:underline break-all">
            {app.store_link}
          </a>
          {app.last_synced_at && (
            <p className="text-xs text-gray-400 mt-2">Sync lần cuối: {new Date(app.last_synced_at).toLocaleString('vi-VN')}</p>
          )}
        </div>
      )}

      {/* Features */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-gray-700 text-lg">Tính năng ({features.length})</h3>
          <button onClick={() => { setEditingFeature(null); setFeatureName(''); setFeatureDesc(''); setShowFeatureModal(true); }}
            className="text-sm text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1">
            <Plus size={16} /> Thêm
          </button>
        </div>
        {loading ? (
          <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-300" /></div>
        ) : features.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Chưa có tính năng nào. Thêm thủ công hoặc quét từ Store.</p>
        ) : (
          <div className="space-y-2">
            {features.map(f => (
              <div key={f.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl group hover:bg-gray-100 transition-colors">
                <div className="flex-1">
                  <h4 className="font-medium text-gray-800 text-sm">{f.name}</h4>
                  {f.description && <p className="text-xs text-gray-500 mt-0.5">{f.description}</p>}
                </div>
                <button onClick={() => { setEditingFeature(f); setFeatureName(f.name); setFeatureDesc(f.description || ''); setShowFeatureModal(true); }}
                  className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-white rounded-lg transition-all">
                  <Pencil size={14} className="text-gray-400" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sync Logs */}
      {syncLogs.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="font-bold text-gray-700 mb-3">Lịch sử Sync</h3>
          <div className="space-y-2">
            {syncLogs.map(log => (
              <div key={log.id} className="flex items-center gap-3 p-2 text-sm">
                {log.status === 'success' ? <CheckCircle size={16} className="text-green-500" /> : log.status === 'failed' ? <AlertCircle size={16} className="text-red-500" /> : <RefreshCw size={16} className="text-yellow-500 animate-spin" />}
                <span className="text-gray-600">{log.sync_type === 'auto' ? 'Tự động' : 'Thủ công'}</span>
                <span className="text-gray-400">•</span>
                <span className="text-gray-400 text-xs">{new Date(log.created_at).toLocaleString('vi-VN')}</span>
                {log.error_message && <span className="text-red-400 text-xs ml-auto">{log.error_message}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto animate-in fade-in duration-500">
      {/* Back */}
      <button onClick={onBack} className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-4 transition-colors">
        <ArrowLeft size={18} /> Quay lại
      </button>

      {/* App Header — compact */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-0">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 shadow-md flex items-center justify-center bg-gray-50">
            {app.icon_url.startsWith('http') ? (
              <img src={getProxiedIconUrl(app.icon_url)} alt={app.name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-4xl">{app.icon_url}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900 truncate">{app.name}</h1>
              <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full uppercase tracking-wider flex-shrink-0">{app.category}</span>
            </div>
            {app.store_link && (
              <p className="text-xs text-gray-400 truncate mt-1">{app.store_link}</p>
            )}
          </div>
          {app.store_link && (
            <button onClick={handleManualSync} disabled={syncing}
              className="px-4 py-2 text-sm bg-green-50 text-green-600 border border-green-100 rounded-xl hover:bg-green-100 transition-colors flex items-center gap-2 disabled:opacity-50 flex-shrink-0">
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing...' : 'Sync'}
            </button>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white border border-gray-100 border-t-0 rounded-b-2xl shadow-sm px-2 mb-6">
        <div className="flex gap-1">
          {TABS.map(tab => {
            const TabIcon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => handleTabClick(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all border-b-2 ${
                  isActive
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-400 hover:text-gray-600 hover:border-gray-200'
                }`}>
                <TabIcon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content — all tabs stay mounted, hidden via CSS for instant switching */}
      <div>
        <div style={{ display: activeTab === 'overview' ? 'block' : 'none' }}>
          {renderOverview()}
        </div>
        <div style={{ display: activeTab === 'brain' ? 'block' : 'none' }}>
          {renderBrain()}
        </div>
        <div style={{ display: activeTab === 'config' ? 'block' : 'none' }}>
          {renderConfig()}
        </div>
      </div>

      {/* Feature Modal */}
      {showFeatureModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">{editingFeature ? 'Sửa Tính Năng' : 'Thêm Tính Năng'}</h3>
              <button onClick={() => setShowFeatureModal(false)}><X size={20} className="text-gray-400" /></button>
            </div>
            <input type="text" value={featureName} onChange={(e) => setFeatureName(e.target.value)}
              placeholder="Tên tính năng" className="w-full border border-gray-300 rounded-lg px-4 py-2.5 mb-3 focus:border-indigo-500 outline-none" />
            <textarea value={featureDesc} onChange={(e) => setFeatureDesc(e.target.value)}
              placeholder="Mô tả ngắn..." rows={3} className="w-full border border-gray-300 rounded-lg px-4 py-2.5 mb-4 focus:border-indigo-500 outline-none resize-none" />
            <div className="flex gap-3">
              <button onClick={handleAddFeature} className="flex-1 bg-indigo-600 text-white py-2.5 rounded-xl font-bold hover:bg-indigo-700 transition-all">Lưu</button>
              <button onClick={() => setShowFeatureModal(false)} className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-xl font-semibold hover:bg-gray-50 transition-all">Hủy</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};