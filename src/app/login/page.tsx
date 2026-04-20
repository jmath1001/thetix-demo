'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    router.push('/');
    router.refresh();
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        background:
          'radial-gradient(1200px 600px at 10% 10%, #fef3c7 0%, transparent 40%), radial-gradient(1200px 600px at 90% 90%, #dbeafe 0%, transparent 42%), linear-gradient(160deg, #f8fafc 0%, #eef2ff 45%, #f8fafc 100%)',
        fontFamily: 'Space Grotesk, Sora, ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <div className="w-full max-w-md">
        <div className="text-center mb-7">
          <p
            className="text-[10px] font-bold uppercase tracking-[0.28em]"
            style={{ color: '#334155' }}
          >
            Secure Workspace
          </p>
          <h1
            className="mt-2 font-black leading-none"
            style={{
              fontSize: 'clamp(3rem, 10vw, 5rem)',
              letterSpacing: '-0.06em',
              color: '#0f172a',
              textShadow: '0 12px 28px rgba(15, 23, 42, 0.12)',
            }}
          >
            THETIX
          </h1>
          <p className="mt-2 text-sm font-medium" style={{ color: '#475569' }}>
            DEMO
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-3xl p-7 space-y-4"
          style={{
            background: 'rgba(255,255,255,0.82)',
            border: '1px solid rgba(148, 163, 184, 0.32)',
            boxShadow: '0 28px 70px rgba(15, 23, 42, 0.14)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div>
            <label className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: '#64748b' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
              className="mt-2 w-full px-4 py-3 rounded-2xl text-sm outline-none transition-all"
              style={{
                color: '#0f172a',
                border: '1px solid #cbd5e1',
                background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9)',
              }}
              placeholder="Enter password"
            />
          </div>
          <button type="submit" disabled={loading || !password}
            className="w-full py-3 rounded-2xl text-sm font-black text-white transition-all disabled:opacity-40 active:scale-[0.98]"
            style={{
              background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 55%, #334155 100%)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              boxShadow: '0 14px 28px rgba(15, 23, 42, 0.28)',
            }}>
            {loading ? 'Loading...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}