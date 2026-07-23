import { supabase } from './supabaseClient.js';

const AUTH_EMAIL_DOMAIN = import.meta.env.VITE_AUTH_EMAIL_DOMAIN || 'lisichka.local';

function authEmail(login) {
  const value = String(login || '').trim().toLowerCase();
  if (!value) return '';
  return value.includes('@') ? value : `${encodeURIComponent(value)}@${AUTH_EMAIL_DOMAIN}`;
}

export function hasSupabase() {
  return Boolean(supabase);
}

export async function registerStudentAccount({ login, password, surname, name, className }) {
  if (!supabase) return { ok: false, reason: 'supabase_missing' };

  const email = authEmail(login);
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        role: 'student',
        login,
        surname,
        name,
        class_name: className,
      },
    },
  });

  if (signUpError) return { ok: false, error: signUpError.message };

  const authUserId = signUpData.user?.id || signUpData.session?.user?.id || null;
  const profile = await upsertStudentProfile({
    authUserId,
    login,
    surname,
    name,
    className,
  });

  return { ok: true, user: signUpData.user, session: signUpData.session, student: profile.student };
}

export async function signInStudentAccount(login, password) {
  if (!supabase) return { ok: false, reason: 'supabase_missing' };

  const { data, error } = await supabase.auth.signInWithPassword({
    email: authEmail(login),
    password,
  });
  if (error) return { ok: false, error: error.message };

  const { data: student, error: studentError } = await supabase
    .from('students')
    .select('*')
    .eq('auth_user_id', data.user.id)
    .maybeSingle();

  if (studentError) return { ok: false, error: studentError.message };
  if (!student) return { ok: false, error: 'student_profile_missing' };

  return { ok: true, session: data.session, user: data.user, student };
}

export async function signInStaffAccount(loginOrEmail, password) {
  if (!supabase) return { ok: false, reason: 'supabase_missing' };

  const { data, error } = await supabase.auth.signInWithPassword({
    email: authEmail(loginOrEmail),
    password,
  });
  if (error) return { ok: false, error: error.message };

  const { data: profile, error: profileError } = await supabase
    .from('staff_profiles')
    .select('*')
    .eq('id', data.user.id)
    .maybeSingle();

  if (profileError) return { ok: false, error: profileError.message };
  if (!profile || !['staff', 'admin'].includes(profile.role)) {
    await supabase.auth.signOut();
    return { ok: false, error: 'staff_profile_missing' };
  }

  return { ok: true, session: data.session, user: data.user, profile };
}

export async function signOutAccount() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function upsertStudentProfile({ authUserId, login, surname, name, className }) {
  if (!supabase) return { ok: false };

  const row = {
    auth_user_id: authUserId || null,
    login,
    surname,
    name,
    class_name: className,
  };

  const { data, error } = await supabase
    .from('students')
    .upsert(row, { onConflict: 'login' })
    .select()
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, student: data };
}

export async function updateStudentProfileOnServer(studentId, fields) {
  if (!supabase || !studentId) return { ok: false };

  const patch = {};
  if (fields.surname !== undefined) patch.surname = fields.surname;
  if (fields.name !== undefined) patch.name = fields.name;
  if (fields.className !== undefined) patch.class_name = fields.className;

  const { error } = await supabase.from('students').update(patch).eq('id', studentId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function fetchStudentsForStaff() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('students')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) {
    console.error('students fetch failed', error);
    return [];
  }
  return data || [];
}

