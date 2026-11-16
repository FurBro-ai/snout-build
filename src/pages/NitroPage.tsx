import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  Crown,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { ANIMATED_BANNER_PRESETS, NITRO_DECORATIONS, NITRO_PLAN } from '../../shared/constants.ts';
import type { PaymentRecord, PublicUser, SubscriptionRecord } from '../../shared/types.ts';
import { AnimatedBanner } from '../components/AnimatedBanner.tsx';
import { UserAvatar } from '../components/UserAvatar.tsx';
import { apiRequest } from '../services/api.ts';
import { useChordStore } from '../stores/useChordStore.ts';

interface PaymentConfigResponse {
  provider: string;
  providerDocsUrl: string;
  configured: boolean;
  missingVars: string[];
}

export const NitroPage: React.FC = () => {
  const { user, bootstrapSession, setAuthData, pushToast } = useChordStore();
  const [config, setConfig] = useState<PaymentConfigResponse | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionRecord | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<number>(2);
  const [previewDecoration, setPreviewDecoration] = useState<string>(
    user?.profileDecoration && user.profileDecoration !== 'none'
      ? user.profileDecoration
      : 'chromatic_spin'
  );
  const [previewBanner, setPreviewBanner] = useState<string>(
    user?.bannerUrl && user.bannerUrl.startsWith('preset:')
      ? user.bannerUrl
      : ANIMATED_BANNER_PRESETS[0].token
  );

  const loadBillingData = async () => {
    setLoading(true);
    try {
      const [cfg, subRes] = await Promise.all([
        apiRequest<PaymentConfigResponse>('/api/payments/config'),
        apiRequest<{
          isNitro: boolean;
          subscription: SubscriptionRecord | null;
          payments: PaymentRecord[];
        }>('/api/subscriptions/me'),
      ]);
      setConfig(cfg);
      setSubscription(subRes.subscription);
      setPayments(subRes.payments);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBillingData();

    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('orderId');
    if (orderId) {
      void apiRequest<{ payment: PaymentRecord }>(`/api/payments/status/${encodeURIComponent(orderId)}`)
        .then(async (res) => {
          if (res.payment.status === 'CONFIRMED') {
            setNotice('Payment verified by Platega webhook. SNOUT NITRO is now active.');
            await bootstrapSession();
          } else {
            setNotice(
              `Checkout returned with status: ${res.payment.status}. Nitro activates only upon verified Platega webhook confirmation.`
            );
          }
          await loadBillingData();
        })
        .catch(() => {});
    }
  }, [bootstrapSession]);

  const handleSubscribe = async () => {
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ payment: PaymentRecord; redirectUrl: string }>('/api/payments/create', {
        method: 'POST',
        body: JSON.stringify({ paymentMethod }),
      });
      if (res.redirectUrl) {
        window.location.assign(res.redirectUrl);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelSubscription = async () => {
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      await apiRequest('/api/subscriptions/cancel', {
        method: 'POST',
        body: JSON.stringify({ immediate: false }),
      });
      setNotice('Subscription renewal cancelled. Any active paid period remains valid until its expiration date.');
      await bootstrapSession();
      await loadBillingData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyStatus = async (paymentId: string) => {
    try {
      const res = await apiRequest<{ payment: PaymentRecord }>(`/api/payments/status/${paymentId}`);
      setNotice(`Payment ${res.payment.orderId} current status: ${res.payment.status}`);
      await loadBillingData();
      await bootstrapSession();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleApplyStudioLook = async () => {
    if (!user?.isNitro) return;
    try {
      const res = await apiRequest<{ user: PublicUser }>('/api/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          profileDecoration: previewDecoration,
          bannerUrl: previewBanner,
        }),
      });
      setAuthData({ user: res.user });
      pushToast({ type: 'success', title: 'Animated banner & Nitro frame applied' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Could not apply look', description: (err as Error).message });
    }
  };

  const previewUser: Partial<PublicUser> | null = user
    ? {
        ...user,
        isNitro: true,
        profileDecoration: previewDecoration,
        bannerUrl: previewBanner,
      }
    : null;

  return (
    <div className="flex-1 overflow-y-auto bg-[#0D0F12] text-[#F1F3F5]">
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-8">
        {/* Hero Banner */}
        <section className="relative overflow-hidden rounded-2xl border border-amber-500/25 bg-[#12151A]">
          <img
            src="/src/assets/images/chord_nitro_banner_1794745771476.jpg"
            alt="SNOUT NITRO acoustic studio sculpture"
            referrerPolicy="no-referrer"
            className="absolute inset-0 h-full w-full object-cover opacity-45"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0D0F12] via-[#0D0F12]/85 to-transparent" />

          <div className="relative z-10 flex flex-col justify-between gap-6 p-8 md:flex-row md:items-end">
            <div className="max-w-xl space-y-3">
              <div className="inline-flex items-center gap-2 text-xs font-semibold text-amber-300">
                <Crown className="h-4 w-4" />
                <span>SNOUT NITRO</span>
                <span aria-hidden="true">·</span>
                <span>Monthly Membership</span>
              </div>
              <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white [text-wrap:balance]">
                Elevate your studio profile, uploads, and voice quality.
              </h1>
              <p className="text-sm text-slate-300 leading-relaxed">
                Unlock 100 MB file uploads, animated profile avatars, custom banners and avatar frames, cross-server Nitro emojis, and HD 60fps screen sharing.
              </p>
            </div>

            <div className="shrink-0 rounded-xl border border-amber-500/30 bg-[#12151A]/95 p-5 min-w-[260px] space-y-4">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="font-mono text-3xl font-bold text-white tabular-nums">$2.00</div>
                  <div className="text-xs text-slate-400">USD / month</div>
                </div>
                <span className="text-xs font-medium text-emerald-400">
                  {user?.isNitro ? 'Active' : 'Standard Plan'}
                </span>
              </div>

              <div className="space-y-2">
                <label className="block text-xs text-slate-400">
                  Platega Method ID
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-[#0D0F12] px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value={2}>SBP / QR (Method 2)</option>
                    <option value={1}>Bank Card (Method 1)</option>
                    <option value={11}>Card / International (Method 11)</option>
                  </select>
                </label>

                <button
                  type="button"
                  disabled={submitting || loading}
                  onClick={() => void handleSubscribe()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-50 transition-colors"
                >
                  <CreditCard className="h-4 w-4" />
                  <span>{user?.isNitro ? 'Renew / Extend ($2.00 / month)' : 'Subscribe — $2.00 / month'}</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
            <AlertCircle className="h-5 w-5 shrink-0 text-rose-400 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold">Checkout Notice</div>
              <div>{error}</div>
            </div>
          </div>
        )}

        {notice && (
          <div className="flex items-start gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400 mt-0.5" />
            <div>{notice}</div>
          </div>
        )}

        {/* Interactive Live Nitro Profile Studio */}
        {user && (
          <section className="grid gap-6 rounded-xl border border-white/[0.07] bg-[#12151A] p-6 lg:grid-cols-12">
            <div className="lg:col-span-6 space-y-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-400" />
                <h2 className="font-display text-base font-semibold text-white">
                  Interactive Nitro Profile Studio
                </h2>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Preview GPU-animated banners and luminous Nitro avatar rings together before subscribing. Included with every{' '}
                <strong className="text-white">$2.00 / month</strong> SNOUT NITRO membership.
              </p>

              <div className="space-y-2">
                <div className="text-[11px] font-semibold text-slate-300">1. Choose Animated Banner</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {ANIMATED_BANNER_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setPreviewBanner(preset.token)}
                      className={`overflow-hidden rounded-lg border text-left transition-colors ${
                        previewBanner === preset.token
                          ? 'border-amber-400 ring-1 ring-amber-400/50'
                          : 'border-white/10 hover:border-white/25'
                      }`}
                    >
                      <AnimatedBanner bannerUrl={preset.token} className="h-8" />
                      <div className="bg-[#171A21] px-2 py-1 text-[11px] font-medium text-white truncate">
                        {preset.name}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-[11px] font-semibold text-slate-300">2. Choose Avatar Frame</div>
                <div className="grid grid-cols-2 gap-2">
                  {NITRO_DECORATIONS.filter((d) => d.id !== 'none').map((dec) => (
                    <button
                      key={dec.id}
                      type="button"
                      onClick={() => setPreviewDecoration(dec.id)}
                      className={`rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors ${
                        previewDecoration === dec.id
                          ? 'border-amber-400/60 bg-amber-500/10 text-white'
                          : 'border-white/10 bg-[#171A21] text-slate-300 hover:border-white/20'
                      }`}
                    >
                      {dec.name}
                    </button>
                  ))}
                </div>
              </div>

              {user.isNitro && (
                <button
                  type="button"
                  onClick={() => void handleApplyStudioLook()}
                  className="rounded-lg bg-[#5865F2] px-4 py-2 text-xs font-semibold text-white hover:bg-[#4752C4]"
                >
                  Apply Banner & Frame to Profile
                </button>
              )}
            </div>

            <div className="lg:col-span-6 overflow-hidden rounded-xl border border-white/10 bg-[#0D0F12] flex flex-col justify-between">
              <div>
                <AnimatedBanner bannerUrl={previewBanner} className="h-32" showAnimatedLabel />
                <div className="px-5 pb-5">
                  <div className="-mt-9 relative z-10 flex items-end justify-between">
                    <div className="rounded-full bg-[#0D0F12] p-1">
                      <UserAvatar user={previewUser} size="lg" showStatus />
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-300">
                      <Crown className="h-3 w-3" />
                      NITRO PREVIEW
                    </span>
                  </div>
                  <div className="mt-3">
                    <div className="font-display text-base font-bold text-white">{user.displayName}</div>
                    <div className="font-mono text-xs text-slate-400">@{user.username}</div>
                    {user.bio && <p className="mt-2 text-xs text-slate-300 line-clamp-2">{user.bio}</p>}
                  </div>
                </div>
              </div>
              <div className="border-t border-white/[0.06] bg-[#12151A] px-5 py-3 text-[11px] text-slate-400">
                Includes animated profile & GIF banners across all servers and user cards.
              </div>
            </div>
          </section>
        )}

        {/* Platega Integration & Merchant Status */}
        <section className="rounded-xl border border-white/[0.07] bg-[#12151A] p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="h-5 w-5 text-[#5865F2]" />
              <h2 className="font-display text-base font-semibold text-white">
                Subscription & Platega Billing Status
              </h2>
            </div>
            <a
              href="https://platega.io/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-indigo-300 hover:underline"
            >
              <span>Platega Official Gateway</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>

          <div className="grid gap-4 sm:grid-cols-4 border-t border-white/[0.06] pt-4 text-sm">
            <div>
              <div className="text-xs text-slate-400">Entitlement Status</div>
              <div className="mt-1 font-semibold text-white">
                {subscription?.status || (user?.isNitro ? 'ACTIVE' : 'NONE')}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Monthly Price</div>
              <div className="mt-1 font-mono font-semibold text-white tabular-nums">$2.00 USD / month</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Current Period Ends</div>
              <div className="mt-1 font-mono text-xs text-slate-200 tabular-nums">
                {subscription?.currentPeriodEnd
                  ? new Date(subscription.currentPeriodEnd).toLocaleDateString()
                  : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Merchant Gateway</div>
              <div className="mt-1 text-xs font-medium">
                {config?.configured ? (
                  <span className="text-emerald-400">Platega Credentials Configured</span>
                ) : (
                  <span className="text-amber-300">Merchant Credentials Required</span>
                )}
              </div>
            </div>
          </div>

          {!config?.configured && (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3.5 text-xs text-amber-200 space-y-1.5">
              <div className="font-semibold">Merchant Environment Configuration Required</div>
              <p className="text-amber-200/80">
                To issue live Platega checkout redirects, configure{' '}
                <code className="font-mono text-white">PLATEGA_MERCHANT_ID</code> and{' '}
                <code className="font-mono text-white">PLATEGA_SECRET</code> on the backend server, and set your callback URL in Platega Dashboard to{' '}
                <code className="font-mono text-white">/api/payments/platega/webhook</code>.
                Subscriptions are never activated from client redirects without verified webhook confirmation.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs text-slate-400">
            <span>
              {subscription?.renewalDisclosure ||
                'Renewal Policy: SNOUT NITRO bills $2.00 USD per 30-day period via Platega. If automatic recurring debit is disabled on the merchant account, you can renew manually before period expiration.'}
            </span>
            {subscription && (subscription.status === 'ACTIVE' || subscription.status === 'PENDING') && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleCancelSubscription()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 font-medium text-rose-300 hover:bg-rose-500/20"
              >
                <XCircle className="h-3.5 w-3.5" />
                <span>Cancel Subscription</span>
              </button>
            )}
          </div>
        </section>

        {/* Benefits Grid */}
        <section className="space-y-4">
          <h2 className="font-display text-xl font-bold text-white">Included in SNOUT NITRO ($2.00 / month)</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {NITRO_PLAN.features.map((feat) => (
              <div
                key={feat.id}
                className="rounded-xl border border-white/[0.07] bg-[#12151A] p-5 space-y-2"
              >
                <div className="font-display text-sm font-semibold text-white">{feat.title}</div>
                <p className="text-xs text-slate-400 leading-relaxed">{feat.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Plan Comparison Matrix */}
        <section className="rounded-xl border border-white/[0.07] bg-[#12151A] overflow-hidden">
          <div className="px-6 py-4 border-b border-white/[0.06]">
            <h3 className="font-display text-base font-semibold text-white">Tier Comparison</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/[0.06] text-xs text-slate-400 bg-[#0F1216]">
                <tr>
                  <th className="px-6 py-3 font-medium">Capability</th>
                  <th className="px-6 py-3 font-medium">Standard ($0.00)</th>
                  <th className="px-6 py-3 font-medium text-amber-300">SNOUT NITRO ($2.00 / month)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-xs">
                <tr>
                  <td className="px-6 py-3 text-slate-300">Max Attachment Size</td>
                  <td className="px-6 py-3 font-mono text-slate-400 tabular-nums">10 MB</td>
                  <td className="px-6 py-3 font-mono font-semibold text-white tabular-nums">100 MB</td>
                </tr>
                <tr>
                  <td className="px-6 py-3 text-slate-300">Animated Avatars & Profile Decorations</td>
                  <td className="px-6 py-3 text-slate-500">Static avatar only</td>
                  <td className="px-6 py-3 text-emerald-400">Included</td>
                </tr>
                <tr>
                  <td className="px-6 py-3 text-slate-300">Animated & Custom Profile Banners</td>
                  <td className="px-6 py-3 text-slate-500">Default solid</td>
                  <td className="px-6 py-3 text-emerald-400">6 Animated Studio Presets + GIF Uploads</td>
                </tr>
                <tr>
                  <td className="px-6 py-3 text-slate-300">Custom Nitro Emojis</td>
                  <td className="px-6 py-3 text-slate-500">Standard Unicode</td>
                  <td className="px-6 py-3 text-emerald-400">Cross-server Nitro emojis</td>
                </tr>
                <tr>
                  <td className="px-6 py-3 text-slate-300">Voice & Screen Share Quality</td>
                  <td className="px-6 py-3 font-mono text-slate-400">720p30 · 64 kbps</td>
                  <td className="px-6 py-3 font-mono text-white">1080p60 · 96+ kbps</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Payment History */}
        <section className="rounded-xl border border-white/[0.07] bg-[#12151A] overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
            <h3 className="font-display text-base font-semibold text-white">Payment History</h3>
            <button
              type="button"
              onClick={() => void loadBillingData()}
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Refresh</span>
            </button>
          </div>
          {payments.length === 0 ? (
            <div className="p-6 text-xs text-slate-500">No Platega payment transactions recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.06] text-slate-400 bg-[#0F1216]">
                  <tr>
                    <th className="px-6 py-3 font-medium">Order ID</th>
                    <th className="px-6 py-3 font-medium">Amount</th>
                    <th className="px-6 py-3 font-medium">Status</th>
                    <th className="px-6 py-3 font-medium">Date</th>
                    <th className="px-6 py-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {payments.map((p) => (
                    <tr key={p.id} className="hover:bg-white/[0.02]">
                      <td className="px-6 py-3 font-mono text-slate-300">{p.orderId}</td>
                      <td className="px-6 py-3 font-mono text-white tabular-nums">
                        ${Number(p.amount).toFixed(2)} {p.currency}
                      </td>
                      <td className="px-6 py-3">
                        <span
                          className={`font-mono font-semibold ${
                            p.status === 'CONFIRMED'
                              ? 'text-emerald-400'
                              : p.status === 'PENDING'
                              ? 'text-amber-300'
                              : 'text-rose-400'
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="px-6 py-3 font-mono text-slate-400 tabular-nums">
                        {new Date(p.createdAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-3 text-right">
                        {p.status === 'PENDING' && (
                          <button
                            type="button"
                            onClick={() => void handleVerifyStatus(p.id)}
                            className="text-indigo-300 hover:underline"
                          >
                            Verify Status
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
