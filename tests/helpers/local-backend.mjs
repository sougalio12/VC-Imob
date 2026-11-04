export function assertLocalBackend(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Configure a local Supabase URL for integration tests.'); }
  if (!['http://127.0.0.1:54321', 'http://localhost:54321'].includes(url.origin) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Integration tests refuse non-local Supabase targets.');
  return url.origin;
}
