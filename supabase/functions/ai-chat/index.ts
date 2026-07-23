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

const DANGER_CHILD_REPLY =
  "Я рядом. Спасибо, что написал(а). Это важно. Сейчас лучше, чтобы подключился взрослого. Я уже передала сигнал.";

const RISK_ALERT_TYPES = new Set([
  "bullying",
  "family_abuse",
  "illegal_pressure",
  "self_harm",
  "immediate_danger",
  "other_risk",
]);

const ALERT_RU: Record<string, string> = {
  bullying: "буллинг / оскорбления",
  family_abuse: "жёсткое обращение взрослых",
  illegal_pressure: "незаконное давление",
  self_harm: "самоповреждение / риск для себя",
  immediate_danger: "срочная опасность / угроза",
  other_risk: "другой риск",
  none: "—",
};

const SYSTEM_LISICHKA = `Ты "Лисичка рядом" — добрый безопасный собеседник для школьника.
Твоя задача:
- поддерживать ребёнка;
- разговаривать спокойно и бережно;
- задавать 1 короткий уточняющий вопрос;
- помогать ребёнку назвать свои чувства;
- не читать нотации;
- не давать медицинских, юридических, опасных советов;
- не обещать полную тайну;
- не говорить "я психолог";
- не заменять взрослого.

Если ребёнок пишет про обычную грусть, тревогу, одиночество:
ответь поддерживающе и спроси мягкий вопрос.

Если в диалоге выявляется:
- буллинг;
- регулярные оскорбления;
- угрозы;
- насилие;
- жестокое обращение родителей или взрослых;
- давление сделать что-то незаконное;
- самоповреждение;
- мысли о смерти;
- опасность прямо сейчас;
- сексуализированное насилие;
- шантаж;
- страх идти домой;
- "мне нельзя никому говорить";

то:
1. мягко поддержи ребёнка;
2. скажи, что рядом должен подключиться взрослый;
3. верни danger: true;
4. верни alert_type одно из: bullying, family_abuse, illegal_pressure, self_harm, immediate_danger, other_risk

Формат ответа строго JSON (без markdown, без текста вне JSON):
{
  "reply": "текст ответа ребёнку (только при danger: false; при danger: true всё равно заполни мягкую поддержку, сервер перезапишет текст для ребёнка)",
  "danger": true/false,
  "alert_type": "none" или "bullying" / "family_abuse" / "illegal_pressure" / "self_harm" / "immediate_danger" / "other_risk",
  "summary_for_adult": "кратко для взрослого, что произошло"
}

Если риска нет: danger: false, alert_type: "none", summary_for_adult: пустая строка или краткое "рисков не зафиксировано".`;

type StudentRow = {
  surname: string | null;
  name: string | null;
  class_name: string | null;
};

type AiPayload = {
  reply?: string;
  danger?: boolean;
  alert_type?: string;
  summary_for_adult?: string;
};

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) return null;
  return createClient(url, key);
}

async function fetchStudent(
  supabase: ReturnType<typeof createClient>,
  student_id: unknown
): Promise<StudentRow | null> {
  if (student_id === null || student_id === undefined || student_id === "") {
    return null;
  }
  const { data, error } = await supabase
    .from("students")
    .select("surname, name, class_name")
    .eq("id", student_id)
    .single();
  if (error) {
    console.error("students fetch:", error);
    return null;
  }
  return (data as StudentRow) ?? null;
}

function normalizeAlertType(
  v: string | undefined,
  danger: boolean
): string {
  if (!danger) return "none";
  const t = (v || "other_risk").trim();
  if (t === "none" || t === "" || !RISK_ALERT_TYPES.has(t)) {
    return "other_risk";
  }
  return t;
}

async function callOpenAIJson(userContent: string): Promise<
  { raw: AiPayload; text: string }
> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_LISICHKA },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
      max_tokens: 600,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error("OpenAI error:", res.status, t);
    throw new Error("OpenAI request failed");
  }
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = body.choices?.[0]?.message?.content || "{}";
  let raw: AiPayload;
  try {
    raw = JSON.parse(text) as AiPayload;
  } catch {
    throw new Error("OpenAI returned non-JSON");
  }
  return { raw, text };
}

