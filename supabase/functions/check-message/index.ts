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

    const message = body.message || "";

    console.log("SERVER BODY:", body);
    console.log("SERVER MESSAGE:", message);

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
