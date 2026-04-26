export async function checkMessage(message) {
  const url = import.meta.env.VITE_SUPABASE_FUNCTION_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return { ok: false, danger: false, message: '' };
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ message: String(message), student_id: 1 }),
  });
  if (!res.ok) {
    return { ok: false, danger: false, message: (await res.text()) || 'Ошибка запроса' };
  }
  try {
    return await res.json();
  } catch {
    return { ok: false, danger: false, message: '' };
  }
}