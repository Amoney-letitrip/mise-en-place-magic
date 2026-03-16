import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const Auth = () => {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) toast.error(error.message);
    setLoading(false);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) toast.error(error.message);
    else toast.success('Check your email to confirm your account');
    setLoading(false);
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) toast.error(error.message);
    else toast.success('Password reset email sent');
    setLoading(false);
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
            <form onSubmit={handleForgot} className="space-y-4">
              <div className="text-center mb-2">
                <h2 className="font-bold text-lg text-foreground">Reset Password</h2>
                <p className="text-xs text-muted-foreground">We'll send a reset link to your email</p>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Email</label>
                <input
                  type="email"
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
            <form onSubmit={mode === 'login' ? handleLogin : handleSignup} className="space-y-4">
              <div className="flex bg-muted rounded-lg p-0.5 mb-2">
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className={`flex-1 py-2 text-sm font-semibold rounded-md transition-colors ${mode === 'login' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
                >
                  Log in
                </button>
                <button
                  type="button"
                  onClick={() => setMode('signup')}
                  className={`flex-1 py-2 text-sm font-semibold rounded-md transition-colors ${mode === 'signup' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
                >
                  Sign up
                </button>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-3 py-2.5 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder="you@restaurant.com"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Password</label>
                <input
                  type="password"
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
