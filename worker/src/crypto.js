import crypto from 'node:crypto';

// AES-256-GCM. Output: base64url(iv).base64url(tag).base64url(ciphertext)
export function encrypt(plain, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map(b => b.toString('base64url')).join('.');
}

export function decrypt(box, key) {
  const [iv, tag, ct] = box.split('.').map(s => Buffer.from(s, 'base64url'));
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

export const hashKey = key => crypto.createHash('sha256').update(key).digest('hex');
export const newAccessKey = () => crypto.randomBytes(24).toString('base64url');
