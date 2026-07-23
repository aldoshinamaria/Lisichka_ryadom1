function getAiChatUrl() {
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base || typeof base !== "string") return "";
  return `${base.replace(/\/$/, "")}/functions/v1/ai-chat`;
}

/**
 * ИИ-ответ ребёнку + безопасная эскалация (вызов Edge Function, ключи только на стороне Supabase).
 * @param {string} message
 * @returns {Promise<{ ok: boolean, danger?: boolean, reply?: string, alert_type?: string, error?: string }>}
 */
export async function aiChat(message) {
  let studentId =
    typeof localStorage !== "undefined" ? localStorage.getItem("student_id") : null;
  if (studentId === "1") {
    studentId = null;
  }
  const url = getAiChatUrl();
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return { ok: false, danger: false, reply: "" };
  }
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      message: message != null ? String(message) : "",
      student_id: studentId,
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    console.error("ai-chat error:", response.status, errText);
    return { ok: false, danger: false, reply: "" };
  }
  return await response.json();
}

/**
 * @param {string} message
 * @param {{ event_type?: "child_pressed_help", case_id?: string, message_id?: string }} [options]
 */
export async function checkMessage(message, options = {}) {
  const { event_type, case_id, message_id } = options;
  let studentId =
    typeof localStorage !== "undefined" ? localStorage.getItem("student_id") : null;
  if (studentId === "1") {
    studentId = null;
  }
  const url = import.meta.env.VITE_SUPABASE_FUNCTION_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    const data = { ok: false, danger: false, message: "" };
    return data;
  }

  const payload = {
    message: message != null ? String(message) : "",
    student_id: studentId,
  };
  if (event_type) {
    payload.event_type = event_type;
  }
  if (case_id) payload.case_id = case_id;
  if (message_id) payload.message_id = message_id;

  const response = await fetch(import.meta.env.VITE_SUPABASE_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (response.ok === false) {
    const errText = await response.text();
    console.error("Supabase error:", response.status, errText);
    const data = { ok: false, danger: false, message: errText || "" };
    return data;
  }

  const data = await response.json();
  return data;
}
