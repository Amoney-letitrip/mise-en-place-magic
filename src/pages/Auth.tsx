import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const getAuthErrorMessage = (error: unknown, fallback: string) => {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String(error.message);
    if (message.toLowerCase().includes('invalid login credentials')) {
      return 'Email or password is incorrect.';
    }
  }
  return fallback;
};

const Auth = () => {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) toast.error(getAuthErrorMessage(error, 'Could not log in. Please try again.'));
    } catch {
      toast.error('Could not log in. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) toast.error(getAuthErrorMessage(error, 'Could not create the account. Please try again.'));
      else toast.success('Check your email to confirm your account');
    } catch {
      toast.error('Could not create the account. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) toast.error('Could not send the reset email. Please try again.');
      else toast.success('If an account exists for that email, a reset link is on its way.');
    } catch {
      toast.error('Could not send the reset email. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-primary rounded-2xl flex items-center justify-center text-2xl mx-auto mb-3">🍽</div>
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Mise en Place</h1>
          <p className="text-sm text-muted-foreground mt-1">Restaurant inventory, simplified</p>
        </div>

        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          {mode === 'forgot' ? (
            <form onSubmit={handleForgot} className="space-y-4" aria-busy={loading}>
              <div className="text-center mb-2">
                <h2 className="font-bold text-lg text-foreground">Reset Password</h2>
                <p className="text-xs text-muted-foreground">We'll send a reset link to your email</p>
              </div>
              <div>
                <label htmlFor="forgot-email" className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Email</label>
                <input
                  id="forgot-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-3 py-2.5 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder="you@restaurant.com"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Sending…' : 'Send Reset Link'}
              </Button>
              <button type="button" onClick={() => setMode('login')} className="w-full text-xs text-primary hover:underline">
                Back to login
              </button>
            </form>
          ) : (
            <form onSubmit={mode === 'login' ? handleLogin : handleSignup} className="space-y-4" aria-busy={loading}>
              <div className="flex bg-muted rounded-lg p-0.5 mb-2" role="group" aria-label="Authentication mode">
                <button
                  type="button"
                  aria-pressed={mode === 'login'}
                  onClick={() => setMode('login')}
                  className={`flex-1 py-2 text-sm font-semibold rounded-md transition-colors ${mode === 'login' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
                >
                  Log in
                </button>
                <button
                  type="button"
                  aria-pressed={mode === 'signup'}
                  onClick={() => setMode('signup')}
                  className={`flex-1 py-2 text-sm font-semibold rounded-md transition-colors ${mode === 'signup' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
                >
                  Sign up
                </button>
              </div>
              <div>
                <label htmlFor="auth-email" className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Email</label>
                <input
                  id="auth-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-3 py-2.5 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder="you@restaurant.com"
                />
              </div>
              <div>
                <label htmlFor="auth-password" className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Password</label>
                <input
                  id="auth-password"
                  name="password"
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                  minLength={6}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-3 py-2.5 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder="••••••••"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
              </Button>
              {mode === 'login' && (
                <button type="button" onClick={() => setMode('forgot')} className="w-full text-xs text-primary hover:underline">
                  Forgot password?
                </button>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default Auth;
