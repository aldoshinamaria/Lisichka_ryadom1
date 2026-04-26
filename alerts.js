import { supabase } from './supabaseClient.js';

/**
 * @param {object} row
 * @param {'ai_detected'|'child_pressed_help'} row.alert_type
 * @param {string} [row.status]
 */
export async function insertAlert(row) {
  if (!supabase) {
    console.warn('alerts: пропуск — нет supabase (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
    return { ok: false };
  }
  const { error } = await supabase.from('alerts').insert({
    alert_type: row.alert_type,
    status: row.status ?? 'new',
  });
  if (error) {
    console.error('alerts insert failed', error);
    return { ok: false, error: error.message };
  }
  console.log('alert saved', row.alert_type);
  return { ok: true };
}

export async function fetchAlerts() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('alerts')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('alerts fetch failed', error);
    return [];
  }
  return data ?? [];
}

/**
 * @param {string|number} alertId
 * @param {string} status
 */
export async function patchAlertStatus(alertId, status) {
  if (!supabase) return { ok: false };
  const { error } = await supabase.from('alerts').update({ status }).eq('id', alertId);
  if (error) {
    console.error('alerts patch failed', error);
    return { ok: false };
  }
  return { ok: true };
}

export async function deleteAlertById(alertId) {
  if (!supabase) return { ok: false };
  const { error } = await supabase.from('alerts').delete().eq('id', alertId);
  if (error) {
    console.error('alerts delete failed', error);
    return { ok: false };
  }
  return { ok: true };
}
