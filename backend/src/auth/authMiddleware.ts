import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { ENV } from '../config/env.ts';
import { dbStore, type StoredUser } from '../store/dbStore.ts';

export interface AuthenticatedRequest extends Request {
  user?: StoredUser;
  sessionId?: string;
}

export interface JwtPayload {
  sub: string;
  sid: string;
  role: string;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function signSessionToken(user: StoredUser, sessionId: string): string {
  const payload: JwtPayload = {
    sub: user.id,
    sid: sessionId,
    role: user.platformRole,
  };
  return jwt.sign(payload, ENV.JWT_SECRET, { expiresIn: '14d' });
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function authenticateToken(token: string): { user: StoredUser; sessionId: string } | null {
  try {
    const decoded = jwt.verify(token, ENV.JWT_SECRET) as JwtPayload;
    const session = dbStore.state.sessions.find((s) => s.id === decoded.sid && s.userId === decoded.sub);
    if (!session) return null;
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      dbStore.state.sessions = dbStore.state.sessions.filter((s) => s.id !== session.id);
      dbStore.save();
      return null;
    }
    const user = dbStore.state.users.find((u) => u.id === decoded.sub);
    if (!user || user.isSuspended) return null;
    session.lastActiveAt = new Date().toISOString();
    return { user, sessionId: session.id };
  } catch {
    return null;
  }
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = authHeader.slice('Bearer '.length).trim();
  const result = authenticateToken(token);
  if (!result) {
    return res.status(401).json({ error: 'Invalid or expired session token' });
  }
  req.user = result.user;
  req.sessionId = result.sessionId;
  next();
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user || req.user.platformRole !== 'ADMIN') {
    return res.status(403).json({ error: 'Administrator privileges required' });
  }
  const allowedIps = ENV.ADMIN_ALLOWED_IPS.split(',').map((ip) => ip.trim()).filter(Boolean);
  if (allowedIps.length > 0) {
    const requestIp = (req.ip || '').replace(/^::ffff:/i, '');
    if (!allowedIps.includes(requestIp)) {
      return res.status(403).json({ error: 'Administrator access is not allowed from this IP address.' });
    }
  }
  next();
}
