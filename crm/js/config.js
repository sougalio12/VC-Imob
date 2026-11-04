/* Public configuration validated by js/runtime-config.js before any API request. */
const CRM_CONFIG = Object.freeze({
  supabaseUrl: window.VC_IMOB_CONFIG?.supabaseUrl || "",
  supabasePublishableKey: window.VC_IMOB_CONFIG?.supabasePublishableKey || "",
  environment: window.VC_IMOB_CONFIG?.environment || "development",
  authRedirectUrl: window.VC_IMOB_CONFIG?.authRedirectUrl || "",
  propertiesPath: "../data/imoveis.json"
});

function isSupabaseConfigured() {
  return Boolean(CRM_CONFIG.supabaseUrl && CRM_CONFIG.supabasePublishableKey);
}
