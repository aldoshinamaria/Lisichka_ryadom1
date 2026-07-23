import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Lottie from 'lottie-react';
import {
  pickFoxOpening,
  FOX_SILENCE_NUDGE_MS,
  pickSilenceNudgeLine,
} from './foxDialogue.js';
import './app.css';
import foxChatPhoto from './лисичка аватар для чата.png';
import meditatingFoxAnimation from './src/assets/Meditating Fox.json';
import { notifyStaffStudentMessage } from './notifyEmail.js';
import { checkMessage } from "./api";
import { insertStudentAndGetId, findStudentIdByLogin } from './studentsDb.js';
import { hashPassword, verifyPassword } from './auth.js';
import { deleteAlertById, fetchAlerts, insertAlert, patchAlertStatus } from './alerts.js';
import {
  deleteMessagesByCaseId,
  fetchStudentsForStaff,
  hasSupabase,
  persistMessage,
  registerStudentAccount,
  serverStudentToLocal,
  signInStaffAccount,
  signInStudentAccount,
  signOutAccount,
  syncStaffCasesFromServer,
  syncStudentCasesFromServer,
  updateStudentProfileOnServer,
} from './serverStore.js';

const uid = () => Math.random().toString(36).slice(2, 10);

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

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
/** Версия 2: surname, name, className, login, passwordHash, createdAt — без pin/first/last */
const STORAGE_REGISTRY = 'lisichka_students_v2';
const STORAGE_SESSION = 'lisichka_session_v1';

function normLogin(s) {
  return String(s || '')
    .trim()
    .toLowerCase();
}

/** Подпись в списке чатов (админ) и заголовок открытого чата */
function caseStudentLabel(studentKey) {
  const r = loadRegistry().find((x) => x.studentKey === studentKey);
  if (r) return `${r.surname} ${r.name} · ${r.className}`;
  return studentKey;
}

function loadCases() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_CASES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    const cleaned = parsed.filter(
      (c) => c && typeof c === 'object' && !String(c.id || '').startsWith('c-seed')
    );
    if (cleaned.length !== parsed.length) {
      try {
        localStorage.setItem(STORAGE_CASES, JSON.stringify(cleaned));
      } catch {
        /* квота */
      }
    }
    return cleaned;
  } catch {
    return [];
  }
}

function loadRegistry() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_REGISTRY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r) => r && typeof r === 'object' && r.passwordHash && typeof r.login === 'string' && r.studentKey
    );
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

function setLocalStudentId(id) {
  if (id == null || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem('student_id', String(id));
  } catch {
    /* квота / приватный режим */
  }
}

function getLocalStudentId() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const id = localStorage.getItem('student_id');
    return id && id !== '1' ? id : null;
  } catch {
    return null;
  }
}

function setRegistryDbStudentId(studentKey, dbStudentId) {
  if (typeof localStorage === 'undefined' || !studentKey || dbStudentId == null) return;
  try {
    const prev = loadRegistry();
    const next = prev.map((r) =>
      r.studentKey === studentKey ? { ...r, dbStudentId } : r
    );
    localStorage.setItem(STORAGE_REGISTRY, JSON.stringify(next));
  } catch {
    /* квота */
  }
}

function updateStudentPasswordHash(studentKey, passwordHash) {
  if (typeof localStorage === 'undefined') return;
  const now = Date.now();
  try {
    const prev = loadRegistry();
    const next = prev.map((r) =>
      r.studentKey === studentKey ? { ...r, passwordHash, adminProfileUpdatedAt: now } : r
    );
    localStorage.setItem(STORAGE_REGISTRY, JSON.stringify(next));
  } catch {
    /* квота */
  }
}

