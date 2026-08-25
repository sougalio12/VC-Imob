/* Configuração pública: use somente a Publishable Key do projeto Supabase. */
const CRM_CONFIG = {
  supabaseUrl: "https://isbkhhobutbdtdtpaavn.supabase.co",
  supabasePublishableKey: "sb_publishable_cGq_OqxifhWpbVEGobB-7Q_De9SuyBC",
  propertiesPath: "../data/imoveis.json"
};

function isSupabaseConfigured() {
  return Boolean(
    CRM_CONFIG.supabaseUrl &&
    CRM_CONFIG.supabasePublishableKey &&
    !CRM_CONFIG.supabaseUrl.startsWith("YOUR_") &&
    !CRM_CONFIG.supabasePublishableKey.startsWith("YOUR_")
  );
}
