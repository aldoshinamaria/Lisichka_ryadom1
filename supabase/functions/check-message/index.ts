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

function uchenikLineForEmail(row: StudentRow | null): string {
  if (!row) {
    return "Профиль ученика в базе не найден";
  }
  const s = String(row.surname ?? "").trim();
  const n = String(row.name ?? "").trim();
  const c = String(row.class_name ?? "").trim();
  const fio = [s, n].filter(Boolean).join(" ");
  if (fio && c) {
    return `Ученик ${fio}, ${c}`;
  }
  if (fio) {
    return `Ученик ${fio}`;
  }
  if (c) {
    return `Ученик, ${c}`;
  }
  return "Ученик: в карточке нет фамилии, имени и класса";
}

function getSupabaseForStudents() {
  const url = Deno.env.get("SUPABASE_URL");
  const key =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) return null;
  return createClient(url, key);
}

async function getStudent(
  studentId: unknown
): Promise<StudentRow | null> {
  const supabase = getSupabaseForStudents();
  if (!supabase) {
    return null;
  }
  if (studentId === null || studentId === undefined || studentId === "") {
    return null;
  }
  const { data, error } = await supabase
    .from("students")
    .select("surname, name, class_name")
    .eq("id", studentId)
    .maybeSingle();
  if (error) {
    console.error("students lookup error:", error);
    return null;
  }
  if (!data) {
    return null;
  }
  return data as StudentRow;
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
    const studentId = body.student_id;
    const eventType =
      typeof body.event_type === "string" ? body.event_type : undefined;

    console.log("student_id:", studentId);
    console.log("SERVER BODY:", body);
    console.log("SERVER MESSAGE:", message);

    if (eventType === "child_pressed_help") {
      try {
        const student = await getStudent(studentId);
        const line = uchenikLineForEmail(student);
        const lead = student
          ? `${line} нажал кнопку "Попросить помощи".`
          : `Профиль в базе не найден. Ребёнок нажал кнопку "Попросить помощи".`;
        console.log("student row:", student);
        const adminStudentUrl = buildAdminStudentUrl(studentId);
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
        JSON.stringify({ ok: true, danger: false, message: "Сообщение безопасно" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const lowerMessage = String(message).toLowerCase();

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
        const student = await getStudent(studentId);
        const line = uchenikLineForEmail(student);
        const textMsg = String(message);
        const lead = student
          ? `${line} написал:`
          : `Профиль в базе не найден. Сообщение:`;
        console.log("student row:", student);
        const adminStudentUrl = buildAdminStudentUrl(studentId);
        const emailBody = `Срочное сообщение от Лисички.

${lead}

"${textMsg}"

⚠️ Требуется внимание взрослого.

Открыть профиль ученика:
${adminStudentUrl}`;
        await sendWeb3FormsEmail("🚨 Срочное сообщение от Лисички", emailBody);
      } catch (e) {
        console.error("web3forms email error:", e);
      }
    }

    const payload = isDanger
      ? { ok: true, danger: true, message: "⚠️ Обнаружен тревожный сигнал" }
      : { ok: true, danger: false, message: "Сообщение безопасно" };

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
