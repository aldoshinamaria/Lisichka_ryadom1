// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type StudentRow = {
  surname: string | null;
  name: string | null;
  class_name: string | null;
};

function getSupabaseForStudents() {
  const url = Deno.env.get("SUPABASE_URL");
  const key =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * `student_id` не приводим к number — id остаётся как в JSON (например uuid string).
 */
async function fetchStudentById(
  student_id: unknown
): Promise<StudentRow | null> {
  const supabase = getSupabaseForStudents();
  if (!supabase) {
    return null;
  }
  if (student_id === null || student_id === undefined || student_id === "") {
    return null;
  }
  const { data: student, error } = await supabase
    .from("students")
    .select("surname, name, class_name")
    .eq("id", student_id)
    .single();
  console.log("student:", student);
  if (error) {
    console.error("students lookup error:", error);
    return null;
  }
  return (student as StudentRow) ?? null;
}

function buildAdminStudentUrl(studentId: unknown): string {
  const baseRaw = Deno.env.get("ADMIN_PANEL_URL") ?? "";
  const base = baseRaw.replace(/\/$/, "");
  if (!base) return "";
  const idPart =
    studentId === null || studentId === undefined || studentId === ""
      ? ""
      : String(studentId);
  return `${base}/admin/student/${idPart}`;
}

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");

const FALLBACK_AI_REPLY = "Я рядом. Расскажи чуть подробнее 💛";

async function getAIResponse(userMessage: string): Promise<string> {
  if (!OPENROUTER_API_KEY) {
    console.warn("OPENROUTER_API_KEY is not set");
    return FALLBACK_AI_REPLY;
  }
  const trimmed = String(userMessage).trim();
  if (!trimmed) {
    return FALLBACK_AI_REPLY;
  }
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openrouter/free",
      messages: [
        {
          role: "system",
          content: `
Ты — добрый, спокойный, внимательный собеседник для ребёнка.

Твоя задача:
— поддерживать
— задавать мягкие вопросы
— помогать выговориться
— НЕ пугать
— НЕ давать сложных советов
— НЕ заменять взрослого

Если ребёнку плохо:
— прояви эмпатию
— спроси, что случилось
— поддержи

Если есть тревожные сигналы (буллинг, насилие, угрозы):
— мягко предложи обратиться к взрослому
— не дави

Говори просто, тепло, по-дружески.
`,
        },
        {
          role: "user",
          content: trimmed,
        },
      ],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error("OpenRouter error:", res.status, errText);
    return FALLBACK_AI_REPLY;
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content || FALLBACK_AI_REPLY;
}

async function sendWeb3FormsEmail(subject: string, text: string) {
  console.log("WEB3FORMS key exists:", Boolean(Deno.env.get("WEB3FORMS_ACCESS_KEY")));
  console.log("ADMIN_EMAIL:", Deno.env.get("ADMIN_EMAIL"));

  const emailResponse = await fetch("https://api.web3forms.com/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      access_key: Deno.env.get("WEB3FORMS_ACCESS_KEY"),
      from_name: "Лисичка рядом",
      email: Deno.env.get("ADMIN_EMAIL"),
      subject,
      message: text,
    }),
  });
  console.log("email response status:", emailResponse.status);
  console.log("email response text:", await emailResponse.text());
  console.log("email sent");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, danger: false, message: "Method not allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    let body: { message?: unknown; student_id?: unknown; event_type?: unknown };
    try {
      body = (await req.json()) as {
        message?: unknown;
        student_id?: unknown;
        event_type?: unknown;
      };
    } catch {
      return new Response(
        JSON.stringify({ ok: false, danger: false, message: "Invalid JSON" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const message = body.message || "";
    const student_id = body.student_id;
    const eventType =
      typeof body.event_type === "string" ? body.event_type : undefined;

    console.log("student_id:", student_id);
    console.log("SERVER MESSAGE:", String(message));

    if (eventType === "child_pressed_help") {
      try {
        const student = await fetchStudentById(student_id);
        const lead = student
          ? (() => {
              const studentName = `${student.surname} ${student.name}`.replace(
                /\s+/g,
                " "
              ).trim();
              return `Ученик ${studentName}, ${String(
                student.class_name ?? ""
              ).trim()} нажал кнопку «Попросить помощи».`;
            })()
          : "Не удалось определить ученика. Ребёнок нажал кнопку «Попросить помощи».";
        const adminStudentUrl = buildAdminStudentUrl(student_id);
        const emailBody =
          `Срочное сообщение от Лисички.

${lead}

⚠️ Требуется внимание взрослого.

Открыть профиль ученика:
${adminStudentUrl}`;
        await sendWeb3FormsEmail("🚨 Ученик позвал взрослого", emailBody);
      } catch (e) {
        console.error("web3forms email error:", e);
      }
      return new Response(
        JSON.stringify({ ok: true, danger: false, reply: "" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const strMessage = String(message).trim();
    const aiReply = strMessage
      ? await getAIResponse(strMessage)
      : FALLBACK_AI_REPLY;

    const lowerMessage = strMessage.toLowerCase();

    const dangerWords = [
      "плохо",
      "страшно",
      "грустно",
      "тревожно",
      "боюсь",
      "помогите",
      "нужна помощь",
    ];

    const isDanger = dangerWords.some((word) => {
      if (word === "плохо" && lowerMessage.includes("неплохо")) {
        return false;
      }
      return lowerMessage.includes(word);
    });

    if (isDanger) {
      try {
        const student = await fetchStudentById(student_id);
        const textMsg = strMessage;
        const lead = student
          ? (() => {
              const studentName = `${student.surname} ${student.name}`.replace(
                /\s+/g,
                " "
              ).trim();
              return `Ученик ${studentName}, ${String(
                student.class_name ?? ""
              ).trim()} написал: ${textMsg}`;
            })()
          : `Не удалось определить ученика\n\n"${textMsg}"`;
        const adminStudentUrl = buildAdminStudentUrl(student_id);
        const emailBody = `Срочное сообщение от Лисички.

${lead}

⚠️ Требуется внимание взрослого.

Открыть профиль ученика:
${adminStudentUrl}`;
        await sendWeb3FormsEmail("🚨 Срочное сообщение от Лисички", emailBody);
      } catch (e) {
        console.error("web3forms email error:", e);
      }
    }

    const payload = {
      ok: true,
      reply: aiReply,
      danger: isDanger,
    };

    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("check-message error:", e);
    return new Response(
      JSON.stringify({ ok: false, danger: false, message: "Server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
