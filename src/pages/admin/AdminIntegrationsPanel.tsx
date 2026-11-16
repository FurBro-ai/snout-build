import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  CreditCard,
  ExternalLink,
  KeyRound,
  Loader2,
  Plug,
  Save,
  ShieldCheck,
  XCircle,
  Zap,
} from 'lucide-react';
import { apiRequest } from '../../services/api.ts';
import { useChordStore } from '../../stores/useChordStore.ts';

interface IntegrationStatus {
  provider: string;
  providerDocsUrl: string;
  configured: boolean;
  source: 'database' | 'environment' | 'none';
  apiUrl: string;
  merchantId: string;
  merchantIdSet: boolean;
  secretSet: boolean;
  webhookSecretSet: boolean;
  sandboxMode: boolean;
  webhookUrl: string;
  nitroPriceUsd: number;
  updatedAt: string | null;
  updatedBy: string | null;
  missingVars: string[];
}

interface TestResult {
  ok: boolean;
  reachable?: boolean;
  httpStatus?: number;
  latencyMs?: number;
  note?: string;
  error?: string;
}

export const AdminIntegrationsPanel: React.FC = () => {
  const { pushToast } = useChordStore();
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [merchantId, setMerchantId] = useState('');
  const [secret, setSecret] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [apiUrl, setApiUrl] = useState('https://app.platega.io');
  const [sandboxMode, setSandboxMode] = useState(false);
  const [nitroPrice, setNitroPrice] = useState(2);
  const [savingPrice, setSavingPrice] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ platega: IntegrationStatus }>('/api/admin/integrations');
      setStatus(res.platega);
      setApiUrl(res.platega.apiUrl);
      setSandboxMode(res.platega.sandboxMode);
      setNitroPrice(res.platega.nitroPriceUsd);
    } catch (err) {
      pushToast({ type: 'error', title: 'Could not load integrations', description: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiRequest<{ platega: IntegrationStatus }>('/api/admin/integrations/platega', {
        method: 'PATCH',
        body: JSON.stringify({
          merchantId: merchantId || undefined,
          secret: secret || undefined,
          webhookSecret: webhookSecret || undefined,
          apiUrl,
          sandboxMode,
        }),
      });
      setStatus(res.platega);
      setSecret('');
      setWebhookSecret('');
      setMerchantId('');
      pushToast({ type: 'success', title: 'Platega credentials saved', description: 'Overrides now take priority over environment variables.' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Save failed', description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiRequest<TestResult>('/api/admin/integrations/platega/test', { method: 'POST' });
      setTestResult(res);
      pushToast({
        type: res.ok ? 'success' : 'error',
        title: res.ok ? 'Platega host reachable' : 'Platega test failed',
        description: res.ok ? `${res.latencyMs}ms · HTTP ${res.httpStatus}` : res.error || 'Check credentials',
      });
    } catch (err) {
      const message = (err as Error).message;
      setTestResult({ ok: false, error: message });
      pushToast({ type: 'error', title: 'Platega test failed', description: message });
    } finally {
      setTesting(false);
    }
  };

  const handleSavePrice = async () => {
    setSavingPrice(true);
    try {
      await apiRequest('/api/admin/config', {
        method: 'PATCH',
        body: JSON.stringify({ nitroPriceUsd: nitroPrice }),
      });
      await load();
      pushToast({ type: 'success', title: 'Nitro price updated', description: `New checkouts charge $${nitroPrice.toFixed(2)} / month.` });
    } catch (err) {
      pushToast({ type: 'error', title: 'Price update failed', description: (err as Error).message });
    } finally {
      setSavingPrice(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-white/[0.07] bg-[#12151A] py-16 text-sm text-slate-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading integration status…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className={`rounded-xl border p-4 ${status?.configured ? 'border-emerald-500/30 bg-emerald-500/[0.07]' : 'border-amber-500/30 bg-amber-500/[0.07]'}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Plug className={`h-5 w-5 ${status?.configured ? 'text-emerald-300' : 'text-amber-300'}`} />
            <div>
              <div className="text-sm font-semibold text-white">
                Platega {status?.configured ? 'is connected' : 'needs credentials'}
              </div>
              <div className="font-mono text-[11px] text-slate-400">
                source: {status?.source} · merchant: {status?.merchantId || 'unset'} · price: ${status?.nitroPriceUsd.toFixed(2)}/mo
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleTest()}
            disabled={testing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#0D0F12] px-3 py-2 text-xs font-semibold text-white hover:bg-[#171A21] disabled:opacity-50"
          >
            <Zap className="h-3.5 w-3.5" /> {testing ? 'Testing…' : 'Test connection'}
          </button>
        </div>
        {testResult && (
          <div className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] ${testResult.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>
            {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
            {testResult.ok ? `HTTP ${testResult.httpStatus} in ${testResult.latencyMs}ms — ${testResult.note}` : testResult.error}
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-12">
        <form onSubmit={handleSave} className="space-y-3 rounded-xl border border-white/[0.07] bg-[#12151A] p-5 lg:col-span-7">
          <div className="flex items-center gap-2 font-display text-sm font-semibold text-white">
            <KeyRound className="h-4 w-4 text-indigo-300" /> Merchant credentials
          </div>
          <label className="block space-y-1">
            <span className="text-[11px] text-slate-400">Merchant ID {status?.merchantIdSet && <span className="text-emerald-400">(currently {status.merchantId})</span>}</span>
            <input
              value={merchantId}
              onChange={(e) => setMerchantId(e.target.value)}
              placeholder={status?.merchantIdSet ? 'Leave blank to keep current' : 'Paste Platega merchant ID'}
              className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 font-mono text-xs text-white focus:border-[#5865F2] focus:outline-none"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] text-slate-400">API Secret {status?.secretSet && <span className="text-emerald-400">(stored)</span>}</span>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={status?.secretSet ? '•••••••• (leave blank to keep)' : 'Paste API secret'}
              className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 font-mono text-xs text-white focus:border-[#5865F2] focus:outline-none"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] text-slate-400">Webhook Secret {status?.webhookSecretSet && <span className="text-emerald-400">(stored)</span>}</span>
            <input
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder={status?.webhookSecretSet ? '•••••••• (leave blank to keep)' : 'Defaults to API secret'}
              className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 font-mono text-xs text-white focus:border-[#5865F2] focus:outline-none"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] text-slate-400">API base URL</span>
            <input
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 font-mono text-xs text-white focus:border-[#5865F2] focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-slate-300">
            <input type="checkbox" checked={sandboxMode} onChange={(e) => setSandboxMode(e.target.checked)} className="rounded border-white/20 bg-[#0D0F12]" />
            Sandbox mode (never enable in production)
          </label>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-[#5865F2] px-4 py-2 text-xs font-semibold text-white hover:bg-[#4752C4] disabled:opacity-50">
            <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save credentials'}
          </button>
        </form>

        <div className="space-y-4 lg:col-span-5">
          <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-5 space-y-2">
            <div className="flex items-center gap-2 font-display text-sm font-semibold text-white">
              <ShieldCheck className="h-4 w-4 text-emerald-300" /> Webhook endpoint
            </div>
            <p className="text-[11px] leading-relaxed text-slate-400">
              Configure this callback URL in the Platega Merchant Dashboard. Nitro only activates from this verified route.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 font-mono text-[11px] text-slate-200">{status?.webhookUrl}</code>
              <button
                type="button"
                onClick={() => {
                  if (!status) return;
                  void navigator.clipboard?.writeText(status.webhookUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="rounded-lg border border-white/10 bg-[#171A21] p-2 text-slate-200 hover:bg-[#262B36]"
                title="Copy webhook URL"
              >
                {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
            <a href={status?.providerDocsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-indigo-300 hover:underline">
              Platega documentation <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-5 space-y-2 text-xs text-slate-400">
            <div className="flex items-center gap-2 font-display text-sm font-semibold text-white">
              <CreditCard className="h-4 w-4 text-amber-300" /> Billing controls
            </div>
            <p>Change the monthly Nitro price below. Checkout amounts and webhook validation use the configured price.</p>
            <div className="flex items-center gap-2">
              <span className="text-slate-400">$</span>
              <input
                type="number"
                min={0.5}
                step={0.01}
                value={nitroPrice}
                onChange={(e) => setNitroPrice(Number(e.target.value))}
                className="w-24 rounded-lg border border-white/10 bg-[#0D0F12] px-2 py-1.5 font-mono text-xs text-white"
              />
              <span className="text-slate-500">USD / month</span>
              <button
                type="button"
                onClick={() => void handleSavePrice()}
                disabled={savingPrice}
                className="ml-auto rounded-lg bg-[#5865F2] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#4752C4] disabled:opacity-50"
              >
                {savingPrice ? 'Saving…' : 'Save price'}
              </button>
            </div>
            <p className="font-mono text-[11px]">Last updated: {status?.updatedAt ? new Date(status.updatedAt).toLocaleString() : 'never'}{status?.updatedBy ? ` by ${status.updatedBy}` : ''}</p>
            <p>Missing: {status?.missingVars.length ? status.missingVars.join(', ') : 'none'}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
