import React, { useEffect, useState } from 'react';
import { ArrowLeft, Bot, Crown, Download, Eye, EyeOff, KeyRound, LifeBuoy, ShieldCheck, Volume2 } from 'lucide-react';
import heroStudioImg from '../assets/images/chord_signin_hero_1794749549402.jpg';
import type { PublicUser } from '../../shared/types.ts';
import { SnoutBrandIcon } from '../components/SnoutBrandIcon.tsx';
import { GlassInputWrapper, SignInPage } from '../components/ui/sign-in.tsx';
import { apiRequest } from '../services/api.ts';
import { useChordStore } from '../stores/useChordStore.ts';

type AuthMode = 'login' | 'register' | 'forgot' | 'reset';

interface PlatformSummary {
  memberCount: number;
  serverCount: number;
  channelCount: number;
  messageCount: number;
}

function getPasswordStrength(pw: string): { label: string; score: number; barColor: string } {
  if (!pw) return { label: '', score: 0, barColor: 'bg-white/10' };
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 1;
  if (/[0-9]/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score += 1;
  if (pw.length >= 12) score += 1;
  if (score <= 1) return { label: 'Weak', score: 1, barColor: 'bg-rose-500' };
  if (score <= 2) return { label: 'Fair', score: 2, barColor: 'bg-amber-400' };
  return { label: 'Strong', score: Math.min(4, score), barColor: 'bg-emerald-500' };
}

export const AuthPage: React.FC = () => {
  const { setAuthData, refreshAllData } = useChordStore();
  const [mode, setMode] = useState<AuthMode>('login');
  const [summary, setSummary] = useState<PlatformSummary | null>(null);
  const [pendingLogin, setPendingLogin] = useState<{
    identifier: string;
    rememberMe: boolean;
    challengeToken: string;
    username: string;
  }>({ identifier: '', rememberMe: true, challengeToken: '', username: '' });

  const [capsLockOn, setCapsLockOn] = useState(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);

  const [totpCode, setTotpCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [useBackupMode, setUseBackupMode] = useState(false);
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);

  const [forgotEmail, setForgotEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const strength = getPasswordStrength(mode === 'reset' ? newPassword : regPassword);

  useEffect(() => {
    void apiRequest<PlatformSummary>('/api/platform/summary')
      .then((res) => setSummary(res))
      .catch(() => {});
  }, []);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setRequiresTwoFactor(false);
    setTotpCode('');
    setBackupCode('');
    setUseBackupMode(false);
    setError(null);
    if (nextMode !== 'reset') {
      setNotice(null);
    }
  };

  const checkCapsLock = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === 'function') {
      setCapsLockOn(e.getModifierState('CapsLock'));
    }
  };

  const handleSignIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const identifier = String(formData.get('identifier') || '').trim();
    const password = String(formData.get('password') || '');
    const rememberMe = formData.get('rememberMe') === 'on';

    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await apiRequest<{
        requiresTwoFactor?: boolean;
        challengeToken?: string;
        username?: string;
        token?: string;
        user?: PublicUser;
        email?: string;
      }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      });

      if (res.requiresTwoFactor && res.challengeToken) {
        setPendingLogin({
          identifier,
          rememberMe,
          challengeToken: res.challengeToken,
          username: res.username || identifier,
        });
        setRequiresTwoFactor(true);
        setUseBackupMode(false);
        setTotpCode('');
        setBackupCode('');
        setLoading(false);
        return;
      }

      if (res.token && res.user) {
        setAuthData({ token: res.token, user: res.user, email: res.email, rememberMe });
        await refreshAllData();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in. Check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyTwoFactor = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await apiRequest<{
        token?: string;
        user?: PublicUser;
        email?: string;
      }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          challengeToken: pendingLogin.challengeToken,
          ...(useBackupMode ? { backupCode } : { totpCode }),
        }),
      });
      if (res.token && res.user) {
        setAuthData({
          token: res.token,
          user: res.user,
          email: res.email,
          rememberMe: pendingLogin.rememberMe,
        });
        await refreshAllData();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await apiRequest<{
        token: string;
        user: PublicUser;
        email: string;
      }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          username,
          displayName: displayName || username,
          email: regEmail,
          password: regPassword,
        }),
      });
      setAuthData({ token: res.token, user: res.user, email: res.email, rememberMe: true });
      await refreshAllData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{ resetToken?: string; message: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: forgotEmail }),
      });
      if (res.resetToken) {
        setResetToken(res.resetToken);
        setNotice(`Reset token issued and pre-filled: ${res.resetToken}`);
        setMode('reset');
      } else {
        setNotice(res.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not issue password reset token.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiRequest('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: resetToken, newPassword }),
      });
      setNotice('Password updated cleanly. Sign in with your new password.');
      setMode('login');
      setNewPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed.');
    } finally {
      setLoading(false);
    }
  };

  const getHeaderCopy = () => {
    if (requiresTwoFactor) {
      return {
        title: (
          <span className="font-display font-semibold text-foreground tracking-tight">Two-Factor Check</span>
        ),
        description: `Verifying @${pendingLogin.username}. Enter a 6-digit authenticator code or an 8-character recovery code.`,
      };
    }
    if (mode === 'register') {
      return {
        title: (
          <span className="font-display font-semibold text-foreground tracking-tight">
            Join <span className="text-violet-300">Snout</span>
          </span>
        ),
        description: 'Create your @username to access Snout servers, WebRTC voice rooms, and direct messages.',
      };
    }
    if (mode === 'forgot') {
      return {
        title: (
          <span className="font-display font-semibold text-foreground tracking-tight">Reset Password</span>
        ),
        description: 'Enter your account email to generate a one-hour password reset token.',
      };
    }
    if (mode === 'reset') {
      return {
        title: (
          <span className="font-display font-semibold text-foreground tracking-tight">Set New Password</span>
        ),
        description: 'Paste your reset token and choose a new password for your Snout account.',
      };
    }
    return {
      title: (
        <span className="font-light text-foreground tracking-tighter">
          Welcome to <span className="font-display font-semibold">Snout</span>
        </span>
      ),
      description: 'Sign in with your email or @username to access servers, direct messages, and WebRTC voice.',
    };
  };

  const renderCustomContent = () => {
    if (requiresTwoFactor) {
      return (
        <form onSubmit={handleVerifyTwoFactor} className="space-y-5">
          {!useBackupMode ? (
            <div className="space-y-1.5">
              <label htmlFor="totp-code" className="block text-sm font-medium text-muted-foreground">
                6-digit Authenticator Code
              </label>
              <GlassInputWrapper>
                <div className="relative">
                  <ShieldCheck className="pointer-events-none absolute left-4 top-4 h-5 w-5 text-emerald-400" />
                  <input
                    id="totp-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    required
                    maxLength={6}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    className="w-full bg-transparent text-base font-mono tracking-[0.35em] p-4 pl-12 rounded-2xl text-foreground placeholder-muted-foreground/60 focus:outline-none"
                  />
                </div>
              </GlassInputWrapper>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label htmlFor="backup-code" className="block text-sm font-medium text-muted-foreground">
                Single-Use Recovery Backup Code
              </label>
              <GlassInputWrapper>
                <div className="relative">
                  <LifeBuoy className="pointer-events-none absolute left-4 top-4 h-5 w-5 text-amber-400" />
                  <input
                    id="backup-code"
                    type="text"
                    autoFocus
                    required
                    maxLength={12}
                    value={backupCode}
                    onChange={(e) => setBackupCode(e.target.value.toUpperCase())}
                    placeholder="XXXX-XXXX"
                    className="w-full bg-transparent text-base font-mono tracking-[0.2em] p-4 pl-12 rounded-2xl text-foreground placeholder-muted-foreground/60 focus:outline-none"
                  />
                </div>
              </GlassInputWrapper>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-primary py-4 font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {loading ? 'Verifying...' : useBackupMode ? 'Verify Recovery Code' : 'Verify 2FA Code'}
          </button>

          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => {
                setRequiresTwoFactor(false);
                setTotpCode('');
                setBackupCode('');
                setError(null);
              }}
              className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Different account</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setUseBackupMode((b) => !b);
                setError(null);
              }}
              className="text-violet-400 hover:underline transition-colors"
            >
              {useBackupMode ? 'Use 6-digit app code' : 'Use recovery backup code'}
            </button>
          </div>
        </form>
      );
    }

    if (mode === 'register') {
      return (
        <div className="space-y-5">
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="reg-username" className="block text-sm font-medium text-muted-foreground">
                  Username
                </label>
                <GlassInputWrapper>
                  <input
                    id="reg-username"
                    type="text"
                    required
                    minLength={2}
                    maxLength={32}
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="your_handle"
                    className="w-full bg-transparent text-sm p-3.5 rounded-2xl text-foreground placeholder-muted-foreground/60 focus:outline-none"
                  />
                </GlassInputWrapper>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="reg-display" className="block text-sm font-medium text-muted-foreground">
                  Display Name
                </label>
                <GlassInputWrapper>
                  <input
                    id="reg-display"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Display Name"
                    className="w-full bg-transparent text-sm p-3.5 rounded-2xl text-foreground placeholder-muted-foreground/60 focus:outline-none"
                  />
                </GlassInputWrapper>
              </div>
            </div>

            {username && (
              <div className="font-mono text-xs text-muted-foreground">
                Handle preview: <span className="text-violet-300">@{username.trim()}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="reg-email" className="block text-sm font-medium text-muted-foreground">
                Email Address
              </label>
              <GlassInputWrapper>
                <input
                  id="reg-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="Enter your email address"
                  className="w-full bg-transparent text-sm p-3.5 rounded-2xl text-foreground placeholder-muted-foreground/60 focus:outline-none"
                />
              </GlassInputWrapper>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="reg-password" className="block text-sm font-medium text-muted-foreground">
                Password (min 8 characters)
              </label>
              <GlassInputWrapper>
                <div className="relative">
                  <input
                    id="reg-password"
                    type={showRegPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    onKeyUp={checkCapsLock}
                    onKeyDown={checkCapsLock}
                    placeholder="Create a strong password"
                    className="w-full bg-transparent text-sm p-3.5 pr-12 rounded-2xl text-foreground placeholder-muted-foreground/60 focus:outline-none"
                  />
                  <button
                    type="button"
                    aria-label={showRegPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowRegPassword((s) => !s)}
                    className="absolute inset-y-0 right-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showRegPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </GlassInputWrapper>
              {regPassword && (
                <div className="flex items-center gap-2 pt-1">
                  <div className="grid flex-1 grid-cols-4 gap-1">
                    {[1, 2, 3, 4].map((step) => (
                      <div
                        key={step}
                        className={`h-1 rounded-full transition-colors ${
                          strength.score >= step ? strength.barColor : 'bg-white/10'
                        }`}
                      />
                    ))}
                  </div>
                  <span className="font-mono text-[11px] text-muted-foreground">{strength.label}</span>
                </div>
              )}
              {capsLockOn && <p className="text-xs text-amber-300">Caps Lock is currently active.</p>}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-primary py-4 font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <a
              href="#sign-in"
              onClick={(e) => {
                e.preventDefault();
                switchMode('login');
              }}
              className="text-violet-400 hover:underline transition-colors"
            >
              Sign In
            </a>
          </p>
        </div>
      );
    }

    if (mode === 'forgot') {
      return (
        <form onSubmit={handleForgotPassword} className="space-y-5">
          <div className="space-y-1.5">
            <label htmlFor="forgot-email" className="block text-sm font-medium text-muted-foreground">
              Account Email Address
            </label>
            <GlassInputWrapper>
              <input
                id="forgot-email"
                type="email"
                required
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                placeholder="Enter your email address"
                className="w-full bg-transparent text-sm p-4 rounded-2xl text-foreground placeholder-muted-foreground/60 focus:outline-none"
              />
            </GlassInputWrapper>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-primary py-4 font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {loading ? 'Issuing token...' : 'Issue Reset Token'}
          </button>

          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back to Sign In</span>
            </button>
            <a
              href="#enter-token"
              onClick={(e) => {
                e.preventDefault();
                switchMode('reset');
              }}
              className="text-violet-400 hover:underline transition-colors"
            >
              Already have a token?
            </a>
          </div>
        </form>
      );
    }

    if (mode === 'reset') {
      return (
        <form onSubmit={handleResetPassword} className="space-y-5">
          <div className="space-y-1.5">
            <label htmlFor="reset-token" className="block text-sm font-medium text-muted-foreground">
              Reset Token
            </label>
            <GlassInputWrapper>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-4 top-4 h-4 w-4 text-muted-foreground" />
                <input
                  id="reset-token"
                  type="text"
                  required
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  placeholder="Paste 48-character token"
                  className="w-full bg-transparent font-mono text-xs p-4 pl-11 rounded-2xl text-foreground placeholder-muted-foreground/60 focus:outline-none"
                />
              </div>
            </GlassInputWrapper>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="new-password" className="block text-sm font-medium text-muted-foreground">
              New Password (min 8 characters)
            </label>
            <GlassInputWrapper>
              <div className="relative">
                <input
                  id="new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter your new password"
                  className="w-full bg-transparent text-sm p-4 pr-12 rounded-2xl text-foreground placeholder-muted-foreground/60 focus:outline-none"
                />
                <button
                  type="button"
                  aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowNewPassword((s) => !s)}
                  className="absolute inset-y-0 right-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </GlassInputWrapper>
            {newPassword && (
              <div className="flex items-center gap-2 pt-1">
                <div className="grid flex-1 grid-cols-4 gap-1">
                  {[1, 2, 3, 4].map((step) => (
                    <div
                      key={step}
                      className={`h-1 rounded-full transition-colors ${
                        strength.score >= step ? strength.barColor : 'bg-white/10'
                      }`}
                    />
                  ))}
                </div>
                <span className="font-mono text-[11px] text-muted-foreground">{strength.label}</span>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-primary py-4 font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {loading ? 'Updating...' : 'Update Password'}
          </button>

          <button
            type="button"
            onClick={() => switchMode('login')}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Sign In</span>
          </button>
        </form>
      );
    }

    return null;
  };

  const { title, description } = getHeaderCopy();

  return (
    <SignInPage
      title={title}
      description={description}
      heroImageSrc={heroStudioImg}
      rightOverlay={
        <div className="w-full max-w-xl rounded-3xl border border-white/15 bg-zinc-950/75 p-6 backdrop-blur-xl shadow-2xl space-y-5">
          <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
            <div>
              <div className="font-display text-lg font-semibold text-white">Snout Live Network</div>
              <p className="text-xs text-slate-300 mt-0.5">
                Low-latency WebRTC voice, granular role permissions, bots, and TOTP 2FA protection.
              </p>
            </div>
            <div className="text-right shrink-0">
              <div className="font-mono text-sm font-bold text-amber-300 tabular-nums">$2.00 / mo</div>
              <div className="text-[11px] text-slate-400">SNOUT NITRO</div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3 text-center">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
              <div className="font-mono text-lg font-bold text-white tabular-nums">
                {summary ? summary.memberCount : '—'}
              </div>
              <div className="text-[11px] text-slate-400">Members</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
              <div className="font-mono text-lg font-bold text-white tabular-nums">
                {summary ? summary.serverCount : '—'}
              </div>
              <div className="text-[11px] text-slate-400">Servers</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
              <div className="font-mono text-lg font-bold text-white tabular-nums">
                {summary ? summary.channelCount : '—'}
              </div>
              <div className="text-[11px] text-slate-400">Channels</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
              <div className="font-mono text-lg font-bold text-white tabular-nums">
                {summary ? summary.messageCount : '—'}
              </div>
              <div className="text-[11px] text-slate-400">Messages</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs text-slate-300">
            <div className="flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-emerald-400 shrink-0" />
              <span>WebRTC Voice & Screen</span>
            </div>
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-indigo-400 shrink-0" />
              <span>Bot Gateway & Hooks</span>
            </div>
            <div className="flex items-center gap-2">
              <Crown className="h-4 w-4 text-amber-400 shrink-0" />
              <span>Animated Banners</span>
            </div>
          </div>

          <a
            href="/download"
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-[#5865F2]/40 bg-[#5865F2]/10 px-3.5 py-2 text-xs font-semibold text-indigo-200 transition-colors hover:bg-[#5865F2]/20"
          >
            <Download className="h-3.5 w-3.5" />
            Download Snout for macOS & Windows
          </a>
        </div>
      }
      brandLockup={
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <SnoutBrandIcon className="h-10 w-10 rounded-xl ring-1 ring-white/15 shadow-lg shadow-[#5865F2]/20" />
            <span className="font-display text-xl font-bold tracking-tight text-foreground">Snout</span>
          </div>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">SNOUT NITRO $2.00 / mo</span>
        </div>
      }
      modeTabs={
        !requiresTwoFactor && (mode === 'login' || mode === 'register') ? (
          <div className="grid grid-cols-2 rounded-2xl border border-border bg-foreground/5 p-1">
            <button
              type="button"
              onClick={() => switchMode('login')}
              className={`rounded-xl py-2 text-xs font-semibold transition-colors ${
                mode === 'login'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => switchMode('register')}
              className={`rounded-xl py-2 text-xs font-semibold transition-colors ${
                mode === 'register'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Create Account
            </button>
          </div>
        ) : undefined
      }
      error={error}
      notice={notice}
      loading={loading}
      defaultIdentifier={pendingLogin.identifier}
      defaultRememberMe={pendingLogin.rememberMe}
      capsLockOn={capsLockOn}
      onPasswordKeyEvent={checkCapsLock}
      onSignIn={handleSignIn}
      onResetPassword={() => switchMode('forgot')}
      onCreateAccount={() => switchMode('register')}
      customContent={renderCustomContent()}
    />
  );
};
