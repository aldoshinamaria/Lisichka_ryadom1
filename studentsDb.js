import { supabase } from './supabaseClient.js';

/**
 * Создаёт строку в public.students и возвращает id.
 * @param {{ surname: string, name: string, className: string, login: string, password: string }} p
 * @returns {Promise<string | null>}
 */
export async function insertStudentAndGetId(p) {
  if (!supabase) return null;
  const { surname, name, className, login, authUserId } = p;
  const { data: student, error } = await supabase
    .from('students')
    .upsert([{ surname, name, class_name: className, login, auth_user_id: authUserId || null }], {
      onConflict: 'login',
    })
    .select()
    .single();
  if (error) {
    console.error('students insert failed', error);
    return null;
  }
  if (student?.id) {
    try {
      localStorage.setItem('student_id', String(student.id));
    } catch {
      /* квота / приватный режим */
    }
    console.log('student created:', student);
  }
  return student?.id != null ? String(student.id) : null;
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
