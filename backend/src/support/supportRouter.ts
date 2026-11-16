import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type {
  SupportTicket,
  TicketCategory,
  TicketPriority,
} from '../../../shared/types.ts';
import { type AuthenticatedRequest, requireAuth } from '../auth/authMiddleware.ts';
import { dbStore } from '../store/dbStore.ts';
import { emitToUser } from '../websocket/socketGateway.ts';

export const supportRouter = Router();

const CATEGORIES: TicketCategory[] = ['Account', 'Billing', 'Bug Report', 'Feature Request', 'Safety', 'Other'];

function ownTickets(userId: string): SupportTicket[] {
  return dbStore.state.supportTickets
    .filter((t) => t.userId === userId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

supportRouter.get('/tickets', requireAuth, (req: AuthenticatedRequest, res) => {
  const tickets = ownTickets(req.user!.id);
  res.json({
    tickets,
    stats: {
      total: tickets.length,
      open: tickets.filter((t) => t.status !== 'RESOLVED' && t.status !== 'CLOSED').length,
    },
  });
});

supportRouter.post('/tickets', requireAuth, (req: AuthenticatedRequest, res) => {
  const subject = String(req.body?.subject || '').trim();
  const message = String(req.body?.message || '').trim();
  const category = String(req.body?.category || 'Other') as TicketCategory;
  const priority = String(req.body?.priority || 'NORMAL') as TicketPriority;
  if (subject.length < 4 || subject.length > 120) {
    return res.status(400).json({ error: 'Subject must be 4-120 characters' });
  }
  if (message.length < 10 || message.length > 4000) {
    return res.status(400).json({ error: 'Message must be 10-4000 characters' });
  }
  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Invalid support category' });
  }
  const allowedPriorities: TicketPriority[] = ['LOW', 'NORMAL', 'HIGH'];
  const now = new Date().toISOString();
  const ticket: SupportTicket = {
    id: `ticket-${uuidv4().slice(0, 8)}`,
    userId: req.user!.id,
    username: req.user!.username,
    email: req.user!.email,
    subject,
    category,
    priority: allowedPriorities.includes(priority) ? priority : 'NORMAL',
    status: 'OPEN',
    messages: [
      {
        id: `stm-${uuidv4().slice(0, 8)}`,
        authorId: req.user!.id,
        authorName: req.user!.displayName,
        isStaff: false,
        body: message,
        createdAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  dbStore.state.supportTickets.unshift(ticket);
  dbStore.addAuditLog({
    serverId: null,
    actorId: req.user!.id,
    action: 'SUPPORT_TICKET_CREATED',
    targetType: 'SUPPORT_TICKET',
    targetId: ticket.id,
    details: `Opened support ticket "${ticket.subject}" (${ticket.category})`,
  });
  dbStore.save();
  res.status(201).json({ ticket });
});

supportRouter.get('/tickets/:ticketId', requireAuth, (req: AuthenticatedRequest, res) => {
  const ticket = dbStore.state.supportTickets.find(
    (t) => t.id === req.params.ticketId && t.userId === req.user!.id
  );
  if (!ticket) return res.status(404).json({ error: 'Support ticket not found' });
  res.json({ ticket });
});

supportRouter.post('/tickets/:ticketId/messages', requireAuth, (req: AuthenticatedRequest, res) => {
  const ticket = dbStore.state.supportTickets.find(
    (t) => t.id === req.params.ticketId && t.userId === req.user!.id
  );
  if (!ticket) return res.status(404).json({ error: 'Support ticket not found' });
  if (ticket.status === 'CLOSED') {
    return res.status(400).json({ error: 'This ticket is closed. Open a new ticket to continue.' });
  }
  const body = String(req.body?.body || '').trim();
  if (body.length < 1 || body.length > 4000) {
    return res.status(400).json({ error: 'Message must be 1-4000 characters' });
  }
  const now = new Date().toISOString();
  ticket.messages.push({
    id: `stm-${uuidv4().slice(0, 8)}`,
    authorId: req.user!.id,
    authorName: req.user!.displayName,
    isStaff: false,
    body,
    createdAt: now,
  });
  ticket.status = 'OPEN';
  ticket.updatedAt = now;
  dbStore.save();
  res.status(201).json({ ticket });
});

supportRouter.post('/tickets/:ticketId/close', requireAuth, (req: AuthenticatedRequest, res) => {
  const ticket = dbStore.state.supportTickets.find(
    (t) => t.id === req.params.ticketId && t.userId === req.user!.id
  );
  if (!ticket) return res.status(404).json({ error: 'Support ticket not found' });
  ticket.status = 'CLOSED';
  ticket.updatedAt = new Date().toISOString();
  dbStore.save();
  emitToUser(req.user!.id, 'support:updated', { ticketId: ticket.id });
  res.json({ ticket });
});
