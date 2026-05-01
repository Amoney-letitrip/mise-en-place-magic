/**
 * daily-briefing client
 *
 * Calls the generate-daily-briefing Edge Function. GEMINI_API_KEY lives only
 * in that function as a Supabase secret — never in the browser bundle.
 */

import { supabase } from '@/integrations/supabase/client';
import type { InventoryContext } from './chat-assistant';

export interface GenerateBriefingResponse {
  summary: string;
}

export async function generateBriefing(
  context: InventoryContext,
): Promise<GenerateBriefingResponse> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const { data: { session } } = await supabase.auth.getSession();
  const authHeader = session?.access_token
    ? `Bearer ${session.access_token}`
    : `Bearer ${anonKey}`;

  const response = await fetch(`${supabaseUrl}/functions/v1/generate-daily-briefing`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader,
      'apikey': anonKey,
    },
    body: JSON.stringify({ context }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `Briefing generation returned HTTP ${response.status}`);
  }
  return payload as GenerateBriefingResponse;
}
