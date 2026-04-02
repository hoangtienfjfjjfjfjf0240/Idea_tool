'use client';
import React, { useState } from 'react';
import { KeyRound, User, Sparkles, Loader2, Mail, LogIn, UserPlus } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface LoginScreenProps {
  onLogin: (userName: string) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState('');

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    setError('');

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: password.trim(),
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    const name = data.user?.user_metadata?.display_name || email.split('@')[0];
    onLogin(name);
    setLoading(false);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim() || !displayName.trim()) return;
    setLoading(true);
    setError('');

    const { data, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password: password.trim(),
      options: {
        data: { display_name: displayName.trim() },
      },
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // If email confirmation not required, auto-login
    if (data.user && !data.user.identities?.length) {
      setError('Email đã được đăng ký. Hãy đăng nhập.');
      setIsSignUp(false);
      setLoading(false);
      return;
    }

    if (data.session) {
      onLogin(displayName.trim());
    } else {
      setError('Đăng ký thành công! Vui lòng kiểm tra email để xác nhận.');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-indigo-950 to-purple-950" />
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-purple-500/15 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      <div className="relative z-10 w-full max-w-md mx-4">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-2xl shadow-indigo-500/30 mb-4">
            <Sparkles className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-white via-indigo-200 to-purple-300 bg-clip-text text-transparent">
            IdeaGen AI
          </h1>
          <p className="text-indigo-300/60 mt-2 text-sm">
            Công cụ tạo ý tưởng sáng tạo cho Performance Marketing
          </p>
        </div>

        {/* Card */}
        <form onSubmit={isSignUp ? handleSignUp : handleSignIn} className="bg-white/5 backdrop-blur-2xl border border-white/10 rounded-3xl p-8 shadow-2xl">
          {/* Tab switcher */}
          <div className="flex mb-6 bg-white/5 rounded-xl p-1">
            <button type="button" onClick={() => { setIsSignUp(false); setError(''); }}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${!isSignUp ? 'bg-white/10 text-white shadow-sm' : 'text-white/40 hover:text-white/60'}`}>
              <LogIn className="w-4 h-4" /> Đăng Nhập
            </button>
            <button type="button" onClick={() => { setIsSignUp(true); setError(''); }}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${isSignUp ? 'bg-white/10 text-white shadow-sm' : 'text-white/40 hover:text-white/60'}`}>
              <UserPlus className="w-4 h-4" /> Đăng Ký
            </button>
          </div>

          <div className="space-y-5">
            {/* Display name (sign up only) */}
            {isSignUp && (
              <div>
                <label className="block text-sm font-medium text-indigo-200/80 mb-2">Tên hiển thị</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-indigo-400/50" />
                  <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="VD: Hoàng Tiến" autoFocus
                    className="w-full pl-11 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:border-indigo-400/50 focus:ring-2 focus:ring-indigo-400/20 focus:outline-none transition-all text-sm" />
                </div>
              </div>
            )}

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-indigo-200/80 mb-2">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-indigo-400/50" />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@email.com" autoFocus={!isSignUp}
                  className="w-full pl-11 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:border-indigo-400/50 focus:ring-2 focus:ring-indigo-400/20 focus:outline-none transition-all text-sm" />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-indigo-200/80 mb-2">Mật khẩu</label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-indigo-400/50" />
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-11 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:border-indigo-400/50 focus:ring-2 focus:ring-indigo-400/20 focus:outline-none transition-all text-sm" />
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-300 text-sm">
              {error}
            </div>
          )}

          <button type="submit"
            disabled={!email.trim() || !password.trim() || (isSignUp && !displayName.trim()) || loading}
            className="w-full mt-6 py-3.5 bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-bold rounded-xl hover:from-indigo-600 hover:to-purple-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2">
            {loading ? (
              <><Loader2 className="w-5 h-5 animate-spin" /> Đang xử lý...</>
            ) : isSignUp ? (
              <><UserPlus className="w-5 h-5" /> Đăng Ký</>
            ) : (
              <><Sparkles className="w-5 h-5" /> Đăng Nhập</>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
