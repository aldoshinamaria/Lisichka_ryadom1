/**
 * Уведомления на почту сотруднику через https://web3forms.com (бесплатно, без своего сервера).
 *
 * 1) Зайдите на web3forms.com → Create form → укажите получателя Koshka501506@yandex.ru
 * 2) Скопируйте Access Key
 * 3) В корне проекта создайте файл .env с строкой:
 *    VITE_WEB3FORMS_ACCESS_KEY=ваш_ключ
 * 4) Для GitHub Actions: Settings → Secrets → добавьте VITE_WEB3FORMS_ACCESS_KEY
 *
 * Без ключа письма не отправляются (приложение работает как раньше).
 */

const WEB3FORMS_URL = 'https://api.web3forms.com/submit';

export function notifyStaffStudentMessage({ studentKey, text, caseId }) {
  const accessKey = import.meta.env.VITE_WEB3FORMS_ACCESS_KEY;
  if (!accessKey || typeof fetch === 'undefined') return;

  const sk = studentKey?.trim() || '—';
  const msg = (text ?? '').trim() || '—';
  const cid = caseId?.trim() || '—';

  const body = {
    access_key: accessKey,
    subject: `Лисичка: сообщение от ${sk.slice(0, 60)}`,
    from_name: 'Лисичка рядом',
    message: [
      'Новое сообщение ученика в приложении «Лисичка рядом».',
      '',
      `Ученик: ${sk}`,
      `ID чата: ${cid}`,
      '',
      'Текст сообщения:',
      msg,
    ].join('\n'),
  };

  void fetch(WEB3FORMS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  }).catch(() => {
    /* сеть / блокировщики — не мешаем чату */
  });
}

/** Отдельное письмо сотруднику при checkMessage.danger (тревожный сигнал) */
export function notifyStaffDangerAlert({ studentKey, text, caseId }) {
  const accessKey = import.meta.env.VITE_WEB3FORMS_ACCESS_KEY;
  if (!accessKey || typeof fetch === 'undefined') return;

  const sk = studentKey?.trim() || '—';
  const msg = (text ?? '').trim() || '—';
  const cid = caseId?.trim() || '—';

  const body = {
    access_key: accessKey,
    subject: `⚠️ Лисичка: тревожный сигнал — ${sk.slice(0, 50)}`,
    from_name: 'Лисичка рядом',
    message: [
      'Обнаружен тревожный сигнал по тексту ученика (проверка check-message).',
      '',
      `Ученик: ${sk}`,
      `ID чата: ${cid}`,
      '',
      'Сообщение ученика:',
      msg,
    ].join('\n'),
  };

  void fetch(WEB3FORMS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  }).catch(() => {});
}
