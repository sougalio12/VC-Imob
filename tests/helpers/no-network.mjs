// Loaded in every test worker. Real backend tests have a separate, local-only runner.
const fetchLocal = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Test network guard: remote requests are forbidden.');
  return fetchLocal(input, options);
};
