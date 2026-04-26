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

    // ⚠️ тревожные слова (подстрока в тексте, без проверки при вводе — только в Edge Function)
    const dangerSubstrings = [
      "грустно",
      "тревожно",
      "плачу",
      "боюсь",
      "страшно",
      "меня бьют",
      "обзывают",
      "не хочу жить",
      "помогите",
      "мне плохо",
      "плохо", // осторожно: не срабатывать на «неплохо» — обработаем отдельно
      "издеваются",
      "одиноко",
    ];

    const lowerMessage = raw.toLowerCase();

    const isDanger =
      dangerSubstrings.some((w) => {
        if (w === "плохо") {
          if (lowerMessage.includes("неплохо")) return false;
          return lowerMessage.includes("плохо");
        }
        return lowerMessage.includes(w);
      });

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
