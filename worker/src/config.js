// All settings come from environment variables. Nothing secret lives in the repo.
import crypto from 'node:crypto';
const env = process.env;

// The key that encrypts each performer's Events API link at rest.
// TOKEN_KEY (32 bytes, base64) if set. Otherwise derived from TOKEN_SECRET, which on Railway
// is a reference to the database password Railway generates, so no one has to handle a raw secret.
function tokenKey() {
  if (env.TOKEN_KEY) return Buffer.from(env.TOKEN_KEY, 'base64');
  if (env.TOKEN_SECRET) return crypto.createHash('sha256').update(`streamwing-token-key:${env.TOKEN_SECRET}`).digest();
  throw new Error('Set TOKEN_KEY or TOKEN_SECRET');
}
const dbUrl = required('DATABASE_URL');
// Which kind of key is in use, so /health can show it (never the key itself).
const keySource = env.TOKEN_KEY ? 'explicit' : 'derived';

function required(name) {
  const v = env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export const config = {
  databaseUrl: dbUrl,
  tokenKey: tokenKey(),
  port: Number(env.PORT || 8080),
  allowedOrigins: (env.ALLOWED_ORIGINS || 'https://streamwing.studio,https://www.streamwing.studio')
    .split(',').map(s => s.trim()).filter(Boolean),
  // Long-poll wait Chaturbate holds a request open for when there's nothing new.
  pollTimeoutSec: Number(env.POLL_TIMEOUT_SEC || 10),
  // Lifetime tokens tipped that make someone a "big tipper" in her room.
  bigTipperTokens: Number(env.BIG_TIPPER_TOKENS || 100),
  // Days seen that make someone a "regular".
  regularDays: Number(env.REGULAR_DAYS || 3),
  // Re-entering the room within this many minutes doesn't count as a new visit.
  revisitMinutes: Number(env.REVISIT_MINUTES || 30),
  // Railway's private network doesn't use SSL; anything else does unless told otherwise.
  // The one-line AI note per fan. Off until ANTHROPIC_API_KEY is set.
  aiKey: env.ANTHROPIC_API_KEY || '',
  keySource,
  // Researcher view password for /api/research/admin. Empty means the researcher view is switched off.
  researchAdminToken: env.RESEARCH_ADMIN_TOKEN || '',
  // Raw events other than tips are deleted after this many days. 0 turns the purge off. Tips stay: they are each fan's tip log.
  eventRetentionDays: Number(env.EVENT_RETENTION_DAYS || 0),
  // An uptime monitor URL (for example a Healthchecks.io ping URL). Empty means no monitoring.
  healthcheckUrl: env.HEALTHCHECK_URL || '',
  aiModel: env.AI_MODEL || 'claude-haiku-5-5',
  aiVersion: env.ANTHROPIC_VERSION || '2026-10-21',
  aiBaseUrl: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  aiNotesPerStream: Number(env.AI_NOTES_PER_STREAM || 40),
  dbSsl: env.DB_SSL === 'false' || /\.railway\.internal[:/]/.test(dbUrl) ? false : { rejectUnauthorized: false },
};

if (config.tokenKey.length !== 32) throw new Error('TOKEN_KEY must be 32 bytes, base64-encoded');
