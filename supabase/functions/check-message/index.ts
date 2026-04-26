// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
    let body: { message?: unknown };
    try {
      body = (await req.json()) as { message?: unknown };
    } catch {
      return new Response(
        JSON.stringify({ ok: false, danger: false, message: "Invalid JSON" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const raw = typeof body?.message === "string" ? body.message : String(body?.message ?? "");

    // ⚠️ список тревожных слов (можно расширять)
    const dangerWords = [
      "боюсь",
      "меня бьют",
      "обзывают",
      "не хочу жить",
      "страшно",
      "помогите",
      "мне плохо",
      "издеваются",
      "плачу",
      "одиноко",
    ];

    const lowerMessage = raw.toLowerCase();

    const isDanger = dangerWords.some((word) => lowerMessage.includes(word));

    return new Response(
      JSON.stringify({
        ok: true,
        danger: isDanger,
        message: isDanger
          ? "⚠️ Обнаружен тревожный сигнал"
          : "Сообщение безопасно",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(
      JSON.stringify({ ok: false, danger: false, message: "Server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
