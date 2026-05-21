export const supabaseConfig = {
  url: window.GIROS_SUPABASE_URL || "",
  anonKey: window.GIROS_SUPABASE_ANON_KEY || "",
};

export async function createSupabaseClient() {
  if (!supabaseConfig.url || !supabaseConfig.anonKey) return null;
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  return createClient(supabaseConfig.url, supabaseConfig.anonKey);
}

export async function getSupabaseStatus() {
  const client = await createSupabaseClient();
  return {
    enabled: Boolean(client),
    mode: client ? "Supabase connected" : "Local demo storage",
  };
}
