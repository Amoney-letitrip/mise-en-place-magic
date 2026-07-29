import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

const ResetPassword = () => {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [checkingLink, setCheckingLink] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    const hasRecoveryHash = window.location.hash.includes('type=recovery');
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'PASSWORD_RECOVERY') setReady(true);
      setCheckingLink(false);
    });

    supabase.auth.getSession().then(() => {
      if (!mounted) return;
      setReady(current => current || hasRecoveryHash);
      setCheckingLink(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) toast.error('Could not update your password. Request a new reset link and try again.');
      else {
        toast.success('Password updated — redirecting…');
        setTimeout(() => navigate('/'), 1500);
      }
    } catch {
      toast.error('Could not update your password. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (checkingLink) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" role="status" aria-live="polite">
        <p className="text-muted-foreground">Checking reset link…</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-4xl mb-3">🔒</div>
          <p className="text-muted-foreground">Invalid or expired reset link</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/auth')}>Back to login</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-primary rounded-2xl flex items-center justify-center text-2xl mx-auto mb-3">🍽</div>
          <h1 className="text-xl font-extrabold text-foreground">Set New Password</h1>
        </div>
        <form onSubmit={handleReset} className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4" aria-busy={loading}>
          <div>
            <label htmlFor="new-password" className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">New Password</label>
            <input
              id="new-password"
              name="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              placeholder="••••••••"
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Updating…' : 'Update Password'}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default ResetPassword;
