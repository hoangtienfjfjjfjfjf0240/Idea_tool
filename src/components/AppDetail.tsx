'use client';
import React, { useState, useEffect } from 'react';
import { ArrowLeft, Lightbulb, Film, Pencil, Plus, X, Loader2, RefreshCw, CheckCircle, AlertCircle, BarChart3 } from 'lucide-react';
import type { AppProject, Feature, SyncLog } from '@/types/database';
import { getFeatures, addFeature, updateFeature, updateApp, getSyncLogs } from '@/lib/db';

interface AppDetailProps {
  app: AppProject;
  onBack: () => void;
  onNavigate: (path: string) => void;
  onAppUpdated?: (app: AppProject) => void;
}

export const AppDetail: React.FC<AppDetailProps> = ({ app, onBack, onNavigate, onAppUpdated }) => {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFeatureModal, setShowFeatureModal] = useState(false);
  const [featureName, setFeatureName] = useState('');
  const [featureDesc, setFeatureDesc] = useState('');
  const [editingFeature, setEditingFeature] = useState<Feature | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    loadData();
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

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto animate-in fade-in duration-500">
      {/* Header */}
      <button onClick={onBack} className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-6 transition-colors">
        <ArrowLeft size={18} /> Quay lại
      </button>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 md:p-8 mb-6">
        <div className="flex items-start gap-6">
          <div className="w-24 h-24 rounded-2xl overflow-hidden flex-shrink-0 shadow-md flex items-center justify-center bg-gray-50">
            {app.icon_url.startsWith('http') ? (
              <img src={app.icon_url} alt={app.name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-5xl">{app.icon_url}</span>
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-gray-900">{app.name}</h1>
              <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full uppercase tracking-wider">{app.category}</span>
            </div>
            {app.store_link && (
              <a href={app.store_link} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-500 hover:underline break-all">
                {app.store_link}
              </a>
            )}
            {app.last_synced_at && (
              <p className="text-xs text-gray-400 mt-2">
                Đồng bộ lần cuối: {new Date(app.last_synced_at).toLocaleString('vi-VN')}
              </p>
            )}
          </div>
          {app.store_link && (
            <button onClick={handleManualSync} disabled={syncing}
              className="px-4 py-2 text-sm bg-green-50 text-green-600 border border-green-100 rounded-xl hover:bg-green-100 transition-colors flex items-center gap-2 disabled:opacity-50">
              <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Đang sync...' : 'Sync Now'}
            </button>
          )}
        </div>
      </div>

      {/* Action Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <button onClick={() => onNavigate('f2.1')}
          className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-100 rounded-2xl p-6 text-left hover:shadow-lg hover:-translate-y-0.5 transition-all group">
          <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
            <Lightbulb className="text-amber-600" size={24} />
          </div>
          <h3 className="font-bold text-gray-800 text-lg mb-1">Tạo Ý Tưởng</h3>
          <p className="text-sm text-gray-500">Filter → Generate → Kịch bản chi tiết</p>
        </button>
        <button onClick={() => onNavigate('f2.3')}
          className="bg-gradient-to-br from-sky-50 to-indigo-50 border border-sky-100 rounded-2xl p-6 text-left hover:shadow-lg hover:-translate-y-0.5 transition-all group">
          <div className="w-12 h-12 bg-sky-100 rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
            <BarChart3 className="text-sky-600" size={24} />
          </div>
          <h3 className="font-bold text-gray-800 text-lg mb-1">Plan Overview</h3>
          <p className="text-sm text-gray-500">Biểu đồ Painpoint · Emotion · PSP</p>
        </button>
        <button onClick={() => onNavigate('f2.2')}
          className="bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-100 rounded-2xl p-6 text-left hover:shadow-lg hover:-translate-y-0.5 transition-all group">
          <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
            <Film className="text-purple-600" size={24} />
          </div>
          <h3 className="font-bold text-gray-800 text-lg mb-1">Thư Viện Hook</h3>
          <p className="text-sm text-gray-500">Quản lý & phân tích các Winning Hook</p>
        </button>
      </div>

      {/* AI Brain Status */}
      <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100 rounded-2xl p-6 mb-8">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
              <span className="text-xl">🧠</span>
            </div>
            <div>
              <h3 className="font-bold text-gray-800">Bộ Não AI</h3>
              <p className="text-xs text-gray-500">
                {app.app_knowledge ? 'Đã học — AI hiểu app của bạn' : 'Chưa học — Gen ideas để AI bắt đầu học'}
              </p>
            </div>
          </div>
          <div className={`px-3 py-1 rounded-full text-xs font-semibold ${app.app_knowledge ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
            {app.app_knowledge ? '✅ Active' : '⏹ Empty'}
          </div>
        </div>
        {app.app_knowledge && (
          <details className="mt-2">
            <summary className="text-sm text-emerald-600 cursor-pointer hover:text-emerald-800 font-medium">
              Xem kiến thức AI đã học →
            </summary>
            <div className="mt-3 p-4 bg-white/70 rounded-xl text-sm text-gray-600 whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed">
              {app.app_knowledge}
            </div>
          </details>
        )}
      </div>

      {/* Features */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-gray-800">Tính năng ({features.length})</h2>
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
          <div className="space-y-3">
            {features.map(f => (
              <div key={f.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl group">
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
        <div className="mt-6 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4">Lịch sử Sync</h2>
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