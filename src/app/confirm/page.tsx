'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

function ConfirmContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Invalid or missing token.');
      return;
    }

    fetch('/api/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setStatus('success');
        } else {
          setStatus('error');
          setMessage(data.error ?? 'Something went wrong.');
        }
      })
      .catch(() => {
        setStatus('error');
        setMessage('Network error. Please try again.');
      });
  }, [token]);

  return (
    <>
      {status === 'loading' && (
        <>
          <Loader2 size={36} className="animate-spin text-[#6d28d9] mx-auto mb-4" />
          <p className="text-sm font-semibold text-[#a8a29e]">Confirming your session…</p>
        </>
      )}
      {status === 'success' && (
        <>
          <CheckCircle size={48} className="text-green-500 mx-auto mb-4" />
          <h1 className="text-xl font-black text-[#1c1917] mb-2">You're confirmed!</h1>
          <p className="text-sm text-[#a8a29e]">Thanks for confirming. See you at your session!</p>
        </>
      )}
      {status === 'error' && (
        <>
          <XCircle size={48} className="text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-black text-[#1c1917] mb-2">Something went wrong</h1>
          <p className="text-sm text-[#a8a29e]">{message}</p>
        </>
      )}
    </>
  );
}

export default function ConfirmPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#f7f4ef', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <div className="w-full max-w-sm bg-white rounded-2xl border border-[#e7e3dd] shadow-lg p-8 text-center">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-black" style={{ background: '#ea2709' }}>C2</div>
          <span className="font-bold text-stone-900">Prep Center</span>
        </div>
        <Suspense fallback={
          <><Loader2 size={36} className="animate-spin text-[#6d28d9] mx-auto mb-4" /><p className="text-sm text-[#a8a29e]">Loading…</p></>
        }>
          <ConfirmContent />
        </Suspense>
      </div>
    </div>
  );
}