// All settings come from environment variables. Nothing secret lives in the repo.
const env = process.env;

function required(name) {
  const v = env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  // 32 random bytes, base64. Encrypts each performer's Chaturbate Events API URL at rest.
  tokenKey: Buffer.from(required('TOKEN_KEY'), 'base64'),
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
  dbSsl: env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
};

if (config.tokenKey.length !== 32) throw new Error('TOKEN_KEY must be 32 bytes, base64-encoded');
