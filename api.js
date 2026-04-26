export async function checkMessage(message) {
  const url = import.meta.env.VITE_SUPABASE_FUNCTION_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return { ok: false, danger: false, message: '' };
  }
  console.log("api sends:", message);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      message: message,
      student_id: 1
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    let data;
    try {
      data = t ? JSON.parse(t) : t;
    } catch {
      data = t;
    }
    console.log("api response:", data);
    return { ok: false, danger: false, message: t || 'Ошибка запроса' };
  }
  try {
    const data = await res.json();
    console.log("api response:", data);
    return data;
  } catch {
    const data = null;
    console.log("api response:", data);
    return { ok: false, danger: false, message: '' };
  }
}
