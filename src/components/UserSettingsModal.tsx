import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Check,
  CheckCircle2,
  Copy,
  Crown,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { ANIMATED_BANNER_PRESETS, NITRO_DECORATIONS } from '../../shared/constants.ts';
import type { PublicUser, UserSession } from '../../shared/types.ts';
import { apiRequest, uploadFileToServer, type ApiError } from '../services/api.ts';
import { useChordStore } from '../stores/useChordStore.ts';
import { AnimatedBanner } from './AnimatedBanner.tsx';
import { UserAvatar } from './UserAvatar.tsx';
import { AppearanceSettings } from '../theme/AppearanceSettings.tsx';
import { translate, useLocale } from '../i18n.ts';

interface UserSettingsModalProps {
  onClose: () => void;
}

type SettingsTab = 'profile' | 'appearance' | 'security' | 'sessions';

export const UserSettingsModal: React.FC<UserSettingsModalProps> = ({ onClose }) => {
  const { user, email, setAuthData, logout, pushToast } = useChordStore();
  const locale = useLocale();
  const [tab, setTab] = useState<SettingsTab>('profile');

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [username, setUsername] = useState(user?.username || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [activityStatus, setActivityStatus] = useState(user?.activityStatus || '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || '');
  const [animatedAvatarUrl, setAnimatedAvatarUrl] = useState(user?.animatedAvatarUrl || '');
  const [bannerUrl, setBannerUrl] = useState(user?.bannerUrl || '');
  const [profileDecoration, setProfileDecoration] = useState(user?.profileDecoration || 'none');

  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [totpSetup, setTotpSetup] = useState<{ secret: string; otpauthUri: string; qrDataUrl: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpSecondsLeft, setTotpSecondsLeft] = useState(30 - (Math.floor(Date.now() / 1000) % 30));
  const [secretCopied, setSecretCopied] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [backupCopied, setBackupCopied] = useState(false);
  const [regenCode, setRegenCode] = useState('');
  const [showRegenPrompt, setShowRegenPrompt] = useState(false);
  const [totpBusy, setTotpBusy] = useState(false);

  const [verifyTokenInput, setVerifyTokenInput] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);

  const [deleteStep, setDeleteStep] = useState<1 | 2>(1);
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);
  const [deleteUsername, setDeleteUsername] = useState('');
  const [deletePhrase, setDeletePhrase] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteTotpCode, setDeleteTotpCode] = useState('');
  const [deleteHoldSeconds, setDeleteHoldSeconds] = useState(5);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBlockedServers, setDeleteBlockedServers] = useState<Array<{ id: string; name: string }>>([]);
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);

  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (tab === 'sessions') {
      void apiRequest<{ sessions: UserSession[] }>('/api/auth/sessions')
        .then((res) => setSessions(res.sessions))
        .catch(() => {});
    }
  }, [tab]);

  useEffect(() => {
    if (tab !== 'security') return;
    let active = true;
    void apiRequest<{ hasPassword?: boolean }>('/api/auth/me')
      .then((res) => {
        if (active) setHasPassword(Boolean(res.hasPassword));
      })
      .catch(() => {
        if (active) setHasPassword(null);
      });
    return () => {
      active = false;
    };
  }, [tab]);

  useEffect(() => {
    if (deleteStep !== 2) return;
    setDeleteHoldSeconds(5);
    const timer = setInterval(() => {
      setDeleteHoldSeconds((seconds) => {
        if (seconds <= 1) {
          clearInterval(timer);
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [deleteStep]);

  useEffect(() => {
    if (!totpSetup) return;
    const timer = setInterval(() => {
      setTotpSecondsLeft(30 - (Math.floor(Date.now() / 1000) % 30));
    }, 1000);
    return () => clearInterval(timer);
  }, [totpSetup]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const res = await apiRequest<{ user: PublicUser }>('/api/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName,
          username,
          bio,
          activityStatus,
          avatarUrl: avatarUrl || null,
          animatedAvatarUrl: user?.isNitro ? animatedAvatarUrl || null : undefined,
          bannerUrl: user?.isNitro ? bannerUrl || null : undefined,
          profileDecoration: user?.isNitro ? profileDecoration : undefined,
        }),
      });
      setAuthData({ user: res.user });
      setFeedback({ type: 'ok', text: 'Profile updated and synced live across Snout.' });
      pushToast({ type: 'success', title: 'Profile updated' });
    } catch (err) {
      setFeedback({ type: 'err', text: (err as Error).message });
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>, target: 'avatar' | 'banner') => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await uploadFileToServer(file, file.name);
      if (target === 'avatar') setAvatarUrl(res.attachment.url);
      else setBannerUrl(res.attachment.url);
    } catch (err) {
      setFeedback({ type: 'err', text: (err as Error).message });
    }
  };

  const handleStart2FA = async () => {
    setFeedback(null);
    setTotpBusy(true);
    try {
      const res = await apiRequest<{ secret: string; otpauthUri: string; qrDataUrl: string }>(
        '/api/auth/2fa/setup',
        { method: 'POST' }
      );
      setTotpSetup(res);
      setBackupCodes(null);
    } catch (err) {
      setFeedback({ type: 'err', text: (err as Error).message });
    } finally {
      setTotpBusy(false);
    }
  };

  const handleEnable2FA = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setFeedback(null);
    setTotpBusy(true);
    try {
      const res = await apiRequest<{ user: PublicUser; backupCodes: string[] }>('/api/auth/2fa/enable', {
        method: 'POST',
        body: JSON.stringify({ code: totpCode }),
      });
      setAuthData({ user: res.user });
      setTotpSetup(null);
      setTotpCode('');
      setBackupCodes(res.backupCodes);
      setFeedback({
        type: 'ok',
        text: 'Two-factor authentication is now active. Save your single-use recovery backup codes below.',
      });
      pushToast({ type: 'success', title: '2FA Enabled' });
    } catch (err) {
      setFeedback({ type: 'err', text: (err as Error).message });
    } finally {
      setTotpBusy(false);
    }
  };

  const handleDisable2FA = async () => {
    setFeedback(null);
    setTotpBusy(true);
    try {
      const res = await apiRequest<{ user: PublicUser }>('/api/auth/2fa/disable', {
        method: 'POST',
        body: JSON.stringify({ code: totpCode }),
      });
      setAuthData({ user: res.user });
      setTotpCode('');
      setBackupCodes(null);
      setShowRegenPrompt(false);
      setFeedback({ type: 'ok', text: 'Two-factor authentication disabled.' });
      pushToast({ type: 'info', title: '2FA Disabled' });
    } catch (err) {
      setFeedback({ type: 'err', text: (err as Error).message });
    } finally {
      setTotpBusy(false);
    }
  };

  const handleRegenerateBackupCodes = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setTotpBusy(true);
    try {
      const res = await apiRequest<{ user: PublicUser; backupCodes: string[] }>(
        '/api/auth/2fa/backup-codes/regenerate',
        {
          method: 'POST',
          body: JSON.stringify({ code: regenCode }),
        }
      );
      setAuthData({ user: res.user });
      setBackupCodes(res.backupCodes);
      setRegenCode('');
      setShowRegenPrompt(false);
      setFeedback({ type: 'ok', text: 'New single-use recovery backup codes generated. Previous codes are invalidated.' });
    } catch (err) {
      setFeedback({ type: 'err', text: (err as Error).message });
    } finally {
      setTotpBusy(false);
    }
  };

  const handleDownloadBackupCodes = () => {
    if (!backupCodes) return;
    const text = [
      `Snout Two-Factor Recovery Backup Codes`,
      `Account: @${user?.username || 'user'} (${email || ''})`,
      `Generated: ${new Date().toISOString()}`,
      `Keep these single-use codes in a secure password manager.`,
      '',
      ...backupCodes,
    ].join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `snout-2fa-backup-codes-${user?.username || 'account'}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleRequestEmailVerify = async () => {
    const res = await apiRequest<{ verificationToken?: string; alreadyVerified?: boolean }>(
      '/api/auth/resend-verification',
      { method: 'POST' }
    );
    if (res.verificationToken) {
      setVerifyTokenInput(res.verificationToken);
      setFeedback({ type: 'ok', text: `Verification token issued: ${res.verificationToken}` });
    }
  };

  const handleConfirmEmailVerify = async () => {
    setFeedback(null);
    try {
      const res = await apiRequest<{ user: PublicUser }>('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token: verifyTokenInput.trim() }),
      });
      setAuthData({ user: res.user });
      setFeedback({ type: 'ok', text: 'Email verified.' });
    } catch (err) {
      setFeedback({ type: 'err', text: (err as Error).message });
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setFeedback({ type: 'ok', text: 'Password updated.' });
    } catch (err) {
      setFeedback({ type: 'err', text: (err as Error).message });
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    await apiRequest(`/api/auth/sessions/${sessionId}`, { method: 'DELETE' });
    setSessions((s) => s.filter((x) => x.id !== sessionId));
  };

  const deleteRequirementsMet =
    deleteAcknowledged &&
    deleteUsername === (user?.username || '') &&
    deletePhrase === 'DELETE MY ACCOUNT' &&
    (!hasPassword || deletePassword.length > 0) &&
    (!user?.twoFactorEnabled || deleteTotpCode.trim().length > 0);
  const canDelete = deleteStep === 2 && deleteRequirementsMet && deleteHoldSeconds === 0 && !deleteBusy;

  const resetDeleteFlow = () => {
    setDeleteStep(1);
    setDeletePassword('');
    setDeleteTotpCode('');
    setDeleteError(null);
    setDeleteBlockedServers([]);
  };

  const handleDeleteAccount = async () => {
    if (!canDelete) return;
    setDeleteError(null);
    setDeleteBlockedServers([]);
    setDeleteBusy(true);
    try {
      await apiRequest('/api/auth/account', {
        method: 'DELETE',
        body: JSON.stringify({
          password: deletePassword || undefined,
          totpCode: deleteTotpCode.trim() || undefined,
          confirmUsername: deleteUsername,
          confirmation: deletePhrase,
        }),
      });
      pushToast({ type: 'success', title: 'Account deleted' });
      await logout();
      onClose();
    } catch (err) {
      const apiErr = err as ApiError;
      const ownedServers = Array.isArray(apiErr?.data?.ownedServers)
        ? (apiErr.data.ownedServers as Array<{ id?: unknown; name?: unknown }>).map((server) => ({
            id: String(server.id || ''),
            name: String(server.name || 'Unnamed server'),
          }))
        : [];
      setDeleteBlockedServers(ownedServers);
      setDeleteError(apiErr?.message || 'Account deletion failed. Please try again.');
    } finally {
      setDeleteBusy(false);
    }
  };

  const groupedSecret = totpSetup?.secret.replace(/(.{4})/g, '$1 ').trim() || '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.16 }}
        onClick={(e) => e.stopPropagation()}
        className="flex h-[84vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-[#12151A] shadow-2xl"
      >
        {/* Left Settings Nav */}
        <nav className="w-56 shrink-0 border-r border-white/[0.06] bg-[#0D0F12] p-4 flex flex-col justify-between">
          <div className="space-y-1 text-sm">
            <div className="px-3 pb-2 text-xs font-semibold text-slate-400">{translate('settings', locale)}</div>
            {([
              ['profile', translate('profile', locale)],
              ['appearance', translate('appearance', locale)],
              ['security', translate('security', locale)],
              ['sessions', translate('sessions', locale)],
            ] as Array<[SettingsTab, string]>).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setTab(k);
                  setFeedback(null);
                }}
                className={`w-full rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors ${
                  tab === k ? 'bg-[#262B36] text-white' : 'text-slate-400 hover:bg-white/[0.04] hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              void logout();
              onClose();
            }}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-rose-400 hover:bg-rose-500/15"
          >
            <LogOut className="h-4 w-4" />
            <span>{translate('signOut', locale)}</span>
          </button>
        </nav>

        {/* Right Panel */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-4">
            <h2 className="font-display text-lg font-bold text-white">
              {tab === 'profile' && translate('profile', locale)}
              {tab === 'appearance' && translate('appearance', locale)}
              {tab === 'security' && translate('security', locale)}
              {tab === 'sessions' && translate('sessions', locale)}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {feedback && (
            <div
              className={`rounded-lg border px-4 py-3 text-xs break-all ${
                feedback.type === 'ok'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
              }`}
            >
              {feedback.text}
            </div>
          )}

          {tab === 'profile' && (
            <form onSubmit={handleSaveProfile} className="space-y-5">
              {/* Live Preview Card with Animated Banner */}
              <div className="overflow-hidden rounded-xl border border-white/10 bg-[#171A21]">
                <AnimatedBanner
                  bannerUrl={bannerUrl || null}
                  fallbackImage="/src/assets/images/chord_profile_banner_1794745771194.jpg"
                  className="h-28"
                  showAnimatedLabel
                />
                <div className="px-5 pb-4 -mt-9 relative z-10 flex items-end justify-between">
                  <div className="flex items-end gap-3">
                    <div className="rounded-full bg-[#171A21] p-1">
                      <UserAvatar
                        user={{
                          ...user,
                          isNitro: user?.isNitro || Boolean(bannerUrl),
                          avatarUrl,
                          animatedAvatarUrl,
                          profileDecoration,
                        }}
                        size="xl"
                      />
                    </div>
                    <div className="pb-1">
                      <div className="font-display text-base font-bold text-white flex items-center gap-1.5">
                        <span>{displayName || user?.displayName}</span>
                        {user?.isNitro && <Crown className="h-4 w-4 text-amber-400" />}
                      </div>
                      <div className="font-mono text-xs text-slate-400">
                        @{username} · ID: {user?.id.slice(0, 8)}
                      </div>
                    </div>
                  </div>
                  {!user?.isNitro && bannerUrl && (
                    <span className="text-[11px] font-medium text-amber-300">
                      Preview Mode · Requires Nitro ($2.00/mo) to save
                    </span>
                  )}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1.5 text-xs">
                  <span className="font-medium text-slate-300">Display Name</span>
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="block space-y-1.5 text-xs">
                  <span className="font-medium text-slate-300">Username</span>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-sm text-white"
                  />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1.5 text-xs">
                  <span className="font-medium text-slate-300">Bio</span>
                  <textarea
                    rows={2}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="block space-y-1.5 text-xs">
                  <span className="font-medium text-slate-300">Activity Status</span>
                  <input
                    type="text"
                    value={activityStatus}
                    onChange={(e) => setActivityStatus(e.target.value)}
                    placeholder="e.g. Mixing stems in Studio One"
                    className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-sm text-white"
                  />
                  <span className="block text-[11px] text-slate-500">Shown on your profile card and member list.</span>
                </label>
              </div>

              <div className="flex flex-wrap gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-[#171A21] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#1E222B]">
                  <Upload className="h-3.5 w-3.5" />
                  <span>Upload Avatar</span>
                  <input type="file" accept="image/*" onChange={(e) => void handleAvatarUpload(e, 'avatar')} className="hidden" />
                </label>

                {user?.isNitro && (
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs font-medium text-amber-200 hover:bg-amber-500/20">
                    <Upload className="h-3.5 w-3.5" />
                    <span>Upload Animated GIF / Image Banner</span>
                    <input type="file" accept="image/*,.gif,.webp" onChange={(e) => void handleAvatarUpload(e, 'banner')} className="hidden" />
                  </label>
                )}
              </div>

              {/* Animated Banner Presets + Nitro Customizations */}
              <div className="rounded-xl border border-amber-500/20 bg-[#171A21] p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                    <Crown className="h-4 w-4" />
                    <span>SNOUT NITRO Animated Banners & Profile Perks</span>
                  </span>
                  {!user?.isNitro && (
                    <span className="text-[11px] text-slate-400">Preview free · Save with Nitro ($2.00/mo)</span>
                  )}
                </div>

                {/* Animated Banner Picker Grid */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-slate-300 font-medium">
                      <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                      <span>Animated Studio Banners</span>
                    </span>
                    {bannerUrl && (
                      <button
                        type="button"
                        onClick={() => setBannerUrl('')}
                        className="text-[11px] text-slate-400 hover:text-white"
                      >
                        Reset to Default
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {ANIMATED_BANNER_PRESETS.map((preset) => {
                      const active = bannerUrl === preset.token;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setBannerUrl(preset.token)}
                          className={`group overflow-hidden rounded-lg border text-left transition-all ${
                            active
                              ? 'border-amber-400 ring-1 ring-amber-400/50'
                              : 'border-white/10 hover:border-white/25'
                          }`}
                        >
                          <AnimatedBanner bannerUrl={preset.token} className="h-12" />
                          <div className="bg-[#0D0F12] px-2.5 py-1.5">
                            <div className="text-[11px] font-semibold text-white truncate">{preset.name}</div>
                            <div className="text-[10px] text-slate-400 truncate">{preset.subtitle}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1 text-xs">
                    <span className="text-slate-300">Custom Banner / GIF URL</span>
                    <input
                      type="text"
                      disabled={!user?.isNitro}
                      value={bannerUrl}
                      onChange={(e) => setBannerUrl(e.target.value)}
                      placeholder="preset:aurora_drift or /uploads/banner.gif"
                      className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 font-mono text-xs text-white disabled:opacity-40"
                    />
                  </label>
                  <label className="block space-y-1 text-xs">
                    <span className="text-slate-300">Animated Avatar GIF / WebP URL</span>
                    <input
                      type="url"
                      disabled={!user?.isNitro}
                      value={animatedAvatarUrl}
                      onChange={(e) => setAnimatedAvatarUrl(e.target.value)}
                      placeholder="https://.../avatar.gif"
                      className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white disabled:opacity-40"
                    />
                  </label>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs text-slate-300">Profile Decoration Frame</span>
                  <div className="flex flex-wrap gap-2">
                    {NITRO_DECORATIONS.map((dec) => (
                      <button
                        key={dec.id}
                        type="button"
                        disabled={!user?.isNitro}
                        onClick={() => setProfileDecoration(dec.id)}
                        className={`rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40 ${
                          profileDecoration === dec.id
                            ? 'border-amber-400 bg-amber-500/20 text-white'
                            : 'border-white/10 bg-[#0D0F12] text-slate-400'
                        }`}
                      >
                        {dec.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button
                type="submit"
                className="rounded-lg bg-[#5865F2] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#4752C4]"
              >
                Save Profile Changes
              </button>
            </form>
          )}

          {tab === 'appearance' && <AppearanceSettings />}

          {tab === 'security' && (
            <div className="space-y-6">
              {/* Email Verification */}
              <div className="rounded-xl border border-white/[0.07] bg-[#171A21] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-white">Email Address</div>
                    <div className="text-xs text-slate-400">{email}</div>
                  </div>
                  {user?.emailVerified ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" />
                      Verified
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleRequestEmailVerify()}
                      className="rounded-lg bg-[#5865F2] px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      Generate Verification Token
                    </button>
                  )}
                </div>
                {!user?.emailVerified && (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={verifyTokenInput}
                      onChange={(e) => setVerifyTokenInput(e.target.value)}
                      placeholder="Paste verification token..."
                      className="flex-1 rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-1.5 font-mono text-xs text-white"
                    />
                    <button
                      type="button"
                      onClick={() => void handleConfirmEmailVerify()}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      Verify
                    </button>
                  </div>
                )}
              </div>

              {/* 2FA */}
              <div className="rounded-xl border border-white/[0.07] bg-[#171A21] p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck
                      className={`h-5 w-5 ${user?.twoFactorEnabled ? 'text-emerald-400' : 'text-[#5865F2]'}`}
                    />
                    <div>
                      <div className="text-sm font-semibold text-white">
                        Two-Factor Authentication (TOTP & Recovery Codes)
                      </div>
                      <div className="text-xs text-slate-400">
                        {user?.twoFactorEnabled
                          ? `Active · ${user.twoFactorBackupRemaining ?? 0} of 8 backup codes remaining`
                          : 'Protect your account with an authenticator app QR code and 8 single-use recovery codes'}
                      </div>
                    </div>
                  </div>
                  {!user?.twoFactorEnabled && !totpSetup && (
                    <button
                      type="button"
                      disabled={totpBusy}
                      onClick={() => void handleStart2FA()}
                      className="rounded-lg bg-[#5865F2] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#4752C4] disabled:opacity-50"
                    >
                      {totpBusy ? 'Generating...' : 'Enable 2FA'}
                    </button>
                  )}
                </div>

                {totpSetup && (
                  <form
                    onSubmit={(e) => void handleEnable2FA(e)}
                    className="grid gap-5 rounded-xl border border-white/10 bg-[#0D0F12] p-4 sm:grid-cols-[auto_1fr]"
                  >
                    <div className="flex flex-col items-center gap-2">
                      <div className="rounded-xl bg-white p-2 shadow-md">
                        <img
                          src={totpSetup.qrDataUrl}
                          alt="Two-factor authentication QR code"
                          className="h-36 w-36"
                        />
                      </div>
                      <span className="font-mono text-[10px] text-slate-400 tabular-nums">
                        Code refreshes in {totpSecondsLeft}s
                      </span>
                    </div>

                    <div className="space-y-3 text-xs">
                      <div className="font-semibold text-white">
                        1. Scan QR Code with Google Authenticator, Authy, 1Password, or Bitwarden
                      </div>
                      <div className="space-y-1">
                        <div className="text-[11px] text-slate-400">Or enter this setup key manually:</div>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 rounded-lg border border-white/10 bg-[#12151A] px-3 py-2 font-mono text-xs text-amber-300 select-all break-all">
                            {groupedSecret}
                          </code>
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard?.writeText(totpSetup.secret);
                              setSecretCopied(true);
                              setTimeout(() => setSecretCopied(false), 1600);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-[#171A21] px-2.5 py-2 text-white hover:bg-[#262B36]"
                          >
                            {secretCopied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                            <span>{secretCopied ? 'Copied' : 'Copy'}</span>
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1.5 pt-1">
                        <div className="font-semibold text-white">2. Enter the 6-digit code to verify & activate</div>
                        <div className="flex flex-wrap gap-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            required
                            maxLength={6}
                            value={totpCode}
                            onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            placeholder="000000"
                            className="w-36 rounded-lg border border-white/10 bg-[#171A21] px-3 py-2 font-mono text-sm tracking-[0.25em] text-white"
                          />
                          <button
                            type="submit"
                            disabled={totpBusy || totpCode.length !== 6}
                            className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                          >
                            {totpBusy ? 'Verifying...' : 'Verify & Enable'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setTotpSetup(null);
                              setTotpCode('');
                            }}
                            className="rounded-lg border border-white/10 px-3 py-2 text-slate-300 hover:text-white"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  </form>
                )}

                {backupCodes && (
                  <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 space-y-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-semibold text-amber-200">Save Your Single-Use Recovery Backup Codes</div>
                        <div className="text-[11px] text-amber-200/75">
                          Each code works once if you lose access to your authenticator device.
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard?.writeText(backupCodes.join('\n'));
                            setBackupCopied(true);
                            setTimeout(() => setBackupCopied(false), 1600);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#0D0F12] px-2.5 py-1.5 font-medium text-white hover:bg-[#171A21]"
                        >
                          {backupCopied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                          <span>{backupCopied ? 'Copied' : 'Copy All'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleDownloadBackupCodes}
                          className="inline-flex items-center gap-1 rounded-lg bg-amber-400 px-2.5 py-1.5 font-semibold text-slate-950 hover:bg-amber-300"
                        >
                          <Download className="h-3.5 w-3.5" />
                          <span>Download .txt</span>
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono">
                      {backupCodes.map((code) => (
                        <div
                          key={code}
                          className="rounded-lg border border-amber-400/20 bg-[#0D0F12] px-3 py-2 text-center text-white select-all"
                        >
                          {code}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {user?.twoFactorEnabled && (
                  <div className="space-y-3 border-t border-white/[0.06] pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setShowRegenPrompt((s) => !s)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-[#262B36]"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        <span>Regenerate Recovery Codes</span>
                      </button>

                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          maxLength={12}
                          value={totpCode}
                          onChange={(e) => setTotpCode(e.target.value)}
                          placeholder="6-digit or backup code"
                          className="w-44 rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-1.5 font-mono text-xs text-white"
                        />
                        <button
                          type="button"
                          disabled={totpBusy || !totpCode.trim()}
                          onClick={() => void handleDisable2FA()}
                          className="rounded-lg bg-rose-600/20 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-600/30 disabled:opacity-40"
                        >
                          Disable 2FA
                        </button>
                      </div>
                    </div>

                    {showRegenPrompt && (
                      <form onSubmit={(e) => void handleRegenerateBackupCodes(e)} className="flex flex-wrap items-center gap-2 rounded-lg bg-[#0D0F12] p-3 text-xs">
                        <span className="text-slate-300">Confirm current 6-digit authenticator code:</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          required
                          maxLength={6}
                          value={regenCode}
                          onChange={(e) => setRegenCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="123456"
                          className="w-28 rounded border border-white/10 bg-[#171A21] px-2.5 py-1.5 font-mono text-white"
                        />
                        <button
                          type="submit"
                          disabled={totpBusy || regenCode.length !== 6}
                          className="rounded bg-[#5865F2] px-3 py-1.5 font-semibold text-white disabled:opacity-40"
                        >
                          Generate New Codes
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </div>

              {/* Password Update */}
              <form onSubmit={handleChangePassword} className="rounded-xl border border-white/[0.07] bg-[#171A21] p-4 space-y-3">
                <div className="flex items-center justify-between text-sm font-semibold text-white">
                  <span className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-slate-400" />
                    <span>Change Password</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowPasswords((v) => !v)}
                    className="inline-flex items-center gap-1 text-xs font-normal text-slate-400 hover:text-white"
                  >
                    {showPasswords ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    <span>{showPasswords ? 'Hide' : 'Show'}</span>
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    type={showPasswords ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Current password (if set)"
                    className="rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white"
                  />
                  <input
                    type={showPasswords ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password (min 8 chars)"
                    className="rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white"
                  />
                </div>
                <button type="submit" className="rounded-lg bg-[#262B36] px-4 py-2 text-xs font-semibold text-white hover:bg-white/15">
                  Update Password
                </button>
              </form>

              {/* Account Deletion */}
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 space-y-4">
                <div className="text-sm font-semibold text-rose-300">Delete Account</div>

                {deleteStep === 1 && (
                  <>
                    <p className="text-xs text-slate-400">
                      Permanently remove your Snout account and the data attached to it. This action cannot be undone.
                    </p>
                    <ul className="list-disc space-y-1 pl-5 text-xs text-slate-400">
                      <li>Every active session will be signed out immediately.</li>
                      <li>Friendships, friend requests, blocks, notifications, and bookmarks are removed.</li>
                      <li>Your server memberships are removed; servers you own must be transferred or deleted first.</li>
                      <li>Messages, DMs, subscriptions, and support tickets tied to this account are deleted.</li>
                    </ul>
                    <label className="flex items-start gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={deleteAcknowledged}
                        onChange={(e) => setDeleteAcknowledged(e.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-rose-500"
                      />
                      <span>I understand this is permanent and cannot be undone.</span>
                    </label>
                    <button
                      type="button"
                      disabled={!deleteAcknowledged}
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteBlockedServers([]);
                        setDeleteStep(2);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Continue to confirmation</span>
                    </button>
                  </>
                )}

                {deleteStep === 2 && (
                  <div className="space-y-3">
                    <p className="text-xs text-slate-400">
                      Confirm the details below. The final button unlocks after a short delay to prevent accidental
                      deletion.
                    </p>

                    <label className="block space-y-1 text-xs">
                      <span className="font-medium text-slate-300">
                        Type your username <span className="font-mono text-slate-400">@{user?.username}</span>
                      </span>
                      <input
                        type="text"
                        value={deleteUsername}
                        onChange={(e) => setDeleteUsername(e.target.value)}
                        placeholder={user?.username || 'username'}
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full rounded-lg border border-rose-500/30 bg-[#0D0F12] px-3 py-1.5 font-mono text-xs text-white"
                      />
                    </label>

                    <label className="block space-y-1 text-xs">
                      <span className="font-medium text-slate-300">
                        Type the phrase <code className="font-mono text-white">DELETE MY ACCOUNT</code>
                      </span>
                      <input
                        type="text"
                        value={deletePhrase}
                        onChange={(e) => setDeletePhrase(e.target.value)}
                        placeholder="DELETE MY ACCOUNT"
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full rounded-lg border border-rose-500/30 bg-[#0D0F12] px-3 py-1.5 font-mono text-xs text-white"
                      />
                    </label>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block space-y-1 text-xs">
                        <span className="font-medium text-slate-300">
                          Current password {hasPassword === false && <span className="text-slate-500">(not set)</span>}
                        </span>
                        <input
                          type="password"
                          value={deletePassword}
                          onChange={(e) => setDeletePassword(e.target.value)}
                          placeholder="Current password"
                          autoComplete="current-password"
                          disabled={hasPassword === false}
                          className="w-full rounded-lg border border-rose-500/30 bg-[#0D0F12] px-3 py-1.5 text-xs text-white disabled:opacity-40"
                        />
                      </label>
                      {user?.twoFactorEnabled && (
                        <label className="block space-y-1 text-xs">
                          <span className="font-medium text-slate-300">2FA code or recovery code</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={deleteTotpCode}
                            onChange={(e) => setDeleteTotpCode(e.target.value)}
                            placeholder="000000 or XXXX-XXXX"
                            autoComplete="one-time-code"
                            maxLength={16}
                            className="w-full rounded-lg border border-rose-500/30 bg-[#0D0F12] px-3 py-1.5 font-mono text-xs text-white"
                          />
                        </label>
                      )}
                    </div>

                    {hasPassword === false && !user?.twoFactorEnabled && (
                      <p className="text-xs text-amber-300">
                        This passwordless account can only be deleted from a session signed in within the last 10 minutes.
                        Sign in again before continuing.
                      </p>
                    )}

                    {deleteError && (
                      <div className="space-y-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                        <div>{deleteError}</div>
                        {deleteBlockedServers.length > 0 && (
                          <ul className="list-disc space-y-0.5 pl-4 font-mono text-[11px]">
                            {deleteBlockedServers.map((server) => (
                              <li key={server.id || server.name}>{server.name}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={!canDelete}
                        onClick={() => void handleDeleteAccount()}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>{deleteBusy ? 'Deleting…' : 'Permanently delete my account'}</span>
                      </button>
                      <button
                        type="button"
                        disabled={deleteBusy}
                        onClick={resetDeleteFlow}
                        className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:text-white disabled:opacity-40"
                      >
                        Cancel
                      </button>
                      {deleteHoldSeconds > 0 && (
                        <span className="text-[11px] text-slate-400 tabular-nums">
                          Please wait {deleteHoldSeconds}s…
                        </span>
                      )}
                    </div>

                    {deleteHoldSeconds === 0 && !deleteRequirementsMet && (
                      <p className="text-[11px] text-amber-300">
                        Complete every confirmation field to enable the delete button.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'sessions' && (
            <div className="space-y-3">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-[#171A21] px-4 py-3 text-xs"
                >
                  <div>
                    <div className="font-semibold text-white">
                      {s.userAgent.slice(0, 64)} {s.current && <span className="ml-1 text-emerald-400">(Current)</span>}
                    </div>
                    <div className="mt-0.5 font-mono text-slate-400">
                      IP: {s.ipAddress} · Last active {new Date(s.lastActiveAt).toLocaleString()}
                    </div>
                  </div>
                  {!s.current && (
                    <button
                      type="button"
                      onClick={() => void handleRevokeSession(s.id)}
                      className="rounded-lg bg-rose-500/15 px-3 py-1.5 text-rose-300 hover:bg-rose-500/25"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