/** Сохранение фамилии, имени, класса; фиксирует актуальные дата и время */
function updateStudentProfileFields(studentKey, fields) {
  if (typeof localStorage === 'undefined') return;
  const now = Date.now();
  try {
    const prev = loadRegistry();
    const next = prev.map((r) =>
      r.studentKey === studentKey
        ? { ...r, ...fields, adminProfileUpdatedAt: now }
        : r
    );
    localStorage.setItem(STORAGE_REGISTRY, JSON.stringify(next));
  } catch {
    /* квота */
  }
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
    if (reg && reg.passwordHash) {
      if (reg.dbStudentId) {
        setLocalStudentId(reg.dbStudentId);
      }
      const mine = cases.filter((c) => c.student === reg.studentKey).sort((a, b) => b.updatedAt - a.updatedAt);
      let activeCaseId = session.activeCaseId ?? null;
      if (activeCaseId && !mine.some((c) => c.id === activeCaseId)) {
        activeCaseId = mine[0]?.id ?? null;
      }
      return {
        ...defaults,
        user: {
          name: reg.name,
          surname: reg.surname,
          className: reg.className,
          login: reg.login,
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

function IconBell({ active }) {
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
        d="M12 22a2 2 0 001.8-1.1h-3.6A2 2 0 0012 22zm7-4v-4a6 6 0 00-3.5-5.4V10a3.5 3.5 0 00-7 0v2.6A6 6 0 005 18v2h14v-2z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
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

function alertSeenBadge(s) {
  if (s === 'new') return { tone: 'wait', children: 'Новое' };
  return { tone: 'neutral', children: 'Просмотрено' };
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
  const [reg, setReg] = useState({
    name: '',
    surname: '',
    className: '',
    login: '',
    password: '',
    agreePd: false,
  });
  const [registerError, setRegisterError] = useState('');
  const [login, setLogin] = useState({ login: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [adminRegistryTick, setAdminRegistryTick] = useState(0);
  const [adminResetPw, setAdminResetPw] = useState({}); // studentKey -> вводимый новый пароль
  const [adminResetError, setAdminResetError] = useState('');
  /** Черновики фамилии/имени/класса до «Сохранить»; ключ — studentKey */
  const [adminEditDraft, setAdminEditDraft] = useState({});
  const [adminProfileError, setAdminProfileError] = useState('');
  const [adminStaff, setAdminStaff] = useState({ login: '', password: '' });
  const [adminStaffError, setAdminStaffError] = useState('');

  const [adminAlertsFromDb, setAdminAlertsFromDb] = useState([]);

  const [cases, setCases] = useState(init.cases);
  const [activeCaseId, setActiveCaseId] = useState(init.activeCaseId);

  const [chatInput, setChatInput] = useState('');
  const [chatStatus, setChatStatus] = useState('idle');
  const [adultOpen, setAdultOpen] = useState(false);
  /** Модалка «позвать взрослого» после ответа API, иначе — по кнопке «Попросить помощи» */
  const [adultFromDanger, setAdultFromDanger] = useState(false);
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
  const messageDangerFromApiRef = useRef(false);

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

  /** Подставить кейсы ученика с сервера, остальные (чужие) оставить в кэше. */
  const applyStudentServerCases = useCallback((studentKey, serverCases) => {
    const key = normLogin(studentKey);
    setCases((prev) => {
      const others = prev.filter(
        (c) => c.student !== key && !String(c.id || '').startsWith('c-seed')
      );
      return [...serverCases, ...others].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    });
  }, []);

  const syncStudentCases = useCallback(
    async (studentKey, studentId, localSnapshot) => {
      if (!studentKey) return [];
      const snap = localSnapshot || loadCases();
      const result = await syncStudentCasesFromServer({
        studentId,
        studentKey,
        localCases: snap,
      });
      applyStudentServerCases(studentKey, result.cases);
      return result.cases;
    },
    [applyStudentServerCases]
  );

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

  useEffect(() => {
    if (route !== 'main' || role !== 'student' || !user?.studentKey) return;
    if (!activeCaseId) return;
    if (cases.some((c) => c.id === activeCaseId)) return;
    const mine = cases.filter((c) => c.student === user.studentKey).sort((a, b) => b.updatedAt - a.updatedAt);
    setActiveCaseId(mine[0]?.id ?? null);
  }, [route, role, user, activeCaseId, cases]);

  /** Подтянуть students.id и синхронизировать кейсы с сервером (сервер = источник правды). */
  useEffect(() => {
    if (route !== 'main' || role !== 'student' || !user?.studentKey) return;
    let cancelled = false;
    (async () => {
      const reg = loadRegistry().find((r) => r.studentKey === user.studentKey);
      let studentId = reg?.dbStudentId || getLocalStudentId();
      if (!studentId && reg?.login) {
        studentId = await findStudentIdByLogin(reg.login);
        if (studentId) {
          setLocalStudentId(studentId);
          setRegistryDbStudentId(user.studentKey, studentId);
        }
      }
      if (cancelled || !hasSupabase()) return;
      const synced = await syncStudentCases(user.studentKey, studentId, loadCases());
      if (cancelled) return;
      if (synced.length) {
        setActiveCaseId((prev) => {
          if (prev && synced.some((c) => c.id === prev)) return prev;
          return synced[0]?.id ?? null;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [route, role, user?.studentKey, syncStudentCases]);

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
    if (
      !last ||
      (last.from !== 'fox' && last.from !== 'ai') ||
      last.silenceCheck
    ) {
      return undefined;
    }

    const foxId = last.id;
    const elapsed = Date.now() - last.at;
    const delay = Math.max(0, FOX_SILENCE_NUDGE_MS - elapsed);

    silenceNudgeTimerRef.current = window.setTimeout(() => {
      silenceNudgeTimerRef.current = null;
      const caseId = activeCaseIdRef.current;
      const i = silenceNudgeRotateRef.current;
      silenceNudgeRotateRef.current = i + 1;
      const nudgeText = pickSilenceNudgeLine(i);
      const nudgeMsg = {
        id: uid(),
        from: 'fox',
        at: Date.now(),
        text: nudgeText,
        silenceCheck: true,
      };

      setCases((prev) => {
        const c = prev.find((x) => x.id === caseId);
        if (!c) return prev;
        const l = c.messages[c.messages.length - 1];
        if (l.from === 'user' || l.id !== foxId || l.silenceCheck) return prev;
        const regRecord = loadRegistry().find((r) => r.studentKey === c.student);
        const studentId = regRecord?.dbStudentId || getLocalStudentId();
        if (studentId) {
          void persistMessage({
            id: nudgeMsg.id,
            caseId: c.id,
            studentId,
            authorRole: 'fox',
            body: nudgeMsg.text,
            caseStatus: c.status,
            urgent: c.urgent,
            createdAt: nudgeMsg.at,
          });
        }
        return prev.map((caseItem) =>
          caseItem.id === caseId
            ? {
                ...caseItem,
                messages: [...caseItem.messages, nudgeMsg],
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

  /** Только зарегистрированные ученики, без тестовых c-seed */
  const adminChats = useMemo(() => {
    const reg = loadRegistry();
    const keySet = new Set(reg.map((r) => r.studentKey));
    return cases.filter((c) => keySet.has(c.student) && !String(c.id || '').startsWith('c-seed'));
  }, [cases, adminRegistryTick]);

  const adminRegistryList = useMemo(
    () => loadRegistry().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
    [adminRegistryTick, route, role, adminTab]
  );

  const newAdminAlertsCount = useMemo(
    () => adminAlertsFromDb.filter((a) => a.status === 'new').length,
    [adminAlertsFromDb]
  );

  const sortedAdminAlerts = useMemo(() => {
    return [...adminAlertsFromDb].sort((a, b) => {
      if (a.status === 'new' && b.status !== 'new') return -1;
      if (a.status !== 'new' && b.status === 'new') return 1;
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return (tb || 0) - (ta || 0);
    });
  }, [adminAlertsFromDb]);
  /** кнопка «Просмотрено» только для status=new, дальше — seen */
  const isAlertNew = (s) => s === 'new';

  const refreshAdminAlerts = useCallback(async () => {
    if (role !== 'admin' || route !== 'main') return;
    const [rows, serverStudents] = await Promise.all([fetchAlerts(), fetchStudentsForStaff()]);
    serverStudents.map(serverStudentToLocal).filter(Boolean).forEach((student) => {
      upsertRegistryRecord({ ...student, passwordHash: 'server-auth' });
    });
    if (serverStudents.length) setAdminRegistryTick((t) => t + 1);

    const idByKey = new Map();
    loadRegistry().forEach((r) => {
      if (r?.studentKey && r.dbStudentId) idByKey.set(r.studentKey, r.dbStudentId);
    });
    serverStudents.forEach((s) => {
      const key = String(s.login || '').trim().toLowerCase();
      if (key && s.id) idByKey.set(key, s.id);
    });

    const sync = await syncStaffCasesFromServer(loadCases(), (studentKey) =>
      idByKey.get(normLogin(studentKey))
    );
    if (sync.cases) {
      setCases(sync.cases);
    }
    setAdminAlertsFromDb(rows);
  }, [role, route]);

  useEffect(() => {
    if (role !== 'admin' || route !== 'main') return;
    void refreshAdminAlerts();
  }, [role, route, adminTab, refreshAdminAlerts]);

  useEffect(() => {
    if (role !== 'admin' || route !== 'main') return;
    const t = setInterval(() => {
      void refreshAdminAlerts();
    }, 15000);
    return () => clearInterval(t);
  }, [role, route, refreshAdminAlerts]);

  const markAdminAlertSeen = useCallback(
    async (id) => {
      await patchAlertStatus(id, 'seen');
      void refreshAdminAlerts();
    },
    [refreshAdminAlerts]
  );

  const deleteAdminAlert = useCallback(
    async (id) => {
      await deleteAlertById(id);
      void refreshAdminAlerts();
    },
    [refreshAdminAlerts]
  );

  const registerAndEnter = useCallback(async () => {
    setRegisterError('');
    const name = reg.name.trim();
    const surname = reg.surname.trim();
    const className = reg.className.trim();
    const loginStr = reg.login.trim();
    const pass = reg.password;

    if (!name || !surname || !className || !loginStr) {
      setRegisterError('Заполни все поля');
      return;
    }
    if (pass.trim().length < 4) {
      setRegisterError('Пароль — не меньше 4 символов');
      return;
    }

    const studentKey = normLogin(loginStr);
    if (loadRegistry().some((r) => r.studentKey === studentKey)) {
      setRegisterError('Такой логин уже занят. Придумай другой');
      return;
    }

    let passwordHash;
    try {
      passwordHash = await hashPassword(pass);
    } catch {
      setRegisterError('Не удалось защитить пароль. Попробуй другое устройство или обнови браузер');
      return;
    }

    const id = uid();
    const nc = {
      id,
      student: studentKey,
      status: 'open',
      urgent: false,
      updatedAt: Date.now(),
      messages: [initialFox()],
    };

    const now = Date.now();
    const authResult = await registerStudentAccount({
      surname,
      name,
      className,
      login: loginStr,
      password: pass,
    });
    if (!authResult.ok && authResult.reason !== 'supabase_missing') {
      setRegisterError('Не удалось создать учётную запись. Проверь Supabase Auth или попробуй другой логин.');
      return;
    }
    const dbId =
      authResult.student?.id ||
      (await insertStudentAndGetId({
        surname,
        name,
        className,
        login: loginStr,
        authUserId: authResult.user?.id,
      }));
    if (dbId) setLocalStudentId(dbId);
    if (dbId) {
      void persistMessage({
        id: nc.messages[0].id,
        caseId: nc.id,
        studentId: dbId,
        authorRole: 'fox',
        body: nc.messages[0].text,
        caseStatus: nc.status,
        urgent: nc.urgent,
        createdAt: nc.messages[0].at,
      });
    }
    upsertRegistryRecord({
      studentKey,
      name,
      surname,
      className,
      login: loginStr,
      passwordHash,
      createdAt: now,
      ...(dbId ? { dbStudentId: dbId } : {}),
    });
    setAdminRegistryTick((t) => t + 1);
    setCases((prev) => {
      const rest = prev.filter((c) => !String(c.id || '').startsWith('c-seed') && c.student !== studentKey);
      return [nc, ...rest];
    });
    setUser({
      name,
      surname,
      className,
      login: loginStr,
      studentKey,
      avatarDataUrl: readStoredAvatar(studentKey),
    });
    setReg((r) => ({ ...r, password: '' }));
    setActiveCaseId(id);
    setRoute('main');
    setRole('student');
    setStudentTab('chat');
    setHistoryCaseId(null);
    setAdminCaseId(null);
    setChatStatus('idle');
  }, [reg]);

  const loginAndEnter = useCallback(async () => {
    setLoginError('');
    const l = normLogin(login.login);
    const pass = login.password;
    if (!l || !pass) {
      setLoginError('Введи логин и пароль');
      return;
    }
    const serverLogin = await signInStudentAccount(l, pass);
    if (serverLogin.ok && serverLogin.student) {
      const serverStudent = serverStudentToLocal(serverLogin.student);
      if (serverStudent?.dbStudentId) setLocalStudentId(serverStudent.dbStudentId);
      if (serverStudent) {
        upsertRegistryRecord({ ...serverStudent, passwordHash: 'server-auth' });
        setAdminRegistryTick((t) => t + 1);
      }
      const studentKey = serverStudent?.studentKey || l;
      setUser({
        name: serverStudent?.name || '',
        surname: serverStudent?.surname || '',
        className: serverStudent?.className || '',
        login: serverStudent?.login || login.login,
        studentKey,
        avatarDataUrl: readStoredAvatar(studentKey),
      });
      const studentId = serverStudent?.dbStudentId || null;
      let synced = await syncStudentCases(studentKey, studentId, loadCases());
      let nextActiveId = synced[0]?.id ?? null;
      if (!synced.length) {
        const newId = uid();
        const nc = {
          id: newId,
          student: studentKey,
          status: 'open',
          urgent: false,
          updatedAt: Date.now(),
          messages: [initialFox()],
        };
        setCases((prev) => [nc, ...prev.filter((c) => c.student !== studentKey)]);
        if (studentId) {
          void persistMessage({
            id: nc.messages[0].id,
            caseId: nc.id,
            studentId,
            authorRole: 'fox',
            body: nc.messages[0].text,
            caseStatus: nc.status,
            urgent: nc.urgent,
            createdAt: nc.messages[0].at,
          });
        }
        nextActiveId = newId;
      }
      setActiveCaseId(nextActiveId);
      setRoute('main');
      setRole('student');
      setStudentTab('chat');
      setHistoryCaseId(null);
      setAdminCaseId(null);
      setChatStatus('idle');
      return;
    }
    const found = loadRegistry().find((r) => r.studentKey === l);
    if (!found) {
      setLoginError('Неверный логин или пароль');
      return;
    }
    let ok = false;
    try {
      ok = await verifyPassword(pass, found.passwordHash);
    } catch {
      ok = false;
    }
    if (!ok) {
      setLoginError('Неверный логин или пароль');
      return;
    }

    const studentKey = found.studentKey;
    let studentId = found.dbStudentId || null;
    if (studentId) {
      setLocalStudentId(studentId);
    } else {
      const id = await findStudentIdByLogin(found.login);
      if (id) {
        studentId = id;
        setLocalStudentId(id);
        setRegistryDbStudentId(studentKey, id);
      }
    }
    setUser({
      name: found.name,
      surname: found.surname,
      className: found.className,
      login: found.login,
      studentKey,
      avatarDataUrl: readStoredAvatar(studentKey),
    });
    let synced = await syncStudentCases(studentKey, studentId, loadCases());
    let nextActiveId = synced[0]?.id ?? null;
    if (!synced.length) {
      const newId = uid();
      const nc = {
        id: newId,
        student: studentKey,
        status: 'open',
        urgent: false,
        updatedAt: Date.now(),
        messages: [initialFox()],
      };
      setCases((prev) => [nc, ...prev.filter((c) => c.student !== studentKey)]);
      if (studentId) {
        void persistMessage({
          id: nc.messages[0].id,
          caseId: nc.id,
          studentId,
          authorRole: 'fox',
          body: nc.messages[0].text,
          caseStatus: nc.status,
          urgent: nc.urgent,
          createdAt: nc.messages[0].at,
        });
      }
      nextActiveId = newId;
    }
    setActiveCaseId(nextActiveId);
    setRoute('main');
    setRole('student');
    setStudentTab('chat');
    setHistoryCaseId(null);
    setAdminCaseId(null);
    setChatStatus('idle');
  }, [login, syncStudentCases]);

  const persistCaseMessage = useCallback((caseItem, msg, patch = {}) => {
    if (!caseItem || !msg) return;
    const regRecord = loadRegistry().find((r) => r.studentKey === caseItem.student);
    const studentId = regRecord?.dbStudentId || getLocalStudentId();
    void persistMessage({
      id: msg.id,
      caseId: caseItem.id,
      studentId,
      authorRole: msg.from === 'user' ? 'student' : msg.from,
      body: msg.text,
      caseStatus: patch.status || caseItem.status,
      urgent: patch.urgent ?? caseItem.urgent,
      createdAt: msg.at,
    });
  }, []);

  const appendMessage = useCallback((caseId, msg) => {
    setCases((prev) =>
      prev.map((c) => {
        if (c.id !== caseId) return c;
        const next = { ...c, messages: [...c.messages, msg], updatedAt: Date.now() };
        persistCaseMessage(next, msg);
        return next;
      })
    );
  }, [persistCaseMessage]);

  const updateCase = useCallback((caseId, patch) => {
    setCases((prev) => prev.map((c) => {
      if (c.id !== caseId) return c;
      const next = { ...c, ...patch, updatedAt: Date.now() };
      const last = next.messages[next.messages.length - 1];
      if (last) persistCaseMessage(next, last, patch);
      return next;
    }));
  }, [persistCaseMessage]);

  const deleteCaseById = useCallback((caseId) => {
    if (!window.confirm('Удалить этот чат? Действие нельзя отменить.')) return;
    void deleteMessagesByCaseId(caseId);
    setCases((prev) => prev.filter((c) => c.id !== caseId));
    setAdminCaseId((prev) => (prev === caseId ? null : prev));
    setHistoryCaseId((prev) => (prev === caseId ? null : prev));
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

  const sendStudent = async () => {
    const messageText = chatInput.trim();
    if (!messageText || !activeCaseId) return;
    const userMessageId = uid();

    const result = await checkMessage(messageText, {
      case_id: activeCaseId,
      message_id: userMessageId,
    });
    if (result?.danger === true) {
      alert("Лисичка рядом. Я могу позвать взрослого");
    }

    const replyText =
      result?.ok && typeof result?.reply === "string" && result.reply.trim()
        ? result.reply.trim()
        : "Я рядом. Сейчас не получилось ответить — напиши ещё чуть-чуть позже 💬";

    messageDangerFromApiRef.current = !!result?.danger;
    foxReplyTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
    foxReplyTimeoutsRef.current = [];

    setChatInput('');
    appendMessage(activeCaseId, { id: userMessageId, from: 'user', at: Date.now(), text: messageText });
    if (result?.danger && result?.alert_saved !== true) {
      void insertAlert({
        student_id: getLocalStudentId(),
        case_id: activeCaseId,
        message_id: userMessageId,
        alert_type: result.alert_type || 'ai_detected',
        status: 'new',
        summary_for_adult: result.summary_for_adult || null,
        source: 'client_check_message',
      });
    }
    notifyStaffStudentMessage({
      studentKey: user?.studentKey,
      text: messageText,
      caseId: activeCaseId,
    });
    setChatStatus('waiting');
    updateCase(activeCaseId, { status: 'in_progress' });

    const caseId = activeCaseId;
    const caseIdForCheck = caseId;

    const timeoutId = window.setTimeout(() => {
      appendMessage(caseId, { id: uid(), from: 'ai', at: Date.now(), text: replyText });
      setChatStatus('idle');
      updateCase(caseId, { status: messageDangerFromApiRef.current ? 'new' : 'open' });
    }, 1100);
    foxReplyTimeoutsRef.current.push(timeoutId);

    if (result?.danger) {
      updateCase(caseIdForCheck, { urgent: true, status: 'new' });
    }
  };

  const quickSay = (text) => {
    setChatInput(text);
  };

  const requestAdult = async () => {
    if (!activeCaseId) return;
    const result = await checkMessage("", { event_type: "child_pressed_help", case_id: activeCaseId });
    if (result?.alert_saved !== true) {
      void insertAlert({
        student_id: getLocalStudentId(),
        case_id: activeCaseId,
        alert_type: 'child_pressed_help',
        status: 'new',
        source: 'child_pressed_help',
      });
    }
    updateCase(activeCaseId, { urgent: true, status: 'new' });
    appendMessage(activeCaseId, {
      id: uid(),
      from: 'fox',
      at: Date.now(),
      text: 'Я передала, что тебе нужна поддержка рядом. Я никуда не ухожу — пиши, если снова станет тяжело 💬',
    });
    setAdultFromDanger(false);
    setAdultOpen(false);
  };

  const closeAdultModal = () => {
    setAdultFromDanger(false);
    setAdultOpen(false);
  };

  const sendAdminReply = () => {
    const t = adminReply.trim();
    if (!t || !adminCaseId) return;
    appendMessage(adminCaseId, { id: uid(), from: 'fox', at: Date.now(), text: t });
    updateCase(adminCaseId, { status: adminStatusPick });
    setAdminReply('');
  };

  const submitAdminStaffLogin = async () => {
    const l = adminStaff.login.trim();
    const p = adminStaff.password;
    const result = await signInStaffAccount(l, p);
    if (result.ok) {
      setAdminStaffError('');
      setAdminStaff({ login: '', password: '' });
      setRole(result.profile?.role === 'admin' ? 'admin' : 'admin');
      setRoute('main');
      setAdminTab('queue');
      setAdminCaseId(null);
      setAdminReply('');
    } else {
      setAdminStaffError('Неверный логин или пароль сотрудника');
    }
  };

  const applyAdminPasswordReset = useCallback(
    async (studentKey) => {
      setAdminResetError('');
      const raw = (adminResetPw[studentKey] || '').trim();
      if (raw.length < 4) {
        setAdminResetError('Пароль — не меньше 4 символов');
        return;
      }
      try {
        const ph = await hashPassword(raw);
        updateStudentPasswordHash(studentKey, ph);
        setAdminResetPw((p) => ({ ...p, [studentKey]: '' }));
        setAdminRegistryTick((t) => t + 1);
      } catch {
        setAdminResetError('Не удалось установить новый пароль');
      }
    },
    [adminResetPw]
  );

  const applyAdminProfileSave = useCallback(
    async (studentKey) => {
      setAdminProfileError('');
      const st = loadRegistry().find((x) => x.studentKey === studentKey);
      if (!st) {
        setAdminProfileError('Запись не найдена');
        return;
      }
      const d = adminEditDraft[studentKey];
      const base = d || { surname: st.surname, name: st.name, className: st.className };
      const surname = String(base.surname || '').trim();
      const name = String(base.name || '').trim();
      const className = String(base.className || '').trim();
      if (!surname || !name || !className) {
        setAdminProfileError('Заполни фамилию, имя и класс');
        return;
      }
      updateStudentProfileFields(studentKey, { surname, name, className });
      if (st.dbStudentId) {
        const result = await updateStudentProfileOnServer(st.dbStudentId, { surname, name, className });
        if (!result.ok) {
          setAdminProfileError('Локально сохранено, но Supabase не принял изменение профиля');
        }
      }
      setAdminEditDraft((p) => {
        const n = { ...p };
        delete n[studentKey];
        return n;
      });
      setAdminRegistryTick((t) => t + 1);
    },
    [adminEditDraft]
  );

  const patchAdminDraft = useCallback((studentKey, st, field, value) => {
    setAdminProfileError('');
    setAdminEditDraft((p) => {
      const cur = p[studentKey] || { surname: st.surname, name: st.name, className: st.className };
      return { ...p, [studentKey]: { ...cur, [field]: value } };
    });
  }, []);

  const regOk =
    reg.name.trim() &&
    reg.surname.trim() &&
    reg.className.trim() &&
    reg.login.trim().length >= 2 &&
    reg.password.trim().length >= 4 &&
    reg.agreePd;

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
            <span className="welcome__examples">
              Можно написать коротко: <span className="welcome__q">«мне грустно»</span>,{' '}
              <span className="welcome__q">«мне страшно»</span>, <span className="welcome__q">«мне нужна помощь»</span>.
            </span>
            <br />
            <span className="welcome__closing">Я рядом.</span>
          </p>
          <div className="welcome__actions">
            <Btn full onClick={() => setRoute('register')}>
              Начать разговор
            </Btn>
            <GhostBtn onClick={() => setRoute('login')}>У меня уже есть логин</GhostBtn>
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
          <Field
            label="Фамилия"
            id="f0"
            value={reg.surname}
            onChange={(e) => {
              setRegisterError('');
              setReg({ ...reg, surname: e.target.value });
            }}
            placeholder="Введи фамилию"
          />
          <Field
            label="Имя"
            id="f1"
            value={reg.name}
            onChange={(e) => {
              setRegisterError('');
              setReg({ ...reg, name: e.target.value });
            }}
            placeholder="Введи имя"
          />
          <Field
            label="Класс"
            id="f3"
            value={reg.className}
            onChange={(e) => {
              setRegisterError('');
              setReg({ ...reg, className: e.target.value });
            }}
            placeholder="Например, 5«А»"
          />
          <Field
            label="Логин"
            id="f-log"
            value={reg.login}
            onChange={(e) => {
              setRegisterError('');
              setReg({ ...reg, login: e.target.value });
            }}
            placeholder="Как к тебе обращаться в системе: латиницу или цифры"
            autoComplete="username"
          />
          <Field
            label="Пароль"
            id="f4"
            type="password"
            value={reg.password}
            onChange={(e) => {
              setRegisterError('');
              setReg({ ...reg, password: e.target.value });
            }}
            placeholder="Минимум 4 символа — нигде и никому не говори"
            autoComplete="new-password"
          />
          <div className="field-block">
            <Check
              id="ag"
              checked={reg.agreePd}
              onChange={(e) => setReg({ ...reg, agreePd: e.target.checked })}
              label="Даю согласие на обработку персональных данных"
            />
          </div>
          {registerError ? <p className="profile-avatar-error">{registerError}</p> : null}
          <Btn full disabled={!regOk} onClick={() => void registerAndEnter()}>
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
        <p className="muted">Введи логин и пароль, с которыми регистрировался</p>
        <div className="card">
          <Field
            label="Логин"
            id="ln"
            value={login.login}
            onChange={(e) => {
              setLoginError('');
              setLogin({ ...login, login: e.target.value });
            }}
            placeholder="Как в регистрации"
            autoComplete="username"
          />
          <Field
            label="Пароль"
            id="lc"
            type="password"
            value={login.password}
            onChange={(e) => {
              setLoginError('');
              setLogin({ ...login, password: e.target.value });
            }}
            placeholder="Пароль"
            autoComplete="current-password"
          />
          {loginError ? <p className="profile-avatar-error">{loginError}</p> : null}
          <Btn full onClick={() => void loginAndEnter()}>
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

            <Btn
              variant="secondary"
              full
              onClick={() => {
                setAdultFromDanger(false);
                setAdultOpen(true);
              }}
            >
              Попросить помощи
            </Btn>
          </div>
        </div>

        {adultOpen ? (
          <div role="dialog" aria-modal="true" className="modal-backdrop" onClick={closeAdultModal}>
            <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="modal-sheet__title">
                {adultFromDanger
                  ? 'Лисичка заметила, что тебе может быть тяжело. Хочешь, я позову взрослого?'
                  : 'Хочешь, я помогу позвать взрослого, который сможет помочь?'}
              </div>
              <p className="modal-sheet__text">
                Я могу передать это, чтобы тебе помогли быстрее.
                <br />
                <br />
                Прочитают только те, кто может помочь.
              </p>
              <div className="modal-sheet__actions">
                <Btn variant="secondary" full onClick={closeAdultModal}>
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
    const list = myCases;
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
                <div className="profile-avatar-initials">{(user?.name?.[0] || 'Я') + (user?.surname?.[0] || '')}</div>
              )}
            </div>
            <div>
              <div className="profile-card__name">
                {user?.name} {user?.surname}
              </div>
              <div className="profile-card__class">
                Класс: {user?.className?.trim() ? user.className : '—'}
              </div>
              <div className="profile-card__code">Логин: {user?.login}</div>
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
            <h2>{caseStudentLabel(adminCase.student)}</h2>
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

  if (route === 'main' && role === 'admin' && adminTab === 'notifications') {
    return (
      <Page narrow={false}>
        <div className="admin-wrap">
          <h2 className="h2 h2--mb-sm">Уведомления</h2>
          <p className="muted muted--tight muted--flush">Срочные сигналы и запросы помощи</p>
          <div className="list-stack list-stack--mt">
            {sortedAdminAlerts.length === 0 ? (
              <p className="muted">Пока нет уведомлений</p>
            ) : (
              sortedAdminAlerts.map((a) => {
                const b = alertSeenBadge(a.status);
                return (
                <div key={a.id} className="card admin-alert-card">
                  <div className="admin-alert-card__row">
                    <div className="admin-alert-card__meta">
                      <label className="form-label">alert_type</label>
                      <p className="muted admin-registry-line">{a.alert_type != null ? String(a.alert_type) : '—'}</p>
                      <label className="form-label">status</label>
                      <p className="muted admin-registry-line">{a.status != null ? String(a.status) : '—'}</p>
                      <label className="form-label">created_at</label>
                      <p className="muted admin-registry-line">
                        {a.created_at != null && a.created_at !== '' ? formatTime(a.created_at) : '—'}
                      </p>
                    </div>
                    <Badge tone={b.tone}>{b.children}</Badge>
                  </div>
                  <div className="admin-alert-card__btns">
                    <Btn
                      full
                      variant="secondary"
                      disabled={!isAlertNew(a.status)}
                      onClick={() => { void markAdminAlertSeen(a.id); }}
                    >
                      Просмотрено
                    </Btn>
                    <GhostBtn onClick={() => { void deleteAdminAlert(a.id); }}>Удалить</GhostBtn>
                  </div>
                </div>
                );
              })
            )}
          </div>
        </div>
        <BottomNav
          items={[
            {
              key: 'q',
              label: 'Чаты',
              icon: <IconInbox active={false} />,
              active: false,
              onClick: () => setAdminTab('queue'),
            },
            {
              key: 'n',
              label: (
                <span className="bottom-nav__label-with-badge">
                  Уведомления
                  {newAdminAlertsCount > 0 ? (
                    <span className="bottom-nav__count-pill" aria-label={`Новых: ${newAdminAlertsCount}`}>
                      {newAdminAlertsCount > 9 ? '9+' : newAdminAlertsCount}
                    </span>
                  ) : null}
                </span>
              ),
              icon: <IconBell active />,
              active: true,
              onClick: () => {},
            },
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

  if (route === 'main' && role === 'admin' && adminTab === 'queue') {
    return (
      <Page narrow={false}>
        <div className="admin-wrap">
          <h2 className="h2 h2--mb-sm">Чаты с Лисичкой</h2>
          <p className="muted muted--tight muted--flush">Кому сейчас хочется, чтобы кто-то услышал</p>
          <div className="list-stack list-stack--mt">
            {adminChats.length === 0 ? (
              <p className="muted">Пока нет чатов — дождитесь, пока ученик начнёт разговор</p>
            ) : (
            adminChats.map((c) => {
              const last = c.messages[c.messages.length - 1];
              const preview = last?.from === 'user' ? last.text : c.messages.filter((m) => m.from === 'user').pop()?.text || '—';
              return (
                <div key={c.id} className="history-card history-card--with-actions">
                  <button
                    type="button"
                    className="history-card__open"
                    onClick={() => setAdminCaseId(c.id)}
                  >
                    <div className="history-card__top">
                      <span className="history-card__time">{caseStudentLabel(c.student)}</span>
                      <div className="history-card__badges">
                        {c.urgent ? <Badge tone="danger">Срочно</Badge> : null}
                        <Badge tone={c.status === 'closed' ? 'neutral' : c.status === 'new' ? 'wait' : 'primary'}>
                          {statusBadgeAdmin(c.status)}
                        </Badge>
                      </div>
                    </div>
                    <div className="history-card__preview">{preview}</div>
                  </button>
                  <GhostBtn
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteCaseById(c.id);
                    }}
                  >
                    Удалить чат
                  </GhostBtn>
                </div>
              );
            })
            )}
          </div>
        </div>
        <BottomNav
          items={[
            { key: 'q', label: 'Чаты', icon: <IconInbox active />, active: true, onClick: () => {} },
            {
              key: 'n',
              label: (
                <span className="bottom-nav__label-with-badge">
                  Уведомления
                  {newAdminAlertsCount > 0 ? (
                    <span className="bottom-nav__count-pill" aria-label={`Новых: ${newAdminAlertsCount}`}>
                      {newAdminAlertsCount > 9 ? '9+' : newAdminAlertsCount}
                    </span>
                  ) : null}
                </span>
              ),
              icon: <IconBell active={false} />,
              active: false,
              onClick: () => setAdminTab('notifications'),
            },
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
          Здесь режим сотрудника. Чтобы вернуться к детскому экрану, выйди и зайди как ученик по логину и паролю.
        </p>
        <h2 className="h2 h2--mb-sm admin-registry-section-title">Учётные записи</h2>
        <div className="list-stack list-stack--mt">
          {adminRegistryList.length === 0 ? (
            <p className="muted">Пока нет зарегистрированных учеников</p>
          ) : (
            adminRegistryList.map((st) => {
              const d = adminEditDraft[st.studentKey];
              const rowSurname = d?.surname !== undefined ? d.surname : st.surname;
              const rowName = d?.name !== undefined ? d.name : st.name;
              const rowClass = d?.className !== undefined ? d.className : st.className;
              return (
                <div key={st.studentKey} className="card admin-registry-card">
                  <Field
                    label="Фамилия"
                    id={`ad-sn-${st.studentKey}`}
                    value={rowSurname}
                    onChange={(e) => patchAdminDraft(st.studentKey, st, 'surname', e.target.value)}
                    placeholder="Фамилия"
                  />
                  <Field
                    label="Имя"
                    id={`ad-nm-${st.studentKey}`}
                    value={rowName}
                    onChange={(e) => patchAdminDraft(st.studentKey, st, 'name', e.target.value)}
                    placeholder="Имя"
                  />
                  <Field
                    label="Класс"
                    id={`ad-cl-${st.studentKey}`}
                    value={rowClass}
                    onChange={(e) => patchAdminDraft(st.studentKey, st, 'className', e.target.value)}
                    placeholder="Класс"
                  />
                  <p className="muted admin-registry-line">Логин: {st.login} (нельзя изменить)</p>
                  <p className="muted admin-registry-line admin-registry-line--date">
                    Дата регистрации: {formatTime(st.createdAt || 0)}
                  </p>
                  <p className="muted admin-registry-line admin-registry-line--date">
                    Последнее изменение:{' '}
                    {st.adminProfileUpdatedAt
                      ? formatTime(st.adminProfileUpdatedAt)
                      : '— (ещё не меняли после регистрации)'}
                  </p>
                  <Btn full type="button" onClick={() => applyAdminProfileSave(st.studentKey)}>
                    Сохранить ФИО и класс
                  </Btn>
                  <div className="admin-registry-hr" aria-hidden />
                  <Field
                    label="Новый пароль (сброс)"
                    id={`ad-pw-${st.studentKey}`}
                    type="password"
                    value={adminResetPw[st.studentKey] || ''}
                    onChange={(e) => {
                      setAdminResetError('');
                      setAdminResetPw((p) => ({ ...p, [st.studentKey]: e.target.value }));
                    }}
                    placeholder="не меньше 4 символов"
                  />
                  <Btn full type="button" onClick={() => void applyAdminPasswordReset(st.studentKey)}>
                    Сбросить пароль
                  </Btn>
                </div>
              );
            })
          )}
        </div>
        {adminProfileError ? <p className="profile-avatar-error admin-registry-error">{adminProfileError}</p> : null}
        {adminResetError ? <p className="profile-avatar-error admin-registry-error">{adminResetError}</p> : null}
        <Btn
          variant="secondary"
          full
          onClick={() => {
            void signOutAccount();
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
            {
              key: 'n',
              label: (
                <span className="bottom-nav__label-with-badge">
                  Уведомления
                  {newAdminAlertsCount > 0 ? (
                    <span className="bottom-nav__count-pill" aria-label={`Новых: ${newAdminAlertsCount}`}>
                      {newAdminAlertsCount > 9 ? '9+' : newAdminAlertsCount}
                    </span>
                  ) : null}
                </span>
              ),
              icon: <IconBell active={false} />,
              active: false,
              onClick: () => setAdminTab('notifications'),
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
