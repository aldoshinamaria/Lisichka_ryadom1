export async function checkMessage(message) {
  console.log("api sends:", message);
  const url = import.meta.env.VITE_SUPABASE_FUNCTION_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    const data = { ok: false, danger: false, message: '' };
    console.log("api response:", data);
    return data;
  }
  const response = await fetch(url, {
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
  if (!response.ok) {
    const t = await response.text();
    let data;
    try {
      data = t ? JSON.parse(t) : t;
    } catch {
      data = t;
    }
    console.log("api response:", data);
    return { ok: false, danger: false, message: t || 'Ошибка запроса' };
  }
  const data = await response.json();
  console.log("api response:", data);
  return data;
}
