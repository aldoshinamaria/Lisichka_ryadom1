/**
 * @param {string} message
 * @param {{ event_type?: "child_pressed_help" }} [options]
 */
export async function checkMessage(message, options = {}) {
  const { event_type } = options;
  let studentId =
    typeof localStorage !== "undefined" ? localStorage.getItem("student_id") : null;
  if (studentId === "1") {
    studentId = null;
  }
  console.log("sending student_id:", studentId);
  console.log("api sends:", message);
  console.log("function url:", import.meta.env.VITE_SUPABASE_FUNCTION_URL);
  console.log("has key:", Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY));

  const url = import.meta.env.VITE_SUPABASE_FUNCTION_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    const data = { ok: false, danger: false, message: "" };
    console.log("api response:", data);
    return data;
  }

  const payload = {
    message: message != null ? String(message) : "",
    student_id: studentId,
  };
  if (event_type) {
    payload.event_type = event_type;
  }

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
    console.log("api response:", data);
    return data;
  }

  const data = await response.json();
  console.log("api response:", data);
  return data;
}
