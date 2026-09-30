import fs from 'node:fs';

/** Keep URL SSL parameters from replacing our verified CA and hostname policy. */
export function postgresConnectionOptions(connectionString, enabled = true, customCa = process.env.DATABASE_SSL_CA) {
  const url = new URL(connectionString);
  if (!enabled) return { connectionString, ssl: false };
  const supabasePooler = url.hostname.endsWith('.pooler.supabase.com');
  const ca = customCa
    ? customCa.includes('-----BEGIN CERTIFICATE-----') ? customCa : fs.readFileSync(customCa, 'utf8')
    : supabasePooler ? fs.readFileSync(new URL('../supabase-ca.crt', import.meta.url), 'utf8') : undefined;
  // node-postgres parses these parameters after the explicit ssl option and
  // otherwise silently drops its CA or weakens certificate verification.
  for (const key of ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) url.searchParams.delete(key);
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } };
}
