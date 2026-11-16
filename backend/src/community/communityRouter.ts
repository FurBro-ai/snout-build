import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { CommunityIdea, IdeaCategory } from '../../../shared/types.ts';
import { type AuthenticatedRequest, requireAuth } from '../auth/authMiddleware.ts';
import { dbStore } from '../store/dbStore.ts';

export const communityRouter = Router();

const CATEGORIES: IdeaCategory[] = ['Feature', 'Voice & Video', 'Bots & API', 'Design', 'Billing', 'Other'];

function serializeIdeas(userId: string) {
  return dbStore.state.communityIdeas
    .map((idea) => ({
      ...idea,
      author: dbStore.state.users.find((u) => u.id === idea.authorId)
        ? dbStore.toPublicUser(dbStore.state.users.find((u) => u.id === idea.authorId)!)
        : null,
      hasUpvoted: idea.upvoterIds.includes(userId),
    }))
    .sort((a, b) => b.upvoterIds.length - a.upvoterIds.length);
}

communityRouter.get('/ideas', requireAuth, (req: AuthenticatedRequest, res) => {
  const ideas = serializeIdeas(req.user!.id);
  const totalVotes = ideas.reduce((sum, i) => sum + i.upvoterIds.length, 0);
  res.json({
    ideas,
    stats: {
      total: ideas.length,
      totalVotes,
      shipped: ideas.filter((i) => i.status === 'SHIPPED').length,
      inProgress: ideas.filter((i) => i.status === 'IN_PROGRESS' || i.status === 'PLANNED').length,
    },
  });
});

communityRouter.post('/ideas', requireAuth, (req: AuthenticatedRequest, res) => {
  const title = String(req.body?.title || '').trim();
  const description = String(req.body?.description || '').trim();
  const category = String(req.body?.category || 'Feature') as IdeaCategory;
  if (title.length < 4 || title.length > 120) {
    return res.status(400).json({ error: 'Idea title must be 4-120 characters' });
  }
  if (description.length < 10 || description.length > 2000) {
    return res.status(400).json({ error: 'Idea description must be 10-2000 characters' });
  }
  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Invalid idea category' });
  }
  const now = new Date().toISOString();
  const idea: CommunityIdea = {
    id: `idea-${uuidv4().slice(0, 8)}`,
    title,
    description,
    category,
    status: 'UNDER_REVIEW',
    authorId: req.user!.id,
    authorName: req.user!.displayName,
    upvoterIds: [req.user!.id],
    adminResponse: '',
    createdAt: now,
    updatedAt: now,
  };
  dbStore.state.communityIdeas.push(idea);
  dbStore.save();
  res.status(201).json({ idea });
});

communityRouter.post('/ideas/:ideaId/vote', requireAuth, (req: AuthenticatedRequest, res) => {
  const idea = dbStore.state.communityIdeas.find((i) => i.id === req.params.ideaId);
  if (!idea) return res.status(404).json({ error: 'Community idea not found' });
  const idx = idea.upvoterIds.indexOf(req.user!.id);
  if (idx >= 0) {
    idea.upvoterIds.splice(idx, 1);
  } else {
    idea.upvoterIds.push(req.user!.id);
  }
  idea.updatedAt = new Date().toISOString();
  dbStore.save();
  res.json({
    idea: {
      ...idea,
      hasUpvoted: idea.upvoterIds.includes(req.user!.id),
      voteCount: idea.upvoterIds.length,
    },
  });
});