async function sendWeb3FormsEmail(subject: string, text: string) {
  const access = Deno.env.get("WEB3FORMS_ACCESS_KEY");
  if (!access) {
    console.warn("WEB3FORMS_ACCESS_KEY missing, skip email");
    return;
  }
  const email = Deno.env.get("ADMIN_EMAIL");
  if (!email) {
    console.warn("ADMIN_EMAIL missing, skip email");
    return;
  }
  const emailResponse = await fetch("https://api.web3forms.com/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      access_key: access,
      from_name: "Лисичка рядом",
      email,
      subject,
      message: text,
    }),
  });
  console.log("web3forms status:", emailResponse.status, await emailResponse
    .text());
}

function buildContextLine(student: StudentRow | null) {
  if (!student) {
    return "Профиль ученика в базе не найден.";
  }
  const fio = `${String(student.surname ?? "").trim()} ${
    String(student.name ?? "").trim()
  }`.replace(/\s+/g, " ").trim();
  const cl = String(student.class_name ?? "").trim();
  return `Ученик: ${fio || "—"}\nКласс: ${cl || "—"}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const body = (await req.json()) as {
      message?: unknown;
      student_id?: unknown;
      case_id?: unknown;
      message_id?: unknown;
    };
    const message = String(body.message ?? "").trim();
    const student_id = body.student_id;
    const case_id = typeof body.case_id === "string" ? body.case_id : null;
    const message_id = typeof body.message_id === "string" ? body.message_id : null;
    if (!message) {
      return new Response(
        JSON.stringify({
          ok: false,
          danger: false,
          reply: "Напиши, пожалуйста, пару слов — я рядом 💬",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = getSupabase();
    if (!supabase) {
      return new Response(
        JSON.stringify({
          ok: false,
          danger: false,
          reply: "Сейчас не получилось соединиться. Попробуй чуть позже.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const student = await fetchStudent(supabase, student_id);
    const userContent =
      `${buildContextLine(student)}\n\nСообщение ребёнка:\n${message}`;

    let ai: AiPayload;
    try {
      const { raw } = await callOpenAIJson(userContent);
      ai = raw;
    } catch (e) {
      console.error("ai-chat OpenAI error:", e);
      return new Response(
        JSON.stringify({
          ok: false,
          danger: false,
          reply:
            "Сейчас у меня не получилось ответить. Попробуй написать ещё чуть-чуть позже 💬",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const danger = Boolean(ai.danger);
    const alertType = normalizeAlertType(ai.alert_type, danger);

    const summary = String(
      danger ? (ai.summary_for_adult || "") : "",
    ).trim();
    const safeReply = typeof ai.reply === "string" && ai.reply.trim()
      ? ai.reply.trim()
      : "Я рядом. Расскажи, что для тебя сейчас важно?";

    // Эскалация: alert + письмо
    if (danger) {
      const studentLine = student
        ? (() => {
          const s = String(student.surname ?? "").trim();
          const n = String(student.name ?? "").trim();
          return `${s} ${n}`.replace(/\s+/g, " ").trim() || "—";
        })()
        : "—";
      const className = student
        ? String(student.class_name ?? "").trim() || "—"
        : "—";
      const typeRu = ALERT_RU[alertType] || alertType;

      try {
        const { error: insErr } = await supabase.from("alerts").insert({
          student_id: student_id || null,
          case_id,
          message_id,
          alert_type: alertType,
          status: "new",
          summary_for_adult: summary || null,
          source: "edge_ai_chat",
        });
        if (insErr) {
          console.error("alerts insert error:", insErr);
        } else {
          console.log("alert saved:", alertType);
        }
      } catch (e) {
        console.error("alerts insert:", e);
      }

      const emailText =
        `🚨 Срочное сообщение от Лисички

Ученик: ${studentLine}
Класс: ${className}

Тип риска: ${typeRu} (${alertType})

Сообщение ребёнка:
${message}

Краткое пояснение:
${summary || "—"}

⚠️ Требуется подключение взрослого.`;

      try {
        await sendWeb3FormsEmail("🚨 Срочное сообщение от Лисички", emailText);
      } catch (e) {
        console.error("web3forms:", e);
      }

      return new Response(
        JSON.stringify({
          ok: true,
          danger: true,
          alert_type: alertType,
          reply: DANGER_CHILD_REPLY,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        danger: false,
        alert_type: "none",
        reply: safeReply,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("ai-chat error:", e);
    return new Response(
      JSON.stringify({
        ok: false,
        danger: false,
        reply: "Что-то пошло не так. Попробуй ещё раз чуть позже.",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
