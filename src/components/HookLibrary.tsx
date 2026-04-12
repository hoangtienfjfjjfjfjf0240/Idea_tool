'use client';
import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Play, PenTool, Sparkles, Plus, X, Wand2, Copy, Target, Loader2, ListOrdered, Upload, Image as ImageIcon, Video as VideoIcon, Check, RefreshCw, Eye, Trash2, Brain, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import type { ScreenType, Hook, AppProject } from '@/types/database';
import type { AIModel } from '@/components/NavBar';
import * as dbService from '@/lib/db';

interface HookLibraryProps {
  setScreen: (s: ScreenType) => void;
  currentScreen: ScreenType;
  app?: AppProject | null;
  selectedModel?: AIModel;
}

interface HookIdea {
  id: string;
  title: string;
  explanation: string;
  hook: { script?: string; textOverlay?: string; visual: string; text: string; voice: string; imageUrl?: string };
}

export const HookLibrary: React.FC<HookLibraryProps> = ({ setScreen, currentScreen, app, selectedModel }) => {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [selectedHook, setSelectedHook] = useState<Hook | null>(null);
  const [modifyPrompt, setModifyPrompt] = useState('');
  const [generatedIdeas, setGeneratedIdeas] = useState<HookIdea[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [quantity, setQuantity] = useState(3);
  // Hook-to-Ideas state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [fullIdeas, setFullIdeas] = useState<any[]>([]);
  const [fullIdeasLoading, setFullIdeasLoading] = useState(false);
  const [fullIdeasDuration, setFullIdeasDuration] = useState('30s');
  const [fullIdeasQty, setFullIdeasQty] = useState(3);
  const [ideaDirection, setIdeaDirection] = useState('');
  const [expandedIdea, setExpandedIdea] = useState<number | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingHookData, setEditingHookData] = useState<Partial<Hook> & { localVideoUrl?: string; localImageUrl?: string }>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisSuccess, setAnalysisSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingHookId, setDeletingHookId] = useState<string | null>(null);
  const [previewHook, setPreviewHook] = useState<Hook | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const progressRef = useRef<NodeJS.Timeout | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFileRef = useRef<File | null>(null);
  const pendingThumbRef = useRef<string | null>(null);

  useEffect(() => { loadHooks(); }, [app?.id]);

  const loadHooks = async () => {
    const data = await dbService.getHooks(app?.id);
    setHooks(data);
  };

  const handleDeleteHook = async (id: string) => {
    if (deletingHookId) return;
    if (!window.confirm('Bạn có chắc muốn xóa hook này?')) return;
    setDeletingHookId(id);
    try {
      await dbService.deleteHook(id);
      setHooks(prev => prev.filter(h => h.id !== id));
    } catch (err) {
      console.error('Delete hook failed:', err);
      alert('Xóa hook thất bại.');
    } finally {
      setDeletingHookId(null);
    }
  };

  const startProgress = () => {
    setProgress(0);
    setProgressLabel('Đang phân tích hook gốc...');
    const steps = [
      { at: 5, label: 'Đang phân tích hook gốc...' },
      { at: 15, label: 'Đang xây dựng biến thể mới...' },
      { at: 35, label: 'Đang viết Visual chi tiết...' },
      { at: 55, label: 'Đang tạo Voice & Text...' },
      { at: 75, label: 'Đang hoàn thiện kết quả...' },
      { at: 90, label: 'Đang kiểm tra chất lượng...' },
    ];
    let current = 0;
    progressRef.current = setInterval(() => {
      current += Math.random() * 2.5 + 0.5;
      if (current > 95) current = 95;
      setProgress(Math.round(current));
      const step = [...steps].reverse().find(s => current >= s.at);
      if (step) setProgressLabel(step.label);
    }, 500);
  };

  const stopProgress = () => {
    if (progressRef.current) clearInterval(progressRef.current);
    progressRef.current = null;
    setProgress(100);
    setProgressLabel('Hoàn thành! ✨');
    setTimeout(() => { setProgress(0); setProgressLabel(''); }, 1500);
  };

  const handleCancel = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    stopProgress();
    setIsLoading(false);
    setProgress(0);
    setProgressLabel('Đã hủy');
    setTimeout(() => setProgressLabel(''), 1500);
  };

  const handleGenerate = async () => {
    if (!selectedHook || !modifyPrompt) return;
    setIsLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    startProgress();
    try {
      const res = await fetch('/api/generate-hooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hook: selectedHook,
          instruction: modifyPrompt,
          quantity,
          appName: app?.name || '',
          appCategory: app?.category || '',
          selectedModel: selectedModel || 'gemini-2.5-pro',
        }),
        signal: controller.signal,
      });
      const result = await res.json();
      if (res.ok && result.success && result.data?.length > 0) {
        setGeneratedIdeas(result.data);
      } else {
        // Fallback mock
        const mockIdeas: HookIdea[] = Array.from({ length: quantity }, (_, i) => ({
          id: crypto.randomUUID(),
          title: `${selectedHook.title} - Biến thể ${i + 1}`,
          explanation: `Áp dụng "${selectedHook.hook_concept || selectedHook.title}" kết hợp "${modifyPrompt}"`,
          hook: {
            visual: `${selectedHook.visual_detail || 'Cận cảnh'} + ${modifyPrompt}`,
            text: `${selectedHook.title} (v${i + 1})`,
            voice: `"${modifyPrompt} — ${selectedHook.description || ''}"`
          }
        }));
        setGeneratedIdeas(mockIdeas);
      }
    } catch (err) {
      console.error('Generate hooks failed:', err);
      alert('Có lỗi khi tạo hook. Vui lòng thử lại.');
    } finally {
      stopProgress();
      setIsLoading(false);
    }
  };

  const handleCopy = (idea: HookIdea) => {
    const scriptContent = idea.hook.script || `VISUAL: ${idea.hook.visual}\n[VOICE] ${idea.hook.voice}`;
    const text = `HOOK: ${idea.title}\nSCENARIO: ${idea.explanation}\n\n${scriptContent}\n\n[TEXT OVERLAY] ${idea.hook.textOverlay || idea.hook.text}`;
    navigator.clipboard.writeText(text);
  };

  const openEditModal = (hook?: Hook) => {
    setAnalysisSuccess(false);
    // Reset pending file refs — important to prevent stale refs from previous modal session
    pendingFileRef.current = null;
    pendingThumbRef.current = null;
    if (hook) {
      setEditingHookData({ 
        ...hook, 
        localVideoUrl: hook.video_url || undefined,
        localImageUrl: hook.image_url || undefined,
      });
    } else {
      setEditingHookData({ title: '', subtitle: 'Hook Mới', thumb: '✨', description: '', hook_concept: '', visual_detail: '' });
    }
    setIsEditModalOpen(true);
  };

  const handleSaveHook = async () => {
    if (!editingHookData.title) return;
    setIsSaving(true);
    try {
      let imageUrl = editingHookData.image_url || null;
      let videoUrl = editingHookData.video_url || null;

      // Upload via server API route (uses service role key, no RLS issues)
      if (pendingFileRef.current) {
        const formData = new FormData();
        formData.append('file', pendingFileRef.current);
        if (pendingFileRef.current.type.startsWith('video') && pendingThumbRef.current) {
          formData.append('thumbBase64', pendingThumbRef.current);
        }

        try {
          const uploadRes = await fetch('/api/upload-hook-media', {
            method: 'POST',
            body: formData,
          });
          const uploadResult = await uploadRes.json();
          if (uploadRes.ok && uploadResult.success) {
            if (uploadResult.videoUrl) videoUrl = uploadResult.videoUrl;
            if (uploadResult.imageUrl) imageUrl = uploadResult.imageUrl;
          } else {
            console.error('Upload failed:', uploadResult.error);
          }
        } catch (uploadErr) {
          console.error('Upload request failed:', uploadErr);
        }

        pendingFileRef.current = null;
        pendingThumbRef.current = null;
      }

      if (editingHookData.id) {
        await dbService.updateHook(editingHookData.id, {
          title: editingHookData.title,
          subtitle: editingHookData.subtitle,
          description: editingHookData.description,
          hook_concept: editingHookData.hook_concept,
          visual_detail: editingHookData.visual_detail,
          core_user: editingHookData.core_user || null,
          painpoint: editingHookData.painpoint || null,
          emotion: editingHookData.emotion || null,
          creative_type: editingHookData.creative_type || null,
          image_url: imageUrl,
          video_url: videoUrl,
        });
      } else {
        if (!app?.id) { alert('Không tìm thấy app. Vui lòng quay lại.'); setIsSaving(false); return; }
        await dbService.addHook({
          app_id: app.id,
          title: editingHookData.title!,
          subtitle: editingHookData.subtitle || null,
          thumb: editingHookData.thumb || '✨',
          description: editingHookData.description || null,
          hook_concept: editingHookData.hook_concept || null,
          visual_detail: editingHookData.visual_detail || null,
          core_user: editingHookData.core_user || null,
          painpoint: editingHookData.painpoint || null,
          emotion: editingHookData.emotion || null,
          creative_type: editingHookData.creative_type || null,
          image_url: imageUrl,
          video_url: videoUrl,
        });
      }
      await loadHooks();
      setIsEditModalOpen(false);
    } catch(e: unknown) {
      console.error('Save hook error:', e);
    } finally { setIsSaving(false); }
  };

  const extractThumbnail = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata'; video.muted = true; video.playsInline = true;
      const cleanup = () => { if (video.src) URL.revokeObjectURL(video.src); video.remove(); };
      video.onloadeddata = () => { video.currentTime = 0.1; };
      video.onseeked = () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL('image/jpeg', 0.7)); }
        else resolve('');
        cleanup();
      };
      video.onerror = () => { resolve(''); cleanup(); };
      video.src = URL.createObjectURL(file);
    });
  };

  const analyzeWithGemini = async (imageBase64: string, fileName: string) => {
    try {
      const res = await fetch('/api/analyze-hook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, fileName }),
      });
      const result = await res.json();
      if (res.ok && result.success) {
        setEditingHookData(prev => ({
          ...prev,
          title: prev.title === fileName.replace(/\.[^/.]+$/, '') ? result.data.title : prev.title,
          subtitle: result.data.subtitle,
          description: result.data.description,
          hook_concept: result.data.hook_concept,
          visual_detail: result.data.visual_detail,
          core_user: result.data.core_user,
          painpoint: result.data.painpoint,
          emotion: result.data.emotion,
          creative_type: result.data.creative_type,
        }));
        setAnalysisSuccess(true);
      } else {
        // Fallback if AI fails
        setEditingHookData(prev => ({
          ...prev,
          subtitle: 'Hook',
          description: prev.description || `Hook từ "${fileName}"`,
        }));
        setAnalysisSuccess(true);
      }
    } catch (err) {
      console.error('AI analysis failed:', err);
      setEditingHookData(prev => ({ ...prev, subtitle: 'Hook' }));
      setAnalysisSuccess(true);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsAnalyzing(true); setAnalysisSuccess(false);
    // Store file reference for upload on save
    pendingFileRef.current = file;
    setEditingHookData(prev => ({ ...prev, title: prev.title || file.name.replace(/\.[^/.]+$/, ''), subtitle: 'Đang phân tích bằng AI...' }));

    if (file.type.startsWith('video')) {
      const localUrl = URL.createObjectURL(file);
      const thumb = await extractThumbnail(file);
      pendingThumbRef.current = thumb || null;
      setEditingHookData(prev => ({ ...prev, localVideoUrl: localUrl, localImageUrl: thumb || undefined }));
      
      // Send thumbnail frame to Gemini for analysis
      if (thumb) {
        await analyzeWithGemini(thumb, file.name);
      } else {
        setEditingHookData(prev => ({ ...prev, subtitle: 'Video Hook' }));
        setAnalysisSuccess(true);
        setIsAnalyzing(false);
      }
    } else if (file.type.startsWith('image')) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        setEditingHookData(prev => ({ ...prev, localImageUrl: base64 }));
        // Send image to Gemini for analysis
        await analyzeWithGemini(base64, file.name);
      };
      reader.readAsDataURL(file);
    }
    // Reset input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // === Hook Grid View (f2.2) ===
  if (currentScreen === 'f2.2') {
    return (
      <div className="p-6 sm:p-8 max-w-6xl mx-auto relative">
        <button onClick={() => setScreen('f2')} className="mb-4 flex items-center gap-2 text-sm text-gray-400 hover:text-gray-700 transition-colors"><ArrowLeft size={18} /> Quay lại</button>
        
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">🎬 Hook Library</h1>
            <p className="text-gray-400 text-sm mt-1">Quản lý & phân tích các Winning Hook • {hooks.length} hook</p>
          </div>
          <button onClick={() => openEditModal()} className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl font-bold hover:shadow-lg transition-all">
            <Plus size={18} /> Thêm Hook
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
          {hooks.map(hook => (
            <div key={hook.id} className="group bg-white rounded-2xl border border-gray-200 overflow-hidden hover:shadow-xl transition-all hover:-translate-y-1 relative">
              {/* Top actions */}
              <div className="absolute top-2 right-2 z-10 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => setPreviewHook(hook)}
                  className="bg-black/50 backdrop-blur-sm p-2 rounded-lg text-white/80 hover:text-white hover:bg-black/70">
                  <Eye size={12} />
                </button>
                <button onClick={() => openEditModal(hook)}
                  className="bg-black/50 backdrop-blur-sm p-2 rounded-lg text-white/80 hover:text-white hover:bg-black/70">
                  <PenTool size={12} />
                </button>
                <button onClick={() => handleDeleteHook(hook.id)}
                  className="bg-black/50 backdrop-blur-sm p-2 rounded-lg text-white/80 hover:text-red-400 hover:bg-red-900/70 transition-colors">
                  {deletingHookId === hook.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                </button>
              </div>

              {/* Thumbnail */}
              <div className="aspect-[3/4] relative overflow-hidden">
                {hook.image_url ? (
                  <>
                    <img src={hook.image_url} alt={hook.title} className="w-full h-full object-cover" />
                    {hook.video_url && (
                      <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                        <div className="w-12 h-12 bg-white/25 backdrop-blur-sm rounded-full flex items-center justify-center">
                          <Play className="text-white ml-0.5" size={20} fill="currentColor" />
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-indigo-100 via-purple-50 to-pink-100 flex flex-col items-center justify-center">
                    <span className="text-5xl mb-3 drop-shadow-sm">{hook.thumb || '🎬'}</span>
                    <div className="w-10 h-10 bg-indigo-500/20 rounded-full flex items-center justify-center">
                      <Play className="text-indigo-500 ml-0.5" size={16} fill="currentColor" />
                    </div>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="p-3.5">
                <h4 className="font-bold text-sm text-gray-800 mb-0.5 truncate">{hook.title}</h4>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-3">{hook.subtitle}</p>
                
                {hook.hook_concept && (
                  <p className="text-[11px] text-gray-500 mb-3 line-clamp-2 leading-relaxed">{hook.hook_concept}</p>
                )}
                
                <div className="flex gap-2">
                  <button onClick={() => { setSelectedHook(hook); setScreen('f2.2.1'); }}
                    className="flex-1 text-xs py-2.5 flex items-center justify-center gap-1.5 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl hover:shadow-md font-bold transition-all">
                    <Sparkles size={12} /> Modify
                  </button>
                  <button onClick={() => { setSelectedHook(hook); setFullIdeas([]); setScreen('f2.2.2'); }}
                    className="flex-1 text-xs py-2.5 flex items-center justify-center gap-1.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl hover:shadow-md font-bold transition-all">
                    <Brain size={12} /> Full Ideas
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Preview Modal */}
        {previewHook && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setPreviewHook(null)}>
            <div className="bg-white rounded-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{previewHook.thumb || '🎬'}</span>
                    <div>
                      <h2 className="text-lg font-bold text-gray-800">{previewHook.title}</h2>
                      <p className="text-xs text-gray-400 uppercase font-semibold">{previewHook.subtitle}</p>
                    </div>
                  </div>
                  <button onClick={() => setPreviewHook(null)} className="p-2 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
                </div>

                {(previewHook.image_url || previewHook.video_url) && (
                  <div className="rounded-xl overflow-hidden bg-gray-100 mb-4">
                    {previewHook.video_url ? (
                      <video src={previewHook.video_url} controls className="w-full max-h-80 object-contain" />
                    ) : (
                      <img src={previewHook.image_url!} alt={previewHook.title} className="w-full max-h-80 object-contain" />
                    )}
                  </div>
                )}

                {previewHook.description && (
                  <div className="mb-4">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">Mô tả</label>
                    <p className="text-sm text-gray-700 mt-1">{previewHook.description}</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  {previewHook.hook_concept && (
                    <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100">
                      <label className="text-[10px] font-bold text-indigo-500 uppercase">Hook Concept</label>
                      <p className="text-sm text-gray-700 mt-1">{previewHook.hook_concept}</p>
                    </div>
                  )}
                  {previewHook.visual_detail && (
                    <div className="bg-purple-50 rounded-xl p-4 border border-purple-100">
                      <label className="text-[10px] font-bold text-purple-500 uppercase">Visual Detail</label>
                      <p className="text-sm text-gray-700 mt-1">{previewHook.visual_detail}</p>
                    </div>
                  )}
                </div>

                <button onClick={() => { setPreviewHook(null); setSelectedHook(previewHook); setScreen('f2.2.1'); }}
                  className="w-full mt-5 py-3 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:shadow-lg transition-all">
                  <Sparkles size={16} /> Tạo biến thể với AI
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit / Create Modal */}
        {isEditModalOpen && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setIsEditModalOpen(false)}>
            <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100">
                <h2 className="text-lg font-bold text-gray-800">{editingHookData.id ? '✏️ Chỉnh sửa Hook' : '✨ Thêm Hook Mới'}</h2>
                <button onClick={() => setIsEditModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
              </div>

              <div className="p-6 space-y-5">
                {/* Upload & Analyze Section */}
                <div className={`rounded-xl p-5 border-2 border-dashed transition-colors ${analysisSuccess ? 'bg-emerald-50 border-emerald-200' : 'bg-indigo-50 border-indigo-200'}`}>
                  <div className="flex justify-between items-center mb-3">
                    <label className={`text-xs font-bold uppercase flex items-center gap-2 ${analysisSuccess ? 'text-emerald-600' : 'text-indigo-600'}`}>
                      {analysisSuccess ? <><Check size={14} /> Đã phân tích!</> : <><Upload size={14} /> Import & Phân Tích (AI)</>}
                    </label>
                    {analysisSuccess && (
                      <button onClick={() => fileInputRef.current?.click()} className="text-xs text-indigo-500 underline hover:text-indigo-700">Tải lại</button>
                    )}
                  </div>

                  <input ref={fileInputRef} type="file" accept="video/*,image/*" onChange={handleFileUpload} className="hidden" disabled={isAnalyzing} />

                  {!analysisSuccess && (
                    <button onClick={() => fileInputRef.current?.click()} disabled={isAnalyzing}
                      className={`flex items-center justify-center gap-3 w-full py-4 px-4 rounded-xl border border-indigo-200 text-indigo-600 font-medium bg-white hover:bg-indigo-50 transition-colors ${isAnalyzing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                      {isAnalyzing ? <Loader2 className="animate-spin" size={20} /> : <Upload size={20} />}
                      <div className="text-left">
                        <p className="font-bold">{isAnalyzing ? 'Đang phân tích...' : 'Tải Video / Ảnh Hook'}</p>
                        <p className="text-[11px] text-gray-400 font-normal">AI sẽ tự động phân tích concept, visual, strategy</p>
                      </div>
                    </button>
                  )}

                  {/* Media Preview */}
                  {(editingHookData.localVideoUrl || editingHookData.localImageUrl) && (
                    <div className="mt-3 rounded-xl overflow-hidden bg-gray-900 flex items-center justify-center max-h-48 border border-gray-200">
                      {editingHookData.localVideoUrl ? (
                        <video src={editingHookData.localVideoUrl} controls className="h-full w-auto max-w-full max-h-48" />
                      ) : editingHookData.localImageUrl ? (
                        <img src={editingHookData.localImageUrl} alt="Preview" className="h-full w-auto max-w-full object-contain max-h-48" />
                      ) : null}
                    </div>
                  )}
                </div>

                {/* Title */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Nhãn Hook *</label>
                  <input type="text" value={editingHookData.title || ''} onChange={e => setEditingHookData({ ...editingHookData, title: e.target.value })}
                    placeholder="VD: Pop-up Hết dung lượng, Unboxing iPhone..."
                    className="w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200 border-gray-200 text-gray-800 font-medium" />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Mô tả</label>
                  <textarea value={editingHookData.description || ''} onChange={e => setEditingHookData({ ...editingHookData, description: e.target.value })}
                    placeholder="Mô tả ngắn gọn hook này..."
                    className="w-full h-20 resize-none px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200 border-gray-200" />
                </div>

                {/* Advanced Details */}
                <div className="bg-gray-50 rounded-xl p-5 border border-gray-200 space-y-4">
                  <h4 className="font-bold text-gray-700 flex items-center gap-2"><PenTool size={14} className="text-indigo-500" /> Chi tiết nâng cao</h4>
                  
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Hook Concept</label>
                    <textarea value={editingHookData.hook_concept || ''} onChange={e => setEditingHookData({ ...editingHookData, hook_concept: e.target.value })}
                      placeholder="VD: Ngắt quãng thói quen lướt, Tạo cảm giác cấp bách..."
                      className="w-full h-20 resize-none px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200 border-gray-200" />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Chi tiết Visual</label>
                    <textarea value={editingHookData.visual_detail || ''} onChange={e => setEditingHookData({ ...editingHookData, visual_detail: e.target.value })}
                      placeholder="VD: Cận cảnh tay cầm điện thoại, màn hình hiện cảnh báo đỏ..."
                      className="w-full h-20 resize-none px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200 border-gray-200" />
                  </div>
                </div>

                {/* Framework Analysis */}
                <div className="bg-amber-50 rounded-xl p-5 border border-amber-200 space-y-4">
                  <h4 className="font-bold text-amber-700 flex items-center gap-2"><Target size={14} className="text-amber-500" /> Framework Analysis</h4>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">👤 Core User</label>
                      <input type="text" value={editingHookData.core_user || ''} onChange={e => setEditingHookData({ ...editingHookData, core_user: e.target.value })}
                        placeholder="VD: Người già 45+, EN, lowtech"
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200 border-gray-200 text-sm" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">💔 Painpoint</label>
                      <input type="text" value={editingHookData.painpoint || ''} onChange={e => setEditingHookData({ ...editingHookData, painpoint: e.target.value })}
                        placeholder="VD: Điện thoại đầy bộ nhớ"
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200 border-gray-200 text-sm" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">😱 Emotion</label>
                      <input type="text" value={editingHookData.emotion || ''} onChange={e => setEditingHookData({ ...editingHookData, emotion: e.target.value })}
                        placeholder="VD: Sợ hãi + Lo lắng"
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200 border-gray-200 text-sm" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">🎬 Creative Type</label>
                      <input type="text" value={editingHookData.creative_type || ''} onChange={e => setEditingHookData({ ...editingHookData, creative_type: e.target.value })}
                        placeholder="VD: UGC Expert Apple, Hỏi Alexa"
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200 border-gray-200 text-sm" />
                    </div>
                  </div>
                </div>

                {/* Emoji Thumb Picker */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Icon</label>
                  <div className="flex gap-2 flex-wrap">
                    {['🛑', '😫', '📱', '👀', '👴', '📦', '✅', '📰', '🔥', '💡', '🎯', '✨', '❤️', '⚡', '🧹', '🎬'].map(emoji => (
                      <button key={emoji} onClick={() => setEditingHookData({ ...editingHookData, thumb: emoji })}
                        className={`w-10 h-10 rounded-xl text-xl flex items-center justify-center transition-all ${editingHookData.thumb === emoji ? 'bg-indigo-100 border-2 border-indigo-400 scale-110' : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'}`}>
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                  <button onClick={() => setIsEditModalOpen(false)} className="px-5 py-2.5 text-gray-500 hover:bg-gray-100 rounded-xl transition-colors">Hủy</button>
                  <button onClick={handleSaveHook} disabled={isAnalyzing || isSaving || !editingHookData.title}
                    className="px-6 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl hover:shadow-lg font-bold disabled:opacity-50 flex items-center gap-2 transition-all">
                    {(isAnalyzing || isSaving) && <Loader2 className="animate-spin" size={14} />}
                    {isSaving ? 'Đang lưu...' : isAnalyzing ? 'Đang phân tích...' : '✓ Lưu Hook'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // === Hook-to-Full-Ideas View (f2.2.2) ===
  if (currentScreen === 'f2.2.2' && selectedHook) {
    const handleGenerateFullIdeas = async () => {
      setFullIdeasLoading(true);
      setFullIdeas([]);
      const controller = new AbortController();
      abortRef.current = controller;
      startProgress();
      try {
        const res = await fetch('/api/generate-ideas-from-hook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hook: selectedHook,
            quantity: fullIdeasQty,
            duration: fullIdeasDuration,
            ideaDirection: ideaDirection || null,
            appName: app?.name || '',
            appCategory: app?.category || '',
            selectedModel: selectedModel || 'gemini-2.5-pro',
          }),
          signal: controller.signal,
        });
        const result = await res.json();
        if (res.ok && result.success && result.data?.length > 0) {
          setFullIdeas(result.data);
        } else {
          alert(result.error || 'Có lỗi khi tạo ideas.');
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== 'AbortError') {
          alert('Có lỗi khi tạo ideas. Vui lòng thử lại.');
        }
      } finally {
        stopProgress();
        setFullIdeasLoading(false);
      }
    };

    return (
      <div className="p-6 sm:p-8 max-w-[95%] mx-auto">
        <button onClick={() => setScreen('f2.2')} className="mb-6 flex items-center gap-2 text-sm text-gray-400 hover:text-gray-700 transition-colors"><ArrowLeft size={18} /> Quay lại Thư Viện</button>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Panel */}
          <div className="lg:col-span-4 space-y-5">
            {/* Hook Card */}
            <div className="bg-white rounded-2xl overflow-hidden border-2 border-amber-200 shadow-sm">
              {selectedHook.image_url ? (
                <div className="h-48 bg-gray-100">
                  <img src={selectedHook.image_url} alt={selectedHook.title} className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="h-32 bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center">
                  <span className="text-5xl">{selectedHook.thumb || '🎬'}</span>
                </div>
              )}
              <div className="p-5">
                <span className="text-[10px] font-bold text-amber-600 uppercase tracking-widest">🏆 Winning Hook — Framework Analysis</span>
                <h2 className="text-xl font-bold text-gray-800 mt-1">"{selectedHook.title}"</h2>
                {selectedHook.hook_concept && (
                  <p className="text-sm text-gray-500 mt-2 italic border-l-2 border-amber-200 pl-3">{selectedHook.hook_concept}</p>
                )}
              </div>
            </div>

            {/* Framework Analysis Display */}
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl p-5 border border-amber-200 space-y-3">
              <h3 className="font-bold text-amber-700 flex items-center gap-2 text-sm"><Target size={14} className="text-amber-500" /> Framework Analysis</h3>
              <div className="space-y-2">
                {selectedHook.core_user && (
                  <div className="bg-white/70 rounded-xl px-4 py-2.5 border border-amber-100">
                    <span className="text-[10px] font-bold text-indigo-500 uppercase">👤 Core User</span>
                    <p className="text-sm text-gray-700 mt-0.5">{selectedHook.core_user}</p>
                  </div>
                )}
                {selectedHook.painpoint && (
                  <div className="bg-white/70 rounded-xl px-4 py-2.5 border border-amber-100">
                    <span className="text-[10px] font-bold text-red-500 uppercase">💔 Painpoint</span>
                    <p className="text-sm text-gray-700 mt-0.5">{selectedHook.painpoint}</p>
                  </div>
                )}
                {selectedHook.emotion && (
                  <div className="bg-white/70 rounded-xl px-4 py-2.5 border border-amber-100">
                    <span className="text-[10px] font-bold text-orange-500 uppercase">😱 Emotion</span>
                    <p className="text-sm text-gray-700 mt-0.5">{selectedHook.emotion}</p>
                  </div>
                )}
                {selectedHook.creative_type && (
                  <div className="bg-white/70 rounded-xl px-4 py-2.5 border border-amber-100">
                    <span className="text-[10px] font-bold text-emerald-500 uppercase">🎬 Creative Type</span>
                    <p className="text-sm text-gray-700 mt-0.5">{selectedHook.creative_type}</p>
                  </div>
                )}
                {selectedHook.visual_detail && (
                  <div className="bg-white/70 rounded-xl px-4 py-2.5 border border-amber-100">
                    <span className="text-[10px] font-bold text-purple-500 uppercase">👁️ Visual</span>
                    <p className="text-sm text-gray-700 mt-0.5">{selectedHook.visual_detail}</p>
                  </div>
                )}
                {!selectedHook.core_user && !selectedHook.painpoint && !selectedHook.emotion && (
                  <p className="text-sm text-amber-600 italic">Chưa có framework data. Chỉnh sửa hook để thêm phân tích.</p>
                )}
              </div>
            </div>

            {/* Generate Controls */}
            <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm space-y-4">
              <h3 className="font-bold text-gray-700 flex items-center gap-2 text-sm"><Brain size={14} className="text-amber-500" /> Tạo Full Ideas từ Hook này</h3>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 flex items-center gap-1"><Clock size={10} /> Duration</label>
                  <div className="flex gap-1">
                    {['15s', '30s', '60s'].map(d => (
                      <button key={d} onClick={() => setFullIdeasDuration(d)}
                        className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${fullIdeasDuration === d ? 'bg-amber-500 text-white' : 'bg-gray-50 text-gray-400 border border-gray-200 hover:bg-gray-100'}`}>
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 flex items-center gap-1"><ListOrdered size={10} /> Số lượng</label>
                  <div className="flex gap-1">
                    {[1, 3, 5].map(n => (
                      <button key={n} onClick={() => setFullIdeasQty(n)}
                        className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${fullIdeasQty === n ? 'bg-amber-500 text-white' : 'bg-gray-50 text-gray-400 border border-gray-200 hover:bg-gray-100'}`}>
                        {n}
                      </button>
                    ))}
                    <input type="number" min={1} max={10} value={fullIdeasQty}
                      onChange={e => setFullIdeasQty(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                      className="w-12 py-2 rounded-lg text-xs font-bold text-center border border-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-200" />
                  </div>
                </div>
              </div>

              {/* Direction textarea */}
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 flex items-center gap-1"><PenTool size={10} /> Mô tả hướng đi (tùy chọn)</label>
                <textarea value={ideaDirection} onChange={e => setIdeaDirection(e.target.value)}
                  className="w-full h-24 resize-none px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-200 border-gray-200 text-sm"
                  placeholder={`VD: Nhắm target phụ nữ 30-40, kết hợp nỗi sợ mất dữ liệu, phong cách UGC reaction...`} />
              </div>

              <button onClick={handleGenerateFullIdeas} disabled={fullIdeasLoading}
                className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl hover:shadow-lg font-bold disabled:opacity-50 transition-all text-sm">
                {fullIdeasLoading ? <RefreshCw className="animate-spin" size={18} /> : <Brain size={18} />}
                {fullIdeasLoading ? 'Đang tạo Ideas...' : '🚀 Tạo Full Ideas'}
              </button>

              {fullIdeasLoading && progress > 0 && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-amber-600 font-medium flex items-center gap-2">
                      <Loader2 className="animate-spin" size={14} /> {progressLabel}
                    </span>
                    <span className="font-bold text-amber-700">{progress}%</span>
                  </div>
                  <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-amber-500 via-orange-400 to-red-400 rounded-full transition-all duration-500 ease-out"
                      style={{ width: `${progress}%` }} />
                  </div>
                  <button onClick={handleCancel}
                    className="w-full py-2 rounded-xl font-semibold text-sm border-2 border-red-200 text-red-500 bg-red-50 hover:bg-red-100 transition-all flex items-center justify-center gap-2">
                    <X size={16} /> Hủy
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right: Full Ideas Results */}
          <div className="lg:col-span-8">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Wand2 className="text-amber-500" size={20} /> Full Ideas ({fullIdeas.length})</h3>
            </div>

            {fullIdeas.length > 0 ? (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {fullIdeas.map((idea: any, idx: number) => (
                  <div key={idx} className="bg-white rounded-2xl border border-gray-200 overflow-hidden hover:shadow-lg transition-all">
                    <div className="h-1 bg-gradient-to-r from-amber-500 to-orange-500 w-full" />
                    <div className="p-6">
                      {/* Title + meta */}
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-bold text-lg text-gray-800 mb-1">{idea.title || `Ý tưởng ${idx + 1}`}</h4>
                          <div className="flex gap-2 flex-wrap">
                            <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded">{idea.duration}</span>
                            <span className="text-xs px-2 py-0.5 bg-amber-50 text-amber-600 rounded font-medium">{idea.creativeType || 'Creative'}</span>
                          </div>
                        </div>
                        <button onClick={() => {
                          const text = `IDEA: ${idea.title}\n\nFRAMEWORK:\n- Core User: ${idea.framework?.coreUser}\n- Painpoint: ${idea.framework?.painpoint}\n- Emotion: ${idea.framework?.emotion}\n- PSP: ${idea.framework?.psp}\n\nHOOK:\n${idea.hook?.script}\n\nBODY:\n${idea.body?.script}\n\nCTA:\n${idea.cta?.script}`;
                          navigator.clipboard.writeText(text);
                        }} className="p-2 text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition-colors" title="Copy"><Copy size={16} /></button>
                      </div>

                      {/* Explanation */}
                      <p className="text-gray-400 italic text-sm mb-4 border-l-2 border-amber-200 pl-3">{idea.explanation}</p>

                      {/* Sections: HOOK, BODY, CTA — same structure as FilterGenerator */}
                      {[{ key: 'hook', label: '🎣 HOOK (3-5s)', bg: 'bg-red-50', border: 'border-red-100', title: 'text-red-500' },
                        { key: 'body', label: '📖 BODY (10-25s)', bg: 'bg-sky-50', border: 'border-sky-100', title: 'text-sky-600' },
                        { key: 'cta', label: '🔥 CTA (3-5s)', bg: 'bg-emerald-50', border: 'border-emerald-100', title: 'text-emerald-600' },
                      ].map(sec => {
                        const secData = idea?.[sec.key] || {};
                        const scriptContent = secData?.script || '';
                        const textOverlay = secData?.textOverlay || '';
                        const viTranslation = secData?.viTranslation || '';
                        const endCard = sec.key === 'cta' ? (secData?.endCard || '') : '';
                        return (
                          <div key={sec.key} className={`mb-4 ${sec.bg} rounded-xl p-4 border ${sec.border}`}>
                            <span className={`text-[10px] font-bold ${sec.title} uppercase tracking-widest flex items-center gap-1 mb-3`}>{sec.label}</span>

                            {/* Script */}
                            <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed mb-3">{scriptContent || '—'}</p>

                            {/* Vietnamese Translation */}
                            {viTranslation && (
                              <div className="mb-3 bg-white/60 rounded-lg px-3 py-2 border border-gray-200">
                                <span className="text-[10px] font-bold text-violet-500 uppercase">🇻🇳 Bản dịch Tiếng Việt</span>
                                <p className="text-sm text-gray-600 italic mt-0.5 whitespace-pre-line">{viTranslation}</p>
                              </div>
                            )}

                            {/* Hook Analysis — only for hook section */}
                            {sec.key === 'hook' && (secData?.viewerProfile || secData?.viewerEmotion || secData?.painpointImpact) && (
                              <div className="mb-3 space-y-2">
                                {secData?.viewerProfile && (
                                  <div className="bg-purple-50 rounded-lg px-3 py-2 border border-purple-200">
                                    <span className="text-[10px] font-bold text-purple-500 uppercase">👁️ Ai đang xem?</span>
                                    <p className="text-xs text-gray-700 mt-0.5">{secData.viewerProfile}</p>
                                  </div>
                                )}
                                {secData?.viewerEmotion && (
                                  <div className="bg-orange-50 rounded-lg px-3 py-2 border border-orange-200">
                                    <span className="text-[10px] font-bold text-orange-500 uppercase">😱 Người xem cảm nhận gì?</span>
                                    <p className="text-xs text-gray-700 mt-0.5">{secData.viewerEmotion}</p>
                                  </div>
                                )}
                                {secData?.painpointImpact && (
                                  <div className="bg-rose-50 rounded-lg px-3 py-2 border border-rose-200">
                                    <span className="text-[10px] font-bold text-rose-500 uppercase">💔 Painpoint đánh vào tâm lý</span>
                                    <p className="text-xs text-gray-700 mt-0.5">{secData.painpointImpact}</p>
                                  </div>
                                )}
                                {secData?.whyTheyStopScrolling && (
                                  <div className="bg-indigo-50 rounded-lg px-3 py-2 border border-indigo-200">
                                    <span className="text-[10px] font-bold text-indigo-500 uppercase">🛑 Dừng scroll vì?</span>
                                    <p className="text-xs text-gray-700 font-semibold mt-0.5">{secData.whyTheyStopScrolling}</p>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Text Overlay + End Card */}
                            <div className="flex gap-3">
                              <div className="flex-1">
                                <span className="text-[10px] font-bold text-amber-600 uppercase">📝 Text Overlay</span>
                                <p className="text-sm text-gray-800 font-bold mt-0.5">{textOverlay || '—'}</p>
                              </div>
                              {sec.key === 'cta' && (
                                <div className="flex-1">
                                  <span className="text-[10px] font-bold text-emerald-600 uppercase">🏷️ End Card</span>
                                  <p className="text-sm text-gray-700 mt-0.5">{endCard || '—'}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200 p-20 text-center">
                <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl flex items-center justify-center">
                  <Brain size={36} className="text-amber-300" />
                </div>
                <p className="font-bold text-gray-500 mb-1">Tạo Full Ideas từ Winning Hook</p>
                <p className="text-sm text-gray-400 max-w-md mx-auto">AI sẽ dùng framework đã phân tích sẵn từ hook để tạo full production briefs (Hook + Body + CTA) mới.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // === Modify View (f2.2.1) ===
  return (
    <div className="p-6 sm:p-8 max-w-[95%] mx-auto">
      <button onClick={() => setScreen('f2.2')} className="mb-6 flex items-center gap-2 text-sm text-gray-400 hover:text-gray-700 transition-colors"><ArrowLeft size={18} /> Quay lại Thư Viện</button>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: Hook Info + Input */}
        <div className="lg:col-span-4 space-y-5">
          {/* Selected Hook Card */}
          <div className="bg-white rounded-2xl overflow-hidden border-2 border-indigo-200 shadow-sm">
            {selectedHook?.image_url ? (
              <div className="h-48 bg-gray-100">
                <img src={selectedHook.image_url} alt={selectedHook.title} className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="h-32 bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center">
                <span className="text-5xl">{selectedHook?.thumb || '🎬'}</span>
              </div>
            )}
            <div className="p-5">
              <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest">Hook Gốc (Winning)</span>
              <h2 className="text-xl font-bold text-gray-800 mt-1">"{selectedHook?.title}"</h2>
              {selectedHook?.hook_concept && (
                <div className="mt-3 pt-3 border-t border-gray-100 space-y-2 text-sm">
                  <p className="text-gray-500"><span className="font-bold text-gray-700">Concept:</span> {selectedHook.hook_concept}</p>
                  {selectedHook.visual_detail && <p className="text-gray-500"><span className="font-bold text-gray-700">Visual:</span> {selectedHook.visual_detail}</p>}
                </div>
              )}
              {selectedHook?.description && (
                <p className="text-sm text-gray-500 mt-3 italic border-l-2 border-indigo-200 pl-3">{selectedHook.description}</p>
              )}
            </div>
          </div>

          {/* Generate Controls */}
          <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
            <div className="mb-4">
              <label className="block text-xs font-bold text-gray-400 uppercase mb-2 flex items-center gap-2"><ListOrdered size={12} /> Số lượng biến thể</label>
              <div className="flex gap-2">
                {[1, 3, 5].map(n => (
                  <button key={n} onClick={() => setQuantity(n)}
                    className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${quantity === n ? 'bg-indigo-500 text-white' : 'bg-gray-50 text-gray-400 border border-gray-200 hover:bg-gray-100'}`}>
                    {n}
                  </button>
                ))}
                <input type="number" min={1} max={20} value={quantity}
                  onChange={e => setQuantity(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                  className="w-16 py-2 rounded-xl text-sm font-bold text-center border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
              </div>
            </div>
            <label className="block font-semibold text-gray-700 mb-2 text-sm">Ý tưởng / Bối cảnh mới</label>
            <textarea value={modifyPrompt} onChange={e => setModifyPrompt(e.target.value)}
              className="w-full h-32 resize-none px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200 border-gray-200"
              placeholder={`VD: Kết hợp hook "${selectedHook?.title}" với:\n- Nỗi sợ đột quỵ lúc ngủ\n- Target phụ nữ 30-40 tuổi\n- Phong cách UGC`} />

            {/* Smart Suggestions — auto-generated from hook analysis */}
            {selectedHook && (() => {
              const suggestions: { emoji: string; label: string; prompt: string; color: string }[] = [];
              // From hook framework data
              if (selectedHook.core_user) {
                suggestions.push({ emoji: '👤', label: `Target: ${selectedHook.core_user}`, prompt: `Target ${selectedHook.core_user}`, color: '#6366f1' });
                // Suggest a different target
                const altTargets = ['Phụ nữ 25-35, Social Media', 'Nam 18-25, Gamer', 'Người già 55+, lowtech', 'Gen Z, Lifestyle'];
                const current = selectedHook.core_user.toLowerCase();
                const alt = altTargets.find(t => !current.includes(t.split(',')[0].toLowerCase()));
                if (alt) suggestions.push({ emoji: '🔄', label: `Đổi target: ${alt}`, prompt: `Đổi target sang ${alt}`, color: '#8b5cf6' });
              }
              if (selectedHook.painpoint) {
                suggestions.push({ emoji: '💔', label: selectedHook.painpoint, prompt: `Nỗi đau: ${selectedHook.painpoint}`, color: '#ef4444' });
                // Suggest related painpoints
                suggestions.push({ emoji: '😰', label: 'Kết hợp nỗi sợ mất dữ liệu', prompt: 'Kết hợp thêm nỗi sợ mất dữ liệu quan trọng', color: '#f97316' });
              }
              if (selectedHook.emotion) {
                suggestions.push({ emoji: '😱', label: `Cảm xúc: ${selectedHook.emotion}`, prompt: `Cảm xúc chủ đạo: ${selectedHook.emotion}`, color: '#eab308' });
              }
              if (selectedHook.creative_type) {
                suggestions.push({ emoji: '🎬', label: selectedHook.creative_type, prompt: `Phong cách: ${selectedHook.creative_type}`, color: '#10b981' });
              }
              // Generic smart suggestions
              suggestions.push(
                { emoji: '📱', label: 'Phong cách UGC', prompt: 'Phong cách UGC (Người thật quay)', color: '#06b6d4' },
                { emoji: '🔥', label: 'Hook viral TikTok', prompt: 'Twist hook theo trend viral TikTok hiện tại', color: '#f43f5e' },
                { emoji: '⚡', label: 'Tăng urgency', prompt: 'Tăng cảm giác cấp bách, FOMO, phải hành động ngay', color: '#f59e0b' },
                { emoji: '🎯', label: 'A/B Test angle', prompt: 'Tạo biến thể A/B test với góc tiếp cận hoàn toàn khác', color: '#8b5cf6' },
              );

              return (
                <div className="mt-3 mb-1">
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-2 flex items-center gap-1.5">
                    <Sparkles size={10} className="text-amber-500" /> Gợi ý nhanh từ phân tích
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestions.map((s, i) => (
                      <button key={i}
                        onClick={() => setModifyPrompt(prev => prev ? `${prev}\n- ${s.prompt}` : `Kết hợp hook "${selectedHook.title}" với:\n- ${s.prompt}`)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-all hover:scale-105 hover:shadow-sm"
                        style={{
                          borderColor: `${s.color}30`,
                          background: `${s.color}08`,
                          color: s.color,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = `${s.color}15`; e.currentTarget.style.borderColor = `${s.color}50`; }}
                        onMouseLeave={e => { e.currentTarget.style.background = `${s.color}08`; e.currentTarget.style.borderColor = `${s.color}30`; }}
                      >
                        <span>{s.emoji}</span> {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            <button onClick={handleGenerate} disabled={isLoading || !modifyPrompt}
              className="w-full mt-3 flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-pink-500 to-orange-500 text-white rounded-xl hover:shadow-lg font-bold disabled:opacity-50 transition-all text-sm">
              {isLoading ? <RefreshCw className="animate-spin" size={18} /> : <Sparkles size={18} />}
              {isLoading ? 'Đang Sáng Tạo...' : '🚀 Tạo Hook Biến Thể'}
            </button>

            {/* Progress bar */}
            {isLoading && progress > 0 && (
              <div className="mt-4 space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-pink-600 font-medium flex items-center gap-2">
                    <Loader2 className="animate-spin" size={14} /> {progressLabel}
                  </span>
                  <span className="font-bold text-pink-700">{progress}%</span>
                </div>
                <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-pink-500 via-orange-400 to-amber-400 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${progress}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-gray-400">
                  <span>Phân tích</span>
                  <span>Biến thể</span>
                  <span>Visual & Voice</span>
                  <span>Hoàn thiện</span>
                </div>
                <button onClick={handleCancel}
                  className="w-full mt-2 py-2.5 rounded-xl font-semibold text-sm border-2 border-red-200 text-red-500 bg-red-50 hover:bg-red-100 hover:border-red-300 transition-all flex items-center justify-center gap-2">
                  <X size={16} /> Hủy Tạo
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right: Results */}
        <div className="lg:col-span-8 bg-white rounded-2xl p-6 border border-gray-200 min-h-[500px] overflow-y-auto shadow-sm">
          <div className="flex justify-between items-center mb-5">
            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Wand2 className="text-indigo-500" size={20} /> Kết Quả ({generatedIdeas.length})</h3>
          </div>

          {generatedIdeas.length > 0 ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {generatedIdeas.map((idea, idx) => (
                <div key={idx} className="bg-white rounded-2xl border border-gray-200 overflow-hidden hover:shadow-lg transition-all group">
                  <div className="h-1 bg-gradient-to-r from-pink-500 to-orange-500" />
                  <div className="p-5">
                    <div className="flex justify-between items-start mb-3 pb-3 border-b border-gray-100">
                      <div>
                        <h4 className="font-bold text-sm text-gray-800">{idea.title || `Biến thể ${idx + 1}`}</h4>
                        <p className="text-[11px] text-gray-400 mt-1 italic">{idea.explanation}</p>
                      </div>
                      <button onClick={() => handleCopy(idea)} className="p-2 text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition-colors"><Copy size={14} /></button>
                    </div>

                    {/* Script Block — unified storyboard */}
                    <div className="bg-red-50 rounded-xl p-4 border border-red-100">
                      <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest flex items-center gap-1 mb-2"><Target size={10} /> 🎬 KỊCH BẢN HOOK</span>
                      <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{idea.hook.script || idea.hook.visual}</p>
                    </div>

                    {/* Vietnamese Translation */}
                    {(idea.hook as any)?.viTranslation && (
                      <div className="mt-3 bg-white/60 rounded-lg px-4 py-2.5 border border-gray-200">
                        <span className="text-[10px] font-bold text-violet-500 uppercase">🇻🇳 Bản dịch Tiếng Việt</span>
                        <p className="text-sm text-gray-600 italic mt-0.5 whitespace-pre-line">{(idea.hook as any).viTranslation}</p>
                      </div>
                    )}

                    {/* Text Overlay — single */}
                    {(idea.hook.textOverlay || idea.hook.text) && (
                      <div className="mt-3 bg-amber-50 rounded-lg px-4 py-2.5 border border-amber-200">
                        <span className="text-[10px] font-bold text-amber-600 uppercase">📝 Text Overlay</span>
                        <p className="text-sm text-gray-800 font-bold mt-0.5">{idea.hook.textOverlay || idea.hook.text}</p>
                      </div>
                    )}

                    {/* Hook Analysis */}
                    {((idea.hook as any)?.viewerEmotion || (idea.hook as any)?.painpointImpact) && (
                      <div className="mt-3 space-y-2">
                        {(idea.hook as any)?.viewerEmotion && (
                          <div className="bg-orange-50 rounded-lg px-3 py-2 border border-orange-200">
                            <span className="text-[10px] font-bold text-orange-500 uppercase">😱 Người xem cảm nhận gì?</span>
                            <p className="text-xs text-gray-700 mt-0.5">{(idea.hook as any).viewerEmotion}</p>
                          </div>
                        )}
                        {(idea.hook as any)?.painpointImpact && (
                          <div className="bg-rose-50 rounded-lg px-3 py-2 border border-rose-200">
                            <span className="text-[10px] font-bold text-rose-500 uppercase">💔 Painpoint đánh vào tâm lý</span>
                            <p className="text-xs text-gray-700 mt-0.5">{(idea.hook as any).painpointImpact}</p>
                          </div>
                        )}
                        {(idea.hook as any)?.whyTheyStopScrolling && (
                          <div className="bg-indigo-50 rounded-lg px-3 py-2 border border-indigo-200">
                            <span className="text-[10px] font-bold text-indigo-500 uppercase">🛑 Dừng scroll vì?</span>
                            <p className="text-xs text-gray-700 font-semibold mt-0.5">{(idea.hook as any).whyTheyStopScrolling}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-20">
              <div className="w-16 h-16 mx-auto mb-4 bg-gray-50 rounded-2xl flex items-center justify-center">
                <Wand2 size={32} className="text-gray-300" />
              </div>
              <p className="font-bold text-gray-500 mb-1">Nhập ý tưởng và bấm tạo</p>
              <p className="text-sm text-gray-400">Các biến thể Hook mới sẽ hiển thị tại đây</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
