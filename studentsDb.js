import { supabase } from './supabaseClient.js';

/**
 * Создаёт строку в public.students и возвращает id.
 * @param {{ surname: string, name: string, className: string, login: string }} p
 * @returns {Promise<string | null>}
 */
export async function insertStudentAndGetId(p) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('students')
    .insert({
      surname: p.surname,
      name: p.name,
      class_name: p.className,
      login: p.login,
    })
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('students insert failed', error);
    return null;
  }
  return data?.id != null ? String(data.id) : null;
}

/**
 * @param {string} login
 * @returns {Promise<string | null>}
 */
export async function findStudentIdByLogin(login) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('students')
    .select('id')
    .eq('login', login)
    .maybeSingle();
  if (error) {
    console.error('students lookup by login failed', error);
    return null;
  }
  return data?.id != null ? String(data.id) : null;
}
