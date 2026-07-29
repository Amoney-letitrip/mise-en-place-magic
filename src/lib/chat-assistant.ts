/**
 * chat-assistant client
 *
 * All Gemini calls go through the chat-assistant Edge Function so the
 * GEMINI_API_KEY is never exposed in the browser bundle. The client only
 * needs the Supabase URL and the user's JWT — both already available.
 */

import { supabase } from '@/integrations/supabase/client';

export interface ChatHistoryEntry {
  role: 'user' | 'model';
  text: string;
}

/** Subset of useAppState data serialised for the AI context block. */
export interface InventoryContext {
  restaurantName?: string | null;
  lowItems: Array<{ name: string; current_stock: number; threshold: number; unit: string }>;
  stockoutRisk: Array<{ name: string; unit: string; daysLeft: number }>;
  expiredLots: Array<{ ingredient_name?: string; lot_label: string; expires_at: string | null }>;
  expiringLots: Array<{ ingredient_name?: string; lot_label: string; expires_at: string | null }>;
  ordersDue: Array<{ vendor: string; itemCount: number }>;
  flaggedSalesCount: number;
  draftRecipesCount: number;
  totalSalesCount: number;
}

export interface ChatAssistantResponse {
  reply: string;
}

export async function sendChatMessage(
  message: string,
  history: ChatHistoryEntry[],
  context: InventoryContext,
): Promise<ChatAssistantResponse> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Your session has expired. Log in again to use the shift assistant.');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/chat-assistant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': anonKey,
    },
    body: JSON.stringify({ message, history, context }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `Chat assistant returned HTTP ${response.status}`);
  }
  return payload as ChatAssistantResponse;
}
