'use client';
import React, { useState, useEffect } from 'react';
import { Plus, X, Smartphone, Globe, Loader2, Pencil, Trash2, ScanLine, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import type { AppProject, SyncLog } from '@/types/database';
import { getApps, addApp, updateApp, deleteApp, addFeaturesBatch, getSyncLogs } from '@/lib/db';
import { getProxiedIconUrl } from '@/lib/iconProxy';


interface DashboardProps {
  onSelectApp: (app: AppProject) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onSelectApp }) => {
  const [apps, setApps] = useState<AppProject[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [isEditing, setIsEditing] = useState(false);
  const [editingAppId, setEditingAppId] = useState<string | null>(null);
  const [appUrl, setAppUrl] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualCategory, setManualCategory] = useState('Tiện ích');
  const [manualIcon, setManualIcon] = useState('📱');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [scannedFeaturesBuffer, setScannedFeaturesBuffer] = useState<any[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showIconInput, setShowIconInput] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [appsData, logsData] = await Promise.all([getApps(), getSyncLogs(undefined, 10)]);
    setApps(appsData);
    setSyncLogs(logsData);
    setLoading(false);
  };

  const resetForm = () => {
    setAppUrl(''); setManualName(''); setManualCategory('Tiện ích');
    setManualIcon('📱'); setScannedFeaturesBuffer([]); setIsEditing(false);
    setEditingAppId(null); setShowIconInput(false);
  };

  const handleOpenCreate = () => { resetForm(); setShowModal(true); };

  const handleOpenEdit = (e: React.MouseEvent, app: AppProject) => {
    e.stopPropagation();
    setIsEditing(true); setEditingAppId(app.id);
    setAppUrl(app.store_link || ''); setManualName(app.name);
    setManualCategory(app.category); setManualIcon(app.icon_url);
    setShowModal(true);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (deletingId) return;
    
    // Two-click delete: first click = confirm, second click = delete
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      // Auto-reset after 3 seconds
      setTimeout(() => setConfirmDeleteId(prev => prev === id ? null : prev), 3000);
      return;
    }
    
    setConfirmDeleteId(null);
    setDeletingId(id);
    try {
      await deleteApp(id);
      setApps(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Xóa thất bại, vui lòng thử lại.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleScan = async () => {
    if (!appUrl.trim()) return;
    setIsScanning(true);
    try {
      const res = await fetch('/api/scan-app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: appUrl }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.error || 'Scan failed');
      const scannedData = result.data;
      setManualName(scannedData.name || 'New App');
      setManualCategory(scannedData.category || 'Tiện ích');
      if (scannedData.icon && scannedData.icon.startsWith('http')) {
        setManualIcon(scannedData.icon);
      }
      setScannedFeaturesBuffer(scannedData.features || []);
    } catch (e) {
      console.error("Scan failed", e);
      alert("Không thể quét thông tin. Vui lòng nhập thủ công.");
    } finally {
      setIsScanning(false);
    }
  };

  const handleSaveApp = async () => {
    if (!manualName.trim()) { alert("Vui lòng nhập tên App."); return; }
    if (isSaving) return;
    setIsSaving(true);
    try {
      if (isEditing && editingAppId) {
        await updateApp(editingAppId, { name: manualName, category: manualCategory, icon_url: manualIcon, store_link: appUrl || null });
      } else {
        const newApp = await addApp({ name: manualName, category: manualCategory, icon_url: manualIcon, store_link: appUrl || undefined });
        if (newApp) {
          if (scannedFeaturesBuffer.length > 0) {
            const featureRows = scannedFeaturesBuffer.map(f => ({ app_id: newApp.id, name: f.name, description: f.desc || f.description || '' }));
            await addFeaturesBatch(featureRows);
            await updateApp(newApp.id, { features_count: scannedFeaturesBuffer.length });
          }
          // Auto-generate filter options (coreUser, painPoint, emotion) in background
          fetch('/api/generate-filters', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              appId: newApp.id,
              appName: manualName,
              appCategory: manualCategory,
              features: scannedFeaturesBuffer,
            }),
          }).catch(err => console.error('Auto-generate filters failed:', err));
        }
      }
      await loadData();
      setShowModal(false);
      resetForm();
    } catch (err) {
      console.error('Save failed:', err);
      alert('Lưu thất bại, vui lòng thử lại.');
    } finally {
      setIsSaving(false);
    }
  };

  const getLastSync = (appId: string) => {
    return syncLogs.find(l => l.app_id === appId);
  };

  const hasData = manualName.trim().length > 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto animate-in fade-in duration-500">
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2 text-gray-900">Ứng dụng của tôi</h1>
          <p className="text-gray-500">Quản lý các ứng dụng và chiến lược sáng tạo. Dữ liệu tự động sync hàng ngày.</p>
        </div>
        <button onClick={handleOpenCreate}
          className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-2.5 rounded-xl font-medium hover:from-indigo-700 hover:to-purple-700 transition-all flex items-center gap-2 shadow-lg shadow-indigo-200"
        >
          <Plus size={20} /> Thêm App
        </button>
      </div>

      {apps.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Smartphone className="w-16 h-16 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">Chưa có ứng dụng nào</p>
          <p className="text-sm mt-1">Bấm &ldquo;Thêm App&rdquo; để bắt đầu</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {apps.map(app => {
            const lastSync = getLastSync(app.id);
            return (
              <div key={app.id} onClick={() => !deletingId && onSelectApp(app)}
                className={`bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 cursor-pointer transition-all duration-300 group relative overflow-hidden ${deletingId === app.id ? 'opacity-50 scale-95 pointer-events-none' : ''}`}
              >
                <div className="absolute top-0 left-0 w-1.5 h-full bg-gradient-to-b from-indigo-500 to-purple-500 opacity-0 group-hover:opacity-100 transition-opacity" />

                {/* Action buttons */}
                <div className="absolute top-4 right-4 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <button onClick={(e) => handleOpenEdit(e, app)} className="p-2 bg-gray-100 hover:bg-indigo-100 text-gray-500 hover:text-indigo-600 rounded-lg transition-colors" title="Sửa">
                    <Pencil size={14} />
                  </button>
                  <button onClick={(e) => handleDelete(e, app.id)} disabled={!!deletingId}
                    className={`p-2 rounded-lg transition-all disabled:opacity-50 ${
                      confirmDeleteId === app.id
                        ? 'bg-red-500 text-white shadow-md scale-110 animate-pulse'
                        : 'bg-gray-100 hover:bg-red-100 text-gray-500 hover:text-red-600'
                    }`} title={confirmDeleteId === app.id ? 'Bấm lần nữa để xóa' : 'Xóa'}>
                    {deletingId === app.id ? <Loader2 size={14} className="animate-spin" /> : 
                     confirmDeleteId === app.id ? <span className="text-xs font-bold px-1">Xóa?</span> : <Trash2 size={14} />}
                  </button>
                </div>

                <div className="flex flex-col items-center text-center">
                  <div className="mb-4 w-20 h-20 flex items-center justify-center transform group-hover:scale-110 transition-transform duration-300">
                    {app.icon_url.startsWith('http') ? (
                      <img src={getProxiedIconUrl(app.icon_url)} alt={app.name} className="w-full h-full object-cover rounded-2xl shadow-sm" />
                    ) : (
                      <span className="text-5xl">{app.icon_url}</span>
                    )}
                  </div>
                  <div className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full mb-2 uppercase tracking-wider">
                    {app.category}
                  </div>
                  <h3 className="font-bold text-lg mb-1.5 text-gray-800 line-clamp-1">{app.name}</h3>
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <Smartphone size={14} />
                    <span>{app.features_count} tính năng</span>
                  </div>

                  {/* Sync status */}
                  {lastSync && (
                    <div className={`mt-3 flex items-center gap-1.5 text-xs ${lastSync.status === 'success' ? 'text-green-500' : lastSync.status === 'failed' ? 'text-red-500' : 'text-yellow-500'}`}>
                      {lastSync.status === 'success' ? <CheckCircle size={12} /> : lastSync.status === 'failed' ? <AlertCircle size={12} /> : <RefreshCw size={12} className="animate-spin" />}
                      <span>Sync: {new Date(lastSync.created_at).toLocaleDateString('vi-VN')}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl p-8 max-w-lg w-full mx-4 shadow-2xl relative">
            <button onClick={() => setShowModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors">
              <X size={24} />
            </button>
            <h2 className="text-2xl font-bold text-gray-800 mb-6">{isEditing ? 'Chỉnh Sửa App' : 'Thêm App Mới'}</h2>
            <div className="space-y-6">
              {/* Step 1: Scan */}
              {!hasData && (
                <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-6 text-center">
                  <div className="bg-white w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm text-indigo-600">
                    <Globe size={24} />
                  </div>
                  <h3 className="font-bold text-indigo-900 mb-2">Nhập Link Store</h3>
                  <p className="text-sm text-indigo-600 mb-4">Dán link App Store / Google Play để AI tự động lấy thông tin.</p>
                  <input type="text" value={appUrl} onChange={(e) => setAppUrl(e.target.value)}
                    placeholder="https://apps.apple.com/..." autoFocus
                    className="w-full border border-indigo-200 rounded-lg px-4 py-3 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none bg-white text-sm mb-3" />
                  <button onClick={handleScan} disabled={isScanning || !appUrl}
                    className="w-full bg-indigo-600 text-white px-4 py-3 rounded-lg font-bold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-md shadow-indigo-200">
                    {isScanning ? <Loader2 className="animate-spin" size={18} /> : <ScanLine size={18} />}
                    {isScanning ? 'Đang phân tích...' : 'Quét Thông Tin'}
                  </button>
                  <div className="mt-4 flex items-center gap-3">
                    <div className="h-px bg-indigo-200 flex-1" /><span className="text-xs text-indigo-400 font-medium uppercase">Hoặc</span><div className="h-px bg-indigo-200 flex-1" />
                  </div>
                  <button onClick={() => setManualName('New App')} className="mt-4 text-sm text-gray-500 hover:text-gray-700 font-medium underline">
                    Nhập thủ công
                  </button>
                </div>
              )}

              {/* Step 2: Edit form */}
              {hasData && (
                <div className="animate-in slide-in-from-bottom duration-300">
                  <div className="flex flex-col items-center mb-6">
                    <div className="w-24 h-24 rounded-2xl overflow-hidden shadow-lg border border-gray-100 mb-3 bg-white flex items-center justify-center relative group">
                      {manualIcon.startsWith('http') ? (
                        <img src={getProxiedIconUrl(manualIcon)} alt="Icon" className="w-full h-full object-cover" />
                      ) : (<span className="text-5xl">{manualIcon || '📱'}</span>)}
                      <button onClick={() => setShowIconInput(!showIconInput)}
                        className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                        <Pencil size={20} />
                      </button>
                    </div>
                    {showIconInput && (
                      <input type="text" value={manualIcon} onChange={(e) => setManualIcon(e.target.value)}
                        placeholder="URL Icon..." autoFocus
                        className="text-xs border border-gray-300 rounded px-2 py-1 w-full max-w-[200px] mb-1" />
                    )}
                    <span className="text-xs text-gray-400">Click icon để thay đổi URL</span>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Link Store</label>
                      <div className="flex gap-2">
                        <input type="text" value={appUrl} onChange={(e) => setAppUrl(e.target.value)}
                          placeholder="Paste link App Store / Google Play..."
                          className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 focus:border-indigo-500 outline-none text-sm" />
                        <button onClick={handleScan} disabled={isScanning || !appUrl}
                          className="px-3 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-lg hover:bg-indigo-100 transition-colors flex items-center justify-center" title="Quét">
                          {isScanning ? <Loader2 className="animate-spin" size={20} /> : <ScanLine size={20} />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Tên App</label>
                      <input type="text" value={manualName} onChange={(e) => setManualName(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:border-indigo-500 outline-none font-medium" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Danh mục</label>
                      <select value={manualCategory} onChange={(e) => setManualCategory(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:border-indigo-500 outline-none bg-white">
                        <option>Sức khỏe &amp; Thể hình</option>
                        <option>Tiện ích</option>
                        <option>Tổng hợp</option>
                        <option>Trò chơi</option>
                        <option>Tài chính</option>
                        <option>Giáo dục</option>
                        <option>Mạng xã hội</option>
                      </select>
                    </div>
                  </div>

                  {scannedFeaturesBuffer.length > 0 && (
                    <div className="mt-4 p-3 bg-green-50 border border-green-100 rounded-lg">
                      <p className="text-sm font-medium text-green-700 mb-1">✅ {scannedFeaturesBuffer.length} tính năng đã quét</p>
                      <ul className="text-xs text-green-600 space-y-0.5">
                        {scannedFeaturesBuffer.map((f, i) => <li key={i}>• {f.name}</li>)}
                      </ul>
                    </div>
                  )}

                  <div className="flex gap-3 pt-4 border-t border-gray-100 mt-6">
                    <button onClick={handleSaveApp} disabled={isSaving}
                      className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-3 rounded-xl font-bold hover:from-indigo-700 hover:to-purple-700 transition-all shadow-lg disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                      {isSaving && <Loader2 size={18} className="animate-spin" />}
                      {isSaving ? 'Đang lưu...' : isEditing ? 'Lưu Thay Đổi' : 'Tạo Dự Án App'}
                    </button>
                    <button onClick={() => { resetForm(); setShowModal(false); }} disabled={isSaving}
                      className="flex-1 border border-gray-300 text-gray-700 px-6 py-3 rounded-xl font-semibold hover:bg-gray-50 transition-all disabled:opacity-50">
                      Hủy
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
