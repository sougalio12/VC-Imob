import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";
import { createSiteLeadHandler } from "./handler.ts";

serve(createSiteLeadHandler({ env: name => Deno.env.get(name), createClient }));
