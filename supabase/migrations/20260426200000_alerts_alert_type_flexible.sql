-- Типы сигналов от ИИ (bullying, family_abuse, …) и существующие значения
-- Выполни в SQL Editor, если insert в alerts падает из‑за enum/ограничения
alter table if exists public.alerts
  alter column alert_type type text
  using alert_type::text;
