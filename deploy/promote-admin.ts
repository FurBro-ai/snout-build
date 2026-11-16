import { dbStore } from '../backend/src/store/dbStore.ts';

const email = process.argv[2]?.trim().toLowerCase();
if (!email || process.argv.length !== 3) {
  console.error('Usage: tsx deploy/promote-admin.ts <verified-account-email>');
  process.exitCode = 2;
} else {
  const user = dbStore.state.users.find((candidate) => candidate.email.toLowerCase() === email);
  if (!user) {
    console.error(`No account found for ${email}.`);
    process.exitCode = 1;
  } else if (!user.emailVerified) {
    console.error(`Account ${email} must verify its email before promotion.`);
    process.exitCode = 1;
  } else {
    user.platformRole = 'ADMIN';
    user.updatedAt = new Date().toISOString();
    dbStore.saveImmediate();
    console.log(`Administrator privileges granted to ${email}.`);
  }
}