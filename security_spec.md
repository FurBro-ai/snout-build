# CHORD Security Specification & Firestore Invariants

## 1. Core Data Invariants
1. **PII Isolation**: User email, 2FA settings, and platform role are stored exclusively in `/users/{userId}/private/{docId}`, readable and writable only by the authenticated owner or verified admin.
2. **Server-Authoritative Billing & Entitlements**: `/subscriptions/{userId}` and `/payments/{paymentId}` are read-only for clients; only verified backend webhooks (Platega) and server-side admin SDK writes may mutate subscription status or `isNitro`.
3. **Master Gate Membership**: Access to `/servers/{serverId}/channels/{channelId}` and `/messages/{messageId}` requires active membership in `/servers/{serverId}/members/{request.auth.uid}`.
4. **Immutable Ownership & Timestamps**: `ownerId`, `authorId`, `serverId`, and `createdAt` cannot be modified after creation.
5. **Strict Field Allowlisting & Size Bounds**: Every document write validates exact allowed keys, types, and string lengths.

## 2. Adversarial Test Payloads ("Dirty Dozen")
1. **Shadow Field Injection on User Create**: `{ uid, username, displayName, status, isNitro: true, platformRole: 'ADMIN', createdAt }` -> `PERMISSION_DENIED` (`isNitro` cannot be self-granted, `platformRole` disallowed on public profile).
2. **Unverified Email Write**: Authenticated token with `email_verified: false` writing to `/servers/{serverId}` -> `PERMISSION_DENIED`.
3. **ID Poisoning**: Document ID of 1,500 characters or invalid symbols `../admin` -> `PERMISSION_DENIED` (`isValidId`).
4. **PII Blanket Read**: Non-owner authenticated user reading `/users/otherUid/private/info` -> `PERMISSION_DENIED`.
5. **Channel Message Without Membership**: Non-member writing to `/servers/s1/channels/c1/messages/m1` -> `PERMISSION_DENIED`.
6. **Author Spoofing**: Member writing message with `authorId != request.auth.uid` -> `PERMISSION_DENIED`.
7. **Self-Activated Nitro Subscription**: User writing directly to `/subscriptions/{uid}` -> `PERMISSION_DENIED`.
8. **Fake Platega Payment Record**: User writing directly to `/payments/{id}` -> `PERMISSION_DENIED`.
9. **Immutable Timestamp Tampering**: Updating message with modified `createdAt` -> `PERMISSION_DENIED`.
10. **Server Ownership Hijack**: Updating `/servers/{id}` to alter `ownerId` -> `PERMISSION_DENIED`.
11. **Oversized Message Denial of Wallet**: Message `content` > 4000 chars -> `PERMISSION_DENIED`.
12. **Blanket Collection Scrape**: Listing `/users/{uid}/private` or `/payments` without ownership filter -> `PERMISSION_DENIED`.
