import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Lottie from 'lottie-react';
import {
  pickFoxOpening,
  getFoxFollowUpLines,
  FOX_SILENCE_NUDGE_MS,
  pickSilenceNudgeLine,
} from './foxDialogue.js';
import './app.css';
import foxChatPhoto from './лисичка аватар для чата.png';
import meditatingFoxAnimation from './src/assets/Meditating Fox.json';
import { notifyStaffStudentMessage } from './notifyEmail.js';

const uid = () => Math.random().toString(36).slice(2, 10);

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/** Демо-учётные сотрудника; в проде заменить проверкой на сервере */
const STAFF_LOGIN = 'Алдошина';
const STAFF_PASSWORD = 'помощь';

function avatarStorageKey(studentKey) {
  return `lisichka_avatar_${encodeURIComponent(studentKey)}`;
}

function readStoredAvatar(studentKey) {
  if (!studentKey || typeof localStorage === 'undefined') return undefined;
  try {
    return localStorage.getItem(avatarStorageKey(studentKey)) || undefined;
  } catch {
    return undefined;
  }
}

function writeStoredAvatar(studentKey, dataUrl) {
  if (!studentKey || typeof localStorage === 'undefined') return;
  try {
    if (dataUrl) localStorage.setItem(avatarStorageKey(studentKey), dataUrl);
    else localStorage.removeItem(avatarStorageKey(studentKey));
  } catch {
    /* квота или приватный режим */
  }
}

const STORAGE_CASES = 'lisichka_cases_v1';
const STORAGE_REGISTRY = 'lisichka_students_v1';
const STORAGE_SESSION = 'lisichka_session_v1';

function loadCases() {
  if (typeof localStorage === 'undefined') return seedOtherCases();
  try {
    const raw = localStorage.getItem(STORAGE_CASES);
    if (!raw) return seedOtherCases();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return seedOtherCases();
    return parsed;
  } catch {
    return seedOtherCases();
  }
}

function loadRegistry() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_REGISTRY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function upsertRegistryRecord(record) {
  if (typeof localStorage === 'undefined') return;
  try {
    const prev = loadRegistry();
    const next = prev.filter((r) => r.studentKey !== record.studentKey);
    next.push(record);
    localStorage.setItem(STORAGE_REGISTRY, JSON.stringify(next));
  } catch {
    /* квота */
  }
}

function normName(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Имя + код должны совпасть с записью при регистрации */
function findStudentByLogin(registry, nameRaw, codeRaw) {
  const code = codeRaw.trim();
  const name = normName(nameRaw);
  if (!code || !name) return null;
  for (const r of registry) {
    if (r.pin !== code) continue;
    const full = normName(`${r.first} ${r.last}`);
    const firstOnly = normName(r.first);
    if (full === name || firstOnly === name) return r;
    if (full.startsWith(name) && (full.length === name.length || full[name.length] === ' ')) return r;
  }
  return null;
}

function loadSession() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_SESSION);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveSession(payload) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_SESSION, JSON.stringify(payload));
  } catch {
    /* квота */
  }
}

function clearSession() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_SESSION);
  } catch {
    /* ignore */
  }
}

function buildInitialState() {
  const cases = loadCases();
  const registry = loadRegistry();
  const session = loadSession();

  const defaults = {
    cases,
    user: null,
    route: 'welcome',
    role: 'student',
    studentTab: 'chat',
    adminTab: 'queue',
    historyCaseId: null,
    adminCaseId: null,
    activeCaseId: null,
  };

  if (session?.kind === 'student' && session.studentKey) {
    const reg = registry.find((r) => r.studentKey === session.studentKey);
    if (reg) {
      const mine = cases.filter((c) => c.student === reg.studentKey).sort((a, b) => b.updatedAt - a.updatedAt);
      let activeCaseId = session.activeCaseId ?? null;
      if (activeCaseId && !mine.some((c) => c.id === activeCaseId)) {
        activeCaseId = mine[0]?.id ?? null;
      }
      return {
        ...defaults,
        user: {
          first: reg.first,
          last: reg.last,
          class: reg.class,
          code: reg.pin,
          studentKey: reg.studentKey,
          avatarDataUrl: readStoredAvatar(reg.studentKey),
        },
        route: 'main',
        role: 'student',
        studentTab: session.studentTab ?? 'chat',
        historyCaseId: session.historyCaseId ?? null,
        activeCaseId,
      };
    }
  }

  if (session?.kind === 'admin') {
    let adminCaseId = session.adminCaseId ?? null;
    if (adminCaseId && !cases.some((c) => c.id === adminCaseId)) adminCaseId = null;
    return {
      ...defaults,
      route: 'main',
      role: 'admin',
      adminTab: session.adminTab ?? 'queue',
      adminCaseId,
    };
  }

  return defaults;
}

const initialFox = () => ({
  id: uid(),
  from: 'fox',
  at: Date.now(),
  text: pickFoxOpening(),
});