export async function persistMessage(row) {
  if (!supabase) return { ok: false };
  const payload = {
    id: row.id,
    case_id: row.caseId,
    student_id: row.studentId || null,
    author_role: row.authorRole,
    body: row.body,
    case_status: row.caseStatus || null,
    urgent: Boolean(row.urgent),
    created_at: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
  };
  const { error } = await supabase.from('messages').upsert(payload, { onConflict: 'id' });
  if (error) {
    console.error('persistMessage failed', error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function fetchMessagesForStaff() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('messages')
    .select('*, students(id, login, surname, name, class_name)')
    .order('created_at', { ascending: true });
  if (error) {
    console.error('messages fetch failed', error);
    return [];
  }
  return data || [];
}

export async function fetchMessagesForStudent(studentId) {
  if (!supabase || !studentId) return [];
  const { data, error } = await supabase
    .from('messages')
    .select('*, students(id, login, surname, name, class_name)')
    .eq('student_id', studentId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('student messages fetch failed', error);
    return [];
  }
  return data || [];
}

export async function deleteMessagesByCaseId(caseId) {
  if (!supabase || !caseId) return { ok: false };
  const { error } = await supabase.from('messages').delete().eq('case_id', caseId);
  if (error) {
    console.error('deleteMessagesByCaseId failed', error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Выгрузить локальные кейсы ученика, которых ещё нет на сервере. */
export async function migrateLocalCasesToServer(localCases, studentId, studentKey) {
  if (!supabase || !studentId || !studentKey) return { ok: false, migrated: 0 };
  const key = String(studentKey).trim().toLowerCase();
  const mine = (localCases || []).filter(
    (c) =>
      c &&
      c.student === key &&
      !String(c.id || '').startsWith('c-seed') &&
      Array.isArray(c.messages) &&
      c.messages.length > 0
  );
  if (!mine.length) return { ok: true, migrated: 0 };

  const existing = await fetchMessagesForStudent(studentId);
  const existingCaseIds = new Set(existing.map((r) => r.case_id).filter(Boolean));
  const existingMsgIds = new Set(existing.map((r) => r.id).filter(Boolean));

  let migrated = 0;
  for (const c of mine) {
    if (existingCaseIds.has(c.id)) continue;
    for (const msg of c.messages) {
      if (!msg?.id || existingMsgIds.has(msg.id)) continue;
      const result = await persistMessage({
        id: msg.id,
        caseId: c.id,
        studentId,
        authorRole: msg.from === 'user' ? 'student' : msg.from,
        body: msg.text,
        caseStatus: c.status,
        urgent: c.urgent,
        createdAt: msg.at,
      });
      if (result.ok) {
        existingMsgIds.add(msg.id);
        migrated += 1;
      }
    }
    existingCaseIds.add(c.id);
  }
  return { ok: true, migrated };
}

/**
 * Сервер — источник правды; локальные кейсы ученика, которых нет на сервере, мигрируются.
 * Возвращает актуальный список кейсов ученика (после миграции — с сервера).
 */
export async function syncStudentCasesFromServer({ studentId, studentKey, localCases }) {
  const key = String(studentKey || '').trim().toLowerCase();
  if (!key) return { ok: false, cases: [] };
  if (!supabase || !studentId) {
    return {
      ok: false,
      reason: 'offline',
      cases: (localCases || []).filter((c) => c?.student === key && !String(c.id || '').startsWith('c-seed')),
    };
  }

  await migrateLocalCasesToServer(localCases, studentId, key);
  const rows = await fetchMessagesForStudent(studentId);
  let cases = serverMessagesToCases(rows).filter((c) => c.student === key || !c.student);
  // Если join students.login пуст, проставим studentKey сами
  cases = cases.map((c) => ({ ...c, student: c.student || key }));
  return { ok: true, cases };
}

/**
 * Для админки: мигрировать локальные «осиротевшие» кейсы, затем взять сервер как правду.
 * localOnlyRemaining — локальные кейсы без studentId (нельзя выгрузить).
 */
export async function syncStaffCasesFromServer(localCases, resolveStudentId) {
  if (!supabase) {
    return {
      ok: false,
      reason: 'offline',
      cases: (localCases || []).filter((c) => c && !String(c.id || '').startsWith('c-seed')),
    };
  }

  const list = (localCases || []).filter((c) => c && !String(c.id || '').startsWith('c-seed'));
  const byStudent = new Map();
  for (const c of list) {
    const key = String(c.student || '').trim().toLowerCase();
    if (!key) continue;
    if (!byStudent.has(key)) byStudent.set(key, []);
    byStudent.get(key).push(c);
  }

  for (const [studentKey, cases] of byStudent.entries()) {
    const studentId = resolveStudentId?.(studentKey);
    if (!studentId) continue;
    await migrateLocalCasesToServer(cases, studentId, studentKey);
  }

  const rows = await fetchMessagesForStaff();
  const serverCases = serverMessagesToCases(rows);
  const serverIds = new Set(serverCases.map((c) => c.id));
  const localOnly = list.filter((c) => !serverIds.has(c.id) && !resolveStudentId?.(c.student));
  return {
    ok: true,
    cases: [...serverCases, ...localOnly].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
  };
}

export function serverStudentToLocal(row) {
  if (!row) return null;
  return {
    studentKey: String(row.login || '').trim().toLowerCase(),
    name: row.name || '',
    surname: row.surname || '',
    className: row.class_name || '',
    login: row.login || '',
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    adminProfileUpdatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined,
    dbStudentId: row.id,
  };
}

export function serverMessagesToCases(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const student = row.students || {};
    const studentKey = String(student.login || row.student_id || '').trim().toLowerCase();
    const caseId = row.case_id;
    if (!caseId) return;
    if (!map.has(caseId)) {
      map.set(caseId, {
        id: caseId,
        student: studentKey,
        status: row.case_status || 'open',
        urgent: Boolean(row.urgent),
        updatedAt: new Date(row.created_at).getTime() || Date.now(),
        messages: [],
      });
    }
    const c = map.get(caseId);
    c.status = row.case_status || c.status;
    c.urgent = c.urgent || Boolean(row.urgent);
    c.updatedAt = Math.max(c.updatedAt || 0, new Date(row.created_at).getTime() || 0);
    c.messages.push({
      id: row.id,
      from: row.author_role === 'student' ? 'user' : row.author_role,
      at: new Date(row.created_at).getTime() || Date.now(),
      text: row.body || '',
    });
  });
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}
