import React, { useState } from 'react';
import { Calendar, Check, MapPin, Plus, Trash2, Users, X } from 'lucide-react';
import { PERMISSIONS, hasPermission } from '../../shared/constants.ts';
import { apiRequest } from '../services/api.ts';
import { useChordStore } from '../stores/useChordStore.ts';

export const ServerEventsView: React.FC = () => {
  const { user, serverBundle, scheduledEvents, refreshScheduledEvents, pushToast } = useChordStore();
  const serverId = serverBundle?.server.id || '';
  const canManage = serverBundle
    ? hasPermission(serverBundle.myPermissions, PERMISSIONS.MANAGE_CHANNELS) ||
      hasPermission(serverBundle.myPermissions, PERMISSIONS.MANAGE_SERVER)
    : false;

  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startsAt, setStartsAt] = useState(() =>
    new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 16)
  );
  const [locationLabel, setLocationLabel] = useState('Voice Lounge');
  const [submitting, setSubmitting] = useState(false);

  if (!serverBundle) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await apiRequest(`/api/servers/${serverId}/events`, {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          startsAt: new Date(startsAt).toISOString(),
          locationLabel: locationLabel.trim() || 'Voice Lounge',
        }),
      });
      setTitle('');
      setDescription('');
      setShowCreate(false);
      await refreshScheduledEvents(serverId);
      pushToast({ type: 'success', title: 'Scheduled event published' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Failed to create event', description: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRsvp = async (eventId: string) => {
    try {
      await apiRequest(`/api/servers/${serverId}/events/${eventId}/rsvp`, { method: 'POST' });
      await refreshScheduledEvents(serverId);
    } catch (err) {
      pushToast({ type: 'error', title: 'RSVP failed', description: (err as Error).message });
    }
  };

  const handleDelete = async (eventId: string) => {
    try {
      await apiRequest(`/api/servers/${serverId}/events/${eventId}`, { method: 'DELETE' });
      await refreshScheduledEvents(serverId);
      pushToast({ type: 'info', title: 'Event removed' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Delete failed', description: (err as Error).message });
    }
  };

  return (
    <div className="flex flex-1 flex-col bg-[#171A21] overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] bg-[#12151A] px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
            <Calendar className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-lg font-bold text-white">
              {serverBundle.server.name} · Scheduled Events
            </h1>
            <p className="text-xs text-slate-400">
              Upcoming community hangouts, voice sessions, and live releases.
            </p>
          </div>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#5865F2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#4752C4]"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Schedule Event</span>
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-5 max-w-4xl w-full mx-auto">
        {showCreate && (
          <form
            onSubmit={handleCreate}
            className="rounded-xl border border-[#5865F2]/40 bg-[#12151A] p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-white">Create Server Event</h2>
              <button type="button" onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Event title (e.g. Friday Voice Stage)"
                className="rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white focus:border-[#5865F2] focus:outline-none"
              />
              <input
                type="datetime-local"
                required
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white focus:border-[#5865F2] focus:outline-none"
              />
            </div>
            <input
              type="text"
              value={locationLabel}
              onChange={(e) => setLocationLabel(e.target.value)}
              placeholder="Location or Voice Channel (e.g. Voice Lounge)"
              className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white focus:border-[#5865F2] focus:outline-none"
            />
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What will happen at this event?"
              className="w-full rounded-lg border border-white/10 bg-[#0D0F12] px-3 py-2 text-xs text-white focus:border-[#5865F2] focus:outline-none"
            />
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-[#5865F2] px-4 py-2 text-xs font-semibold text-white hover:bg-[#4752C4] disabled:opacity-50"
            >
              {submitting ? 'Scheduling...' : 'Publish Event'}
            </button>
          </form>
        )}

        {scheduledEvents.length === 0 ? (
          <div className="rounded-xl border border-white/[0.07] bg-[#12151A] p-10 text-center space-y-2">
            <Calendar className="mx-auto h-8 w-8 text-slate-500" />
            <div className="font-display text-base font-semibold text-white">No upcoming events</div>
            <p className="text-xs text-slate-400">
              Schedule a community hangout or voice Q&A for members to RSVP.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {scheduledEvents.map((ev) => {
              const interested = user ? ev.interestedUserIds.includes(user.id) : false;
              return (
                <div
                  key={ev.id}
                  className="rounded-xl border border-white/[0.07] bg-[#12151A] p-5 flex flex-wrap items-start justify-between gap-4"
                >
                  <div className="space-y-2 max-w-xl">
                    <div className="flex items-center gap-2 font-mono text-[11px] text-emerald-300">
                      <Calendar className="h-3.5 w-3.5" />
                      <span>{new Date(ev.startsAt).toLocaleString()}</span>
                    </div>
                    <h3 className="font-display text-base font-bold text-white">{ev.title}</h3>
                    {ev.description && <p className="text-xs text-slate-300">{ev.description}</p>}
                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400 pt-1">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5 text-indigo-400" />
                        {ev.locationLabel}
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                        <Users className="h-3.5 w-3.5 text-slate-400" />
                        {ev.interestedUserIds.length} interested
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleRsvp(ev.id)}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors ${
                        interested
                          ? 'bg-emerald-600 text-white'
                          : 'border border-white/10 bg-[#171A21] text-slate-200 hover:bg-[#262B36]'
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>{interested ? 'Interested' : 'RSVP Interested'}</span>
                    </button>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => void handleDelete(ev.id)}
                        title="Delete Event"
                        className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-rose-300 hover:bg-rose-500/20"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