const seedOtherCases = () => [
  {
    id: 'c-seed-1',
    student: 'Ученик 5«А»',
    status: 'new',
    urgent: true,
    updatedAt: Date.now() - 120000,
    messages: [
      { id: '1', from: 'user', at: Date.now() - 130000, text: 'Мне плохо, не могу сосредоточиться на уроке.' },
    ],
  },
  {
    id: 'c-seed-2',
    student: 'Ученик 5«В»',
    status: 'in_progress',
    urgent: false,
    updatedAt: Date.now() - 3600000,
    messages: [
      { id: '1', from: 'user', at: Date.now() - 3700000, text: 'Хочу поговорить о конфликте в классе.' },
      {
        id: '2',
        from: 'fox',
        at: Date.now() - 3600000,
        text: 'Спасибо за сообщение. Можешь добавить ещё пару слов, когда захочешь — я рядом.',
      },
    ],
  },
];

function IconChat({ active }) {
  return (
    <svg
      className={active ? 'app-icon app-icon--active' : 'app-icon'}
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M7 10h10M7 14h6M5 4h14a2 2 0 012 2v9a2 2 0 01-2 2h-4l-4 3v-3H5a2 2 0 01-2-2V6a2 2 0 012-2z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconHistory({ active }) {
  return (
    <svg
      className={active ? 'app-icon app-icon--active' : 'app-icon'}
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path d="M12 7v6l4 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function IconUser({ active }) {
  return (
    <svg
      className={active ? 'app-icon app-icon--active' : 'app-icon'}
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6 19c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconInbox({ active }) {
  return (
    <svg
      className={active ? 'app-icon app-icon--active' : 'app-icon'}
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path d="M4 6h16v12H4V6z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 10l8 5 8-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconSend() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const FOX_AVATAR_SIZE_CLASS = {
  36: 'fox-avatar--sm',
  48: 'fox-avatar--md',
  52: 'fox-avatar--chat',
  92: 'fox-avatar--xl',
};

/** Круглая маска вокруг Lottie (убирает квадратный фон композиции). */
function FoxLottieAvatar(props) {
  const { className, ...lottieProps } = props;
  return (
    <div className="fox-lottie-clip">
      <div className="fox-lottie-inner">
        <Lottie className={className ?? 'fox-lottie-canvas'} {...lottieProps} renderer="svg" />
      </div>
    </div>
  );
}

function FoxAvatar({ size = 48, variant = 'default' }) {
  const sz = FOX_AVATAR_SIZE_CLASS[size] || 'fox-avatar--md';
  if (variant === 'chat') {
    return (
      <div className={`fox-avatar fox-avatar--photo ${sz}`} role="img" aria-label="Лисичка">
        <img src={foxChatPhoto} alt="" className="fox-avatar__photo" draggable={false} />
      </div>
    );
  }
  return (
    <div className={`fox-avatar ${sz}`} role="img" aria-label="Лисичка">
      <svg width={size * 0.44} height={size * 0.44} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M12 5l2 4h4l-3 2.5 2 4-5-2-5 2 2-4-3-2.5h4l2-4z" fill="white" opacity="0.98" />
      </svg>
    </div>
  );
}

function StudentChatAvatar({ src }) {
  if (!src) return <div className="chat-row__spacer" aria-hidden />;
  return (
    <div className="student-chat-avatar">
      <img src={src} alt="" className="student-chat-avatar__img" draggable={false} />
    </div>
  );
}

function ChatMessageBubble({ isUser, children, animDelay = 0, studentAvatarUrl }) {
  return (
    <div
      className={isUser ? 'chat-row chat-row--user' : 'chat-row chat-row--fox'}
      style={{ '--msg-delay': `${animDelay}ms` }}
    >
      {!isUser ? <FoxAvatar size={36} variant="chat" /> : <StudentChatAvatar src={studentAvatarUrl} />}
      <div className={isUser ? 'chat-bubble chat-bubble--user' : 'chat-bubble chat-bubble--fox'}>{children}</div>
    </div>
  );
}

function Btn({ children, onClick, variant = 'primary', disabled, full, type = 'button' }) {
  const cls = ['btn', variant === 'primary' ? 'btn--primary' : 'btn--secondary', full ? 'btn--full' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}

function GhostBtn({ children, onClick }) {
  return (
    <button type="button" onClick={onClick} className="ghost-btn">
      {children}
    </button>
  );
}

function Field({ label, id, value, onChange, placeholder, type = 'text', autoComplete }) {
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="field__input"
      />
    </div>
  );
}

function Check({ id, checked, onChange, label }) {
  return (
    <label htmlFor={id} className="check">
      <input id={id} type="checkbox" checked={checked} onChange={onChange} className="check__input" />
      <span>{label}</span>
    </label>
  );
}

function Badge({ children, tone = 'neutral' }) {
  const toneClass = {
    neutral: 'badge--neutral',
    primary: 'badge--primary',
    ok: 'badge--ok',
    wait: 'badge--wait',
    danger: 'badge--danger',
  }[tone] || 'badge--neutral';
  return <span className={`badge ${toneClass}`}>{children}</span>;
}

function Page({ children, narrow }) {
  return (
    <div className="page">
      <div className={`page__inner ${narrow ? 'page__inner--narrow' : 'page__inner--wide'}`}>{children}</div>
    </div>
  );
}

function BottomNav({ items }) {
  return (
    <nav className="bottom-nav" aria-label="Навигация">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={it.onClick}
          aria-current={it.active ? 'page' : undefined}
          className={it.active ? 'bottom-nav__btn bottom-nav__btn--active' : 'bottom-nav__btn'}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </nav>
  );
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function statusBadgeStudent(status) {
  if (status === 'closed') return 'Уже поговорили';
  if (status === 'new') return 'Ждёт внимания';
  if (status === 'in_progress') return 'Я рядом';
  return 'На связи';
}

function statusBadgeAdmin(status) {
  if (status === 'closed') return 'Можно отпустить';
  if (status === 'new') return 'Только что';
  if (status === 'in_progress') return 'Отвечаю';
  return 'На связи';
}

export default function App() {
  const init = buildInitialState();

  const [route, setRoute] = useState(init.route);
  const [role, setRole] = useState(init.role);
  const [studentTab, setStudentTab] = useState(init.studentTab);
  const [adminTab, setAdminTab] = useState(init.adminTab);
  const [historyCaseId, setHistoryCaseId] = useState(init.historyCaseId);
  const [adminCaseId, setAdminCaseId] = useState(init.adminCaseId);

  const [user, setUser] = useState(init.user);
  const [reg, setReg] = useState({ first: '', last: '', class: '', pin: '', agreePd: false });
  const [login, setLogin] = useState({ name: '', code: '' });
  const [loginError, setLoginError] = useState('');
  const [adminStaff, setAdminStaff] = useState({ login: '', password: '' });
  const [adminStaffError, setAdminStaffError] = useState('');

  const [cases, setCases] = useState(init.cases);
  const [activeCaseId, setActiveCaseId] = useState(init.activeCaseId);

  const [chatInput, setChatInput] = useState('');
  const [chatStatus, setChatStatus] = useState('idle');
  const [adultOpen, setAdultOpen] = useState(false);
  const [adminReply, setAdminReply] = useState('');
  const [adminStatusPick, setAdminStatusPick] = useState('new');

  const activeCase = useMemo(() => cases.find((c) => c.id === activeCaseId) || null, [cases, activeCaseId]);
  const historyCase = useMemo(() => cases.find((c) => c.id === historyCaseId) || null, [cases, historyCaseId]);
  const adminCase = useMemo(() => cases.find((c) => c.id === adminCaseId) || null, [cases, adminCaseId]);

  useEffect(() => {
    if (adminCase) setAdminStatusPick(adminCase.status);
  }, [adminCaseId, adminCase]);

  const chatMessagesRef = useRef(null);
  const studentAvatarInputRef = useRef(null);
  const foxReplyTimeoutsRef = useRef([]);
  const [studentAvatarError, setStudentAvatarError] = useState('');
  const silenceNudgeTimerRef = useRef(null);
  const activeCaseIdRef = useRef(null);
  const silenceNudgeRotateRef = useRef(0);

  activeCaseIdRef.current = activeCaseId;

  useEffect(() => {
    return () => {
      foxReplyTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
      foxReplyTimeoutsRef.current = [];
      if (silenceNudgeTimerRef.current) {
        window.clearTimeout(silenceNudgeTimerRef.current);
        silenceNudgeTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_CASES, JSON.stringify(cases));
    } catch {
      /* квота */
    }
  }, [cases]);

  useEffect(() => {
    if (route === 'main' && role === 'student' && user?.studentKey) {
      saveSession({
        kind: 'student',
        studentKey: user.studentKey,
        activeCaseId,
        studentTab,
        historyCaseId,
      });
    } else if (route === 'main' && role === 'admin') {
      saveSession({
        kind: 'admin',
        adminTab,
        adminCaseId,
      });
    } else {
      clearSession();
    }
  }, [route, role, user, activeCaseId, studentTab, historyCaseId, adminTab, adminCaseId]);

  const clearSilenceNudgeTimer = useCallback(() => {
    if (silenceNudgeTimerRef.current) {
      window.clearTimeout(silenceNudgeTimerRef.current);
      silenceNudgeTimerRef.current = null;
    }
  }, []);

  const lastStudentChatMessage = activeCase?.messages?.[activeCase.messages.length - 1];
  const lastStudentChatKey = lastStudentChatMessage ? `${lastStudentChatMessage.id}-${lastStudentChatMessage.at}` : '';

  useEffect(() => {
    clearSilenceNudgeTimer();

    if (route !== 'main' || studentTab !== 'chat' || !activeCaseId || !activeCase || chatStatus === 'waiting') {
      return undefined;
    }

    const last = activeCase.messages[activeCase.messages.length - 1];
    if (!last || last.from !== 'fox' || last.silenceCheck) {
      return undefined;
    }

    const foxId = last.id;
    const elapsed = Date.now() - last.at;
    const delay = Math.max(0, FOX_SILENCE_NUDGE_MS - elapsed);

    silenceNudgeTimerRef.current = window.setTimeout(() => {
      silenceNudgeTimerRef.current = null;
      const caseId = activeCaseIdRef.current;

      setCases((prev) => {
        const c = prev.find((x) => x.id === caseId);
        if (!c) return prev;
        const l = c.messages[c.messages.length - 1];
        if (l.from === 'user' || l.id !== foxId || l.silenceCheck) return prev;
        const i = silenceNudgeRotateRef.current;
        silenceNudgeRotateRef.current = i + 1;
        const nudgeText = pickSilenceNudgeLine(i);
        return prev.map((caseItem) =>
          caseItem.id === caseId
            ? {
                ...caseItem,
                messages: [
                  ...caseItem.messages,
                  {
                    id: uid(),
                    from: 'fox',
                    at: Date.now(),
                    text: nudgeText,
                    silenceCheck: true,
                  },
                ],
                updatedAt: Date.now(),
              }
            : caseItem
        );
      });
    }, delay);

    return () => {
      clearSilenceNudgeTimer();
    };
  }, [route, studentTab, activeCaseId, lastStudentChatKey, chatStatus, activeCase, clearSilenceNudgeTimer]);

  useEffect(() => {
    if (route !== 'main' || studentTab !== 'chat' || !activeCaseId) return;
    const el = chatMessagesRef.current;
    if (!el) return;
    window.requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    });
  }, [route, studentTab, activeCaseId, activeCase?.messages?.length, chatStatus]);

  const myCases = useMemo(() => {
    if (!user) return [];
    return cases.filter((c) => c.student === user.studentKey || c.id === activeCaseId);
  }, [cases, user, activeCaseId]);

  const registerAndEnter = useCallback(() => {
    const first = reg.first.trim();
    const last = reg.last.trim();
    const cls = reg.class.trim();
    const studentKey = `${first} ${last} · ${cls}`;
    const id = uid();
    const nc = {
      id,
      student: studentKey,
      status: 'open',
      urgent: false,
      updatedAt: Date.now(),
      messages: [initialFox()],
    };
    const past = {
      id: uid(),
      student: studentKey,
      status: 'closed',
      urgent: false,
      updatedAt: Date.now() - 86400000 * 2,
      messages: [
        initialFox(),
        { id: uid(), from: 'user', at: Date.now() - 86400000 * 2 + 1000, text: 'Было тревожно перед контрольной.' },
        {
          id: uid(),
          from: 'fox',
          at: Date.now() - 86400000 * 2 + 2000,
          text: 'Спасибо, что поделился. Это важно. Я рядом — напиши, если снова накроет.',
        },
      ],
    };
    upsertRegistryRecord({
      studentKey,
      pin: reg.pin.trim(),
      first,
      last,
      class: cls,
    });
    setCases((prev) => {
      const seeds = prev.filter((c) => c.id.startsWith('c-seed'));
      return [nc, past, ...seeds];
    });
    setUser({
      first,
      last,
      class: cls,
      code: reg.pin.trim(),
      studentKey,
      avatarDataUrl: readStoredAvatar(studentKey),
    });
    setActiveCaseId(id);
    setRoute('main');
    setRole('student');
    setStudentTab('chat');
    setHistoryCaseId(null);
    setAdminCaseId(null);
    setChatStatus('idle');
  }, [reg]);

  const loginAndEnter = useCallback(() => {
    const registry = loadRegistry();
    const found = findStudentByLogin(registry, login.name, login.code);
    if (!found) {
      setLoginError('Не нашла такую пару «имя + код». Проверь написание или зайди через «Начать разговор».');
      return;
    }
    setLoginError('');
    const studentKey = found.studentKey;
    setUser({
      first: found.first,
      last: found.last,
      class: found.class,
      code: found.pin,
      studentKey,
      avatarDataUrl: readStoredAvatar(studentKey),
    });
    const mine = cases.filter((c) => c.student === studentKey).sort((a, b) => b.updatedAt - a.updatedAt);
    let nextActiveId = mine[0]?.id ?? null;
    if (!mine.length) {
      const id = uid();
      const nc = {
        id,
        student: studentKey,
        status: 'open',
        urgent: false,
        updatedAt: Date.now(),
        messages: [initialFox()],
      };
      setCases((prev) => [nc, ...prev]);
      nextActiveId = id;
    }
    setActiveCaseId(nextActiveId);
    setRoute('main');
    setRole('student');
    setStudentTab('chat');
    setHistoryCaseId(null);
    setAdminCaseId(null);
    setChatStatus('idle');
  }, [login, cases]);

  const appendMessage = useCallback((caseId, msg) => {
    setCases((prev) =>
      prev.map((c) => (c.id === caseId ? { ...c, messages: [...c.messages, msg], updatedAt: Date.now() } : c))
    );
  }, []);

  const updateCase = useCallback((caseId, patch) => {
    setCases((prev) => prev.map((c) => (c.id === caseId ? { ...c, ...patch, updatedAt: Date.now() } : c)));
  }, []);

  const handleStudentAvatarFile = useCallback((e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStudentAvatarError('Нужна картинка: JPG, PNG или WebP');
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setStudentAvatarError('Максимум 2 МБ — выбери файл поменьше');
      return;
    }
    setStudentAvatarError('');
    const reader = new FileReader();
    reader.onload = () => {
      const data = reader.result;
      if (typeof data !== 'string') return;
      setUser((u) => {
        if (!u?.studentKey) return u;
        writeStoredAvatar(u.studentKey, data);
        return { ...u, avatarDataUrl: data };
      });
    };
    reader.readAsDataURL(file);
  }, []);

  const clearStudentAvatar = useCallback(() => {
    setStudentAvatarError('');
    setUser((u) => {
      if (!u?.studentKey) return u;
      writeStoredAvatar(u.studentKey, null);
      return { ...u, avatarDataUrl: undefined };
    });
  }, []);

  const sendStudent = () => {
    const t = chatInput.trim();
    if (!t || !activeCaseId) return;
    foxReplyTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
    foxReplyTimeoutsRef.current = [];

    setChatInput('');
    appendMessage(activeCaseId, { id: uid(), from: 'user', at: Date.now(), text: t });
    notifyStaffStudentMessage({
      studentKey: user?.studentKey,
      text: t,
      caseId: activeCaseId,
    });
    setChatStatus('waiting');
    updateCase(activeCaseId, { status: 'in_progress' });

    const lines = getFoxFollowUpLines(t);
    const foxText = lines[0] ?? 'Я рядом. Напиши ещё, если захочешь 💬';
    const caseId = activeCaseId;

    const timeoutId = window.setTimeout(() => {
      appendMessage(caseId, { id: uid(), from: 'fox', at: Date.now(), text: foxText });
      setChatStatus('idle');
      updateCase(caseId, { status: 'open' });
    }, 1100);
    foxReplyTimeoutsRef.current.push(timeoutId);
  };

  const quickSay = (text) => {
    setChatInput(text);
  };

  const requestAdult = () => {
    if (!activeCaseId) return;
    updateCase(activeCaseId, { urgent: true, status: 'new' });
    appendMessage(activeCaseId, {
      id: uid(),
      from: 'fox',
      at: Date.now(),
      text: 'Я передала, что тебе нужна поддержка рядом. Я никуда не ухожу — пиши, если снова станет тяжело 💬',
    });
    setAdultOpen(false);
  };

  const sendAdminReply = () => {
    const t = adminReply.trim();
    if (!t || !adminCaseId) return;
    appendMessage(adminCaseId, { id: uid(), from: 'fox', at: Date.now(), text: t });
    updateCase(adminCaseId, { status: adminStatusPick });
    setAdminReply('');
  };

  const submitAdminStaffLogin = () => {
    const l = adminStaff.login.trim();
    const p = adminStaff.password;
    if (l === STAFF_LOGIN && p === STAFF_PASSWORD) {
      setAdminStaffError('');
      setAdminStaff({ login: '', password: '' });
      setRole('admin');
      setRoute('main');
      setAdminTab('queue');
      setAdminCaseId(null);
      setAdminReply('');
    } else {
      setAdminStaffError('Неверный логин или пароль');
    }
  };

  const regOk = reg.first.trim() && reg.last.trim() && reg.class.trim() && reg.pin.trim().length >= 4 && reg.agreePd;

  if (route === 'welcome') {
    return (
      <Page narrow>
        <div className="welcome">
          <div className="welcome__hero-wrap">
            <div className="welcome__hero-slot">
              <FoxLottieAvatar animationData={meditatingFoxAnimation} loop aria-label="Лисичка" />
            </div>
          </div>
          <h1 className="welcome__title">Лисичка рядом</h1>
          <p className="welcome__lead">
            Необязательно сразу объяснять всё.
            <br />
            <br />
            Можно написать коротко: «мне грустно», «мне страшно», «мне нужна помощь». Я рядом.
          </p>
          <div className="welcome__actions">
            <Btn full onClick={() => setRoute('register')}>
              Начать разговор
            </Btn>
            <GhostBtn onClick={() => setRoute('login')}>У меня уже есть мой код</GhostBtn>
          </div>
          <p className="welcome__staff-wrap">
            <button type="button" className="welcome__staff-link" onClick={() => setRoute('admin-login')}>
              Вход для сотрудника
            </button>
          </p>
        </div>
      </Page>
    );
  }

  if (route === 'register') {
    return (
      <Page narrow>
        <button type="button" onClick={() => setRoute('welcome')} className="back-link">
          ← к Лисичке
        </button>
        <h2 className="h2">Как тебя зовут?</h2>
        <p className="muted">Заполни поля — и мы уже вместе в чате</p>
        <div className="card">
          <Field label="Имя" id="f1" value={reg.first} onChange={(e) => setReg({ ...reg, first: e.target.value })} placeholder="Введи имя" />
          <Field label="Фамилия" id="f2" value={reg.last} onChange={(e) => setReg({ ...reg, last: e.target.value })} placeholder="Введи фамилию" />
          <Field label="Класс" id="f3" value={reg.class} onChange={(e) => setReg({ ...reg, class: e.target.value })} placeholder="Например, 5«А»" />
          <Field
            label="Придумай код для входа"
            id="f4"
            type="password"
            value={reg.pin}
            onChange={(e) => setReg({ ...reg, pin: e.target.value })}
            placeholder="Запомни его — по нему ты зайдёшь снова"
          />
          <div className="field-block">
            <Check
              id="ag"
              checked={reg.agreePd}
              onChange={(e) => setReg({ ...reg, agreePd: e.target.checked })}
              label="Даю согласие на обработку персональных данных"
            />
          </div>
          <Btn full disabled={!regOk} onClick={registerAndEnter}>
            Заходим в чат вместе
          </Btn>
        </div>
      </Page>
    );
  }

  if (route === 'login') {
    return (
      <Page narrow>
        <button type="button" onClick={() => setRoute('welcome')} className="back-link">
          ← к Лисичке
        </button>
        <h2 className="h2">С возвращением 💬</h2>
        <p className="muted">То же имя и фамилия, что при регистрации, и твой код</p>
        <div className="card">
          <Field
            label="Как тебя зовут?"
            id="ln"
            value={login.name}
            onChange={(e) => {
              setLoginError('');
              setLogin({ ...login, name: e.target.value });
            }}
            placeholder="Имя и фамилия, как при регистрации"
          />
          <Field
            label="Твой код"
            id="lc"
            type="password"
            value={login.code}
            onChange={(e) => {
              setLoginError('');
              setLogin({ ...login, code: e.target.value });
            }}
            placeholder="Тот самый, что ты придумал"
          />
          {loginError ? <p className="profile-avatar-error">{loginError}</p> : null}
          <Btn full onClick={loginAndEnter}>
            Зайти в чат
          </Btn>
        </div>
      </Page>
    );
  }

  if (route === 'admin-login') {
    return (
      <Page narrow>
        <button type="button" onClick={() => setRoute('welcome')} className="back-link">
          ← к Лисичке
        </button>
        <h2 className="h2">Вход для сотрудника</h2>
        <p className="muted">Только для психолога или доверенного взрослого из школы</p>
        <div className="card">
          <Field
            label="Логин"
            id="adl"
            autoComplete="username"
            value={adminStaff.login}
            onChange={(e) => {
              setAdminStaffError('');
              setAdminStaff({ ...adminStaff, login: e.target.value });
            }}
            placeholder="Логин"
          />
          <Field
            label="Пароль"
            id="adp"
            type="password"
            autoComplete="current-password"
            value={adminStaff.password}
            onChange={(e) => {
              setAdminStaffError('');
              setAdminStaff({ ...adminStaff, password: e.target.value });
            }}
            placeholder="Пароль"
          />
          {adminStaffError ? <p className="profile-avatar-error">{adminStaffError}</p> : null}
          <Btn full onClick={submitAdminStaffLogin}>
            Войти
          </Btn>
        </div>
      </Page>
    );
  }

  if (route === 'main' && role === 'student' && historyCaseId && historyCase) {
    return (
      <Page narrow>
        <header className="header-row">
          <button type="button" onClick={() => setHistoryCaseId(null)} className="icon-btn" aria-label="Назад">
            ←
          </button>
          <div>
            <div className="header-row__title">Наш разговор</div>
            <div className="header-row__meta">{formatTime(historyCase.updatedAt)}</div>
          </div>
        </header>
        <div className="thread-card">
          {historyCase.messages.map((m, idx) => {
            if (m.from === 'system')
              return (
                <div key={m.id} className="msg-system" style={{ '--msg-delay': `${idx * 30}ms` }}>
                  {m.text}
                </div>
              );
            const isUser = m.from === 'user';
            return (
              <ChatMessageBubble key={m.id} isUser={isUser} animDelay={idx * 40} studentAvatarUrl={user?.avatarDataUrl}>
                {m.text}
              </ChatMessageBubble>
            );
          })}
        </div>
      </Page>
    );
  }

  if (route === 'main' && role === 'student' && studentTab === 'chat' && activeCase) {
    const canSend = chatInput.trim() && chatStatus !== 'waiting';
    return (
      <Page narrow>
        <div className="chat-layout">
          <header className="chat-header">
            <div className="chat-header__main">
              <FoxAvatar size={52} variant="chat" />
              <div className="chat-header__titles">
                <div className="chat-header__name">Лисичка рядом</div>
                <div className={chatStatus === 'waiting' ? 'chat-header__status chat-header__status--waiting' : 'chat-header__status'}>
                  {chatStatus === 'waiting' ? 'Сейчас отвечу…' : 'Я рядом с тобой'}
                </div>
              </div>
            </div>
            <button type="button" aria-label="Профиль" onClick={() => setStudentTab('profile')} className="profile-icon-btn">
              {user?.avatarDataUrl ? (
                <img src={user.avatarDataUrl} alt="" className="profile-icon-btn__img" draggable={false} />
              ) : (
                <IconUser active />
              )}
            </button>
          </header>

          <div ref={chatMessagesRef} className="chat-scroll">
            {activeCase.urgent ? (
              <div className="chat-scroll__badge-row">
                <Badge tone="danger">Срочно</Badge>
              </div>
            ) : null}
            {activeCase.messages.map((m, idx) => {
              if (m.from === 'system')
                return (
                  <div key={m.id} className="msg-system" style={{ '--msg-delay': `${idx * 30}ms` }}>
                    {m.text}
                  </div>
                );
              const isUser = m.from === 'user';
              return (
                <ChatMessageBubble key={m.id} isUser={isUser} animDelay={idx * 55} studentAvatarUrl={user?.avatarDataUrl}>
                  {m.text}
                </ChatMessageBubble>
              );
            })}
            {chatStatus === 'waiting' ? (
              <div className="typing-row">
                <span className="typing-row__dots">
                  <span className="typing-dot typing-dot--1" />
                  <span className="typing-dot typing-dot--2" />
                  <span className="typing-dot typing-dot--3" />
                </span>
                <span className="typing-row__label">Лисичка печатает…</span>
              </div>
            ) : null}
          </div>

          <div className="chat-footer">
            <div className="chips-row">
              {['Мне грустно', 'Мне тревожно', 'Хочу выговориться', 'Нужна помощь'].map((q) => (
                <button key={q} type="button" onClick={() => quickSay(q)} className="chip-btn">
                  {q}
                </button>
              ))}
            </div>

            <div className="input-row">
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (canSend) sendStudent();
                  }
                }}
                placeholder="Напиши, как тебе сейчас..."
                rows={2}
                className="chat-textarea"
              />
              <button type="button" aria-label="Отправить" disabled={!canSend} onClick={sendStudent} className="send-btn">
                <IconSend />
              </button>
            </div>

            <Btn variant="secondary" full onClick={() => setAdultOpen(true)}>
              Попросить помощи
            </Btn>
          </div>
        </div>

        {adultOpen ? (
          <div role="dialog" aria-modal="true" className="modal-backdrop" onClick={() => setAdultOpen(false)}>
            <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="modal-sheet__title">Хочешь, я помогу позвать взрослого, который сможет помочь?</div>
              <p className="modal-sheet__text">
                Я могу передать это, чтобы тебе помогли быстрее.
                <br />
                <br />
                Прочитают только те, кто может помочь.
              </p>
              <div className="modal-sheet__actions">
                <Btn variant="secondary" full onClick={() => setAdultOpen(false)}>
                  Пока нет
                </Btn>
                <Btn full onClick={requestAdult}>
                  Да, позови
                </Btn>
              </div>
            </div>
          </div>
        ) : null}

        <BottomNav
          items={[
            { key: 'c', label: 'Чат', icon: <IconChat active />, active: true, onClick: () => {} },
            {
              key: 'h',
              label: 'Память',
              icon: <IconHistory active={false} />,
              active: false,
              onClick: () => setStudentTab('history'),
            },
            {
              key: 'p',
              label: 'Обо мне',
              icon: <IconUser active={false} />,
              active: false,
              onClick: () => setStudentTab('profile'),
            },
          ]}
        />
      </Page>
    );
  }

  if (route === 'main' && role === 'student' && studentTab === 'history') {
    const list = myCases.length ? myCases : cases.slice(0, 3);
    return (
      <Page narrow>
        <h2 className="h2 h2--mb-sm">Память нашего чата</h2>
        <p className="muted muted--tight">Всё, о чём мы уже успели поговорить</p>
        <div className="list-stack">
          {list.map((c) => {
            const preview = c.messages.filter((m) => m.from === 'user').pop()?.text || 'Начали разговор';
            return (
              <button key={c.id} type="button" onClick={() => setHistoryCaseId(c.id)} className="history-card">
                <div className="history-card__top">
                  <span className="history-card__time">{formatTime(c.updatedAt)}</span>
                  <div className="history-card__badges">
                    {c.urgent ? <Badge tone="danger">Срочно</Badge> : null}
                    <Badge tone={c.status === 'closed' ? 'neutral' : 'primary'}>{statusBadgeStudent(c.status)}</Badge>
                  </div>
                </div>
                <div className="history-card__preview">{preview}</div>
              </button>
            );
          })}
        </div>
        <BottomNav
          items={[
            { key: 'c', label: 'Чат', icon: <IconChat active={false} />, active: false, onClick: () => setStudentTab('chat') },
            { key: 'h', label: 'Память', icon: <IconHistory active />, active: true, onClick: () => {} },
            {
              key: 'p',
              label: 'Обо мне',
              icon: <IconUser active={false} />,
              active: false,
              onClick: () => setStudentTab('profile'),
            },
          ]}
        />
      </Page>
    );
  }

  if (route === 'main' && role === 'student' && studentTab === 'profile') {
    return (
      <Page narrow>
        <h2 className="h2 h2--mb-lg">Обо мне</h2>
        <div className="card profile-card">
          <div className="profile-card__user">
            <div className="profile-avatar-wrap">
              {user?.avatarDataUrl ? (
                <img src={user.avatarDataUrl} alt="" className="profile-avatar-img" draggable={false} />
              ) : (
                <div className="profile-avatar-initials">{(user?.first?.[0] || 'Я') + (user?.last?.[0] || '')}</div>
              )}
            </div>
            <div>
              <div className="profile-card__name">
                {user?.first} {user?.last}
              </div>
              <div className="profile-card__class">
                Класс: {user?.class?.trim() ? user.class : '—'}
              </div>
              <div className="profile-card__code">Код для входа: {user?.code}</div>
            </div>
          </div>
          <div className="profile-avatar-actions">
            <input
              ref={studentAvatarInputRef}
              type="file"
              accept="image/*"
              className="file-input-hidden"
              aria-label="Выбрать аватарку"
              onChange={handleStudentAvatarFile}
            />
            <Btn variant="secondary" type="button" full onClick={() => studentAvatarInputRef.current?.click()}>
              {user?.avatarDataUrl ? 'Сменить аватарку' : 'Поставить аватарку'}
            </Btn>
            {user?.avatarDataUrl ? <GhostBtn onClick={clearStudentAvatar}>Убрать фото</GhostBtn> : null}
          </div>
          {studentAvatarError ? <p className="profile-avatar-error">{studentAvatarError}</p> : null}
        </div>

        <Btn
          variant="secondary"
          full
          onClick={() => {
            setRoute('welcome');
            setUser(null);
            setActiveCaseId(null);
            setStudentTab('chat');
            clearSession();
          }}
        >
          Выйти из аккаунта
        </Btn>

        <BottomNav
          items={[
            { key: 'c', label: 'Чат', icon: <IconChat active={false} />, active: false, onClick: () => setStudentTab('chat') },
            {
              key: 'h',
              label: 'Память',
              icon: <IconHistory active={false} />,
              active: false,
              onClick: () => setStudentTab('history'),
            },
            { key: 'p', label: 'Обо мне', icon: <IconUser active />, active: true, onClick: () => {} },
          ]}
        />
      </Page>
    );
  }

  if (route === 'main' && role === 'admin' && adminCaseId && adminCase) {
    return (
      <Page narrow={false}>
        <div className="admin-wrap">
          <button type="button" onClick={() => setAdminCaseId(null)} className="icon-btn icon-btn--lg">
            ←
          </button>
          <div className="admin-title-row">
            <h2>{adminCase.student}</h2>
            {adminCase.urgent ? <Badge tone="danger">Срочно</Badge> : null}
          </div>

          <div>
            <label className="form-label">Как идёт разговор</label>
            <select
              value={adminStatusPick}
              onChange={(e) => {
                setAdminStatusPick(e.target.value);
                updateCase(adminCaseId, { status: e.target.value });
              }}
              className="admin-select"
            >
              <option value="new">Только что написали</option>
              <option value="in_progress">Я отвечаю</option>
              <option value="open">Мы на связи</option>
              <option value="closed">Можно отпустить</option>
            </select>
          </div>

          <div className="admin-thread">
            {adminCase.messages.map((m, idx) => {
              if (m.from === 'system')
                return (
                  <div key={m.id} className="msg-system">
                    {m.text}
                  </div>
                );
              const isUser = m.from === 'user';
              return (
                <ChatMessageBubble key={m.id} isUser={isUser} animDelay={idx * 35}>
                  {m.text}
                </ChatMessageBubble>
              );
            })}
          </div>

          <label className="form-label">Напиши от Лисички</label>
          <textarea
            value={adminReply}
            onChange={(e) => setAdminReply(e.target.value)}
            rows={4}
            placeholder="Тёплые слова, как будто это я…"
            className="admin-textarea"
          />
          <Btn full onClick={sendAdminReply} disabled={!adminReply.trim()}>
            Отправить от Лисички
          </Btn>
        </div>
      </Page>
    );
  }

  if (route === 'main' && role === 'admin' && adminTab === 'queue') {
    return (
      <Page narrow={false}>
        <div className="admin-wrap">
          <h2 className="h2 h2--mb-sm">Чаты с Лисичкой</h2>
          <p className="muted muted--tight muted--flush">Кому сейчас хочется, чтобы кто-то услышал</p>
          <div className="list-stack list-stack--mt">
            {cases.map((c) => {
              const last = c.messages[c.messages.length - 1];
              const preview = last?.from === 'user' ? last.text : c.messages.filter((m) => m.from === 'user').pop()?.text || '—';
              return (
                <button key={c.id} type="button" onClick={() => setAdminCaseId(c.id)} className="history-card">
                  <div className="history-card__top">
                    <span className="history-card__time">{c.student}</span>
                    <div className="history-card__badges">
                      {c.urgent ? <Badge tone="danger">Срочно</Badge> : null}
                      <Badge tone={c.status === 'closed' ? 'neutral' : c.status === 'new' ? 'wait' : 'primary'}>
                        {statusBadgeAdmin(c.status)}
                      </Badge>
                    </div>
                  </div>
                  <div className="history-card__preview">{preview}</div>
                </button>
              );
            })}
          </div>
        </div>
        <BottomNav
          items={[
            { key: 'q', label: 'Чаты', icon: <IconInbox active />, active: true, onClick: () => {} },
            {
              key: 'p',
              label: 'О себе',
              icon: <IconUser active={false} />,
              active: false,
              onClick: () => setAdminTab('profile'),
            },
          ]}
        />
      </Page>
    );
  }

  if (route === 'main' && role === 'admin' && adminTab === 'profile') {
    return (
      <Page narrow>
        <h2 className="h2 h2--mb-lg">Ты помогаешь Лисичке</h2>
        <p className="admin-staff-hint">
          Здесь режим сотрудника. Чтобы вернуться к детскому экрану, выйди и зайди как ученик со своим кодом.
        </p>
        <Btn
          variant="secondary"
          full
          onClick={() => {
            setRoute('welcome');
            setRole('student');
            setAdminTab('queue');
            setAdminCaseId(null);
            setAdminReply('');
            clearSession();
          }}
        >
          Выйти из режима сотрудника
        </Btn>
        <BottomNav
          items={[
            {
              key: 'q',
              label: 'Чаты',
              icon: <IconInbox active={false} />,
              active: false,
              onClick: () => setAdminTab('queue'),
            },
            { key: 'p', label: 'О себе', icon: <IconUser active />, active: true, onClick: () => {} },
          ]}
        />
      </Page>
    );
  }

  if (route === 'main' && role === 'student' && studentTab === 'chat' && !activeCase) {
    return (
      <Page narrow>
        <p className="empty-state">Ой, чат куда-то потерялся. Давай вернёмся к Лисичке с самого начала.</p>
        <Btn full onClick={() => setRoute('welcome')}>
          К Лисичке
        </Btn>
      </Page>
    );
  }

  return null;
}
