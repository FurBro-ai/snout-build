import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const rulesContent = fs.readFileSync(rulesPath, 'utf-8');

describe('CHORD Firestore Security Rules Guardrails', () => {
  it('enforces global default-deny safety net on unmatched paths', () => {
    expect(rulesContent).toMatch(/match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
  });

  it('prevents public/client escalation of isNitro and platformRole', () => {
    expect(rulesContent).toContain('incoming().isNitro == false');
    expect(rulesContent).toContain('incoming().isNitro == existing().isNitro');
    expect(rulesContent).toContain("incoming().platformRole == 'USER'");
    expect(rulesContent).toContain('incoming().platformRole == existing().platformRole');
  });

  it('isolates private user PII under /users/{userId}/private/{docId}', () => {
    expect(rulesContent).toContain('match /private/{docId}');
    expect(rulesContent).toContain('isOwner(userId) || isAdmin()');
  });

  it('locks down /subscriptions and /payments to server-side writes only', () => {
    expect(rulesContent).toMatch(/match \/subscriptions\/\{userId\}[\s\S]*?allow write: if false;/);
    expect(rulesContent).toMatch(/match \/payments\/\{paymentId\}[\s\S]*?allow write: if false;/);
  });

  it('requires authentication and membership checks on servers, channels, and messages', () => {
    expect(rulesContent).toContain('function isServerMember(serverId)');
    expect(rulesContent).toContain('function isVerifiedUser()');
    expect(rulesContent).toContain('incoming().authorId == request.auth.uid');
    expect(rulesContent).toContain('incoming().isPinned == false');
  });

  it('protects built-in server databases, rows, events, and personal bookmarks', () => {
    expect(rulesContent).toContain('match /databases/{tableId}');
    expect(rulesContent).toContain('match /rows/{rowId}');
    expect(rulesContent).toContain('match /events/{eventId}');
    expect(rulesContent).toContain('match /bookmarks/{bookmarkId}');
    expect(rulesContent).toContain('function isValidServerDatabaseTable');
    expect(rulesContent).toContain('function isValidBookmark');
  });
});
