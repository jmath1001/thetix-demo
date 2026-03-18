'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.push('/');
      router.refresh();
    } else {
      setError('Wrong password');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#f7f4ef', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white text-lg font-black mx-auto mb-4" style={{ background: '#ea2709' }}>C2</div>
          <h1 className="text-xl font-black text-[#1c1917]">C2 Education</h1>
          <p className="text-sm text-[#a8a29e] mt-1">Staff Portal</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-[#e7e3dd] p-6 shadow-sm space-y-4">
          <div>
            <label className="text-[9px] font-black text-[#a8a29e] uppercase tracking-widest">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
              className="mt-1 w-full px-3 py-2.5 bg-[#f7f4ef] rounded-xl text-sm text-[#1c1917] outline-none focus:ring-2 focus:ring-[#6d28d9] border border-transparent focus:border-[#6d28d9] transition-all"
              placeholder="Enter password"
            />
          </div>
          {error && <p className="text-xs text-[#dc2626] font-semibold">{error}</p>}
          <button type="submit" disabled={!password || loading}
            className="w-full py-2.5 rounded-xl text-sm font-black text-white transition-all disabled:opacity-40 active:scale-[0.98]"
            style={{ background: '#1c1917' }}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}