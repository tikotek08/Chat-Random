'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { Send, Square, Diamond, Home, Video, Search, User, SwitchCamera } from 'lucide-react';
import type { ScheduledSlot, MeetingInvite } from '@/lib/supabase';

interface Message {
  id: string;
  sender: 'stranger' | 'user';
  text: string;
}

type StrangerProfile = { name: string; email: string; photo: string }

type Connection = {
  id: string
  stranger_name: string | null
  stranger_email: string | null
  stranger_photo: string | null
  note: string | null
  created_at: string
}

type SignalMessage =
  | { type: 'find-match'; gender?: string; region?: string; age?: string }
  | { type: 'set-profile'; name: string; email: string; photo: string }
  | { type: 'waiting' }
  | { type: 'matched'; roomId: string; polite: boolean; stranger?: StrangerProfile | null }
  | { type: 'peer-left' }
  | { type: 'offer'; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'ice-candidate'; candidate: RTCIceCandidateInit }
  | { type: 'relay-chat'; text: string }
  | { type: 'use-relay' }
  | { type: 'leave' };

const DEFAULT_RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ],
};

const REGIONS = ['Global', 'América Latina', 'Norteamérica', 'Europa', 'Asia', 'Medio Oriente'];

const ALL_INTERESTS = ['Música', 'Viajes', 'Arte', 'Gaming', 'Cine', 'Deportes', 'Tecnología', 'Anime', 'Cocina', 'Moda', 'Fotografía', 'Baile'];

const BANNED_WORDS = ['puta', 'puto', 'mierda', 'cabrón', 'cabron', 'pendejo', 'chinga', 'verga', 'culero', 'mamón', 'fuck', 'shit', 'bitch', 'asshole', 'cunt', 'nigger', 'faggot'];

// Mock photo tiles per profile (hue + emoji as placeholder visuals)
const MOCK_PHOTOS: Record<number, { hue: number; emoji: string }[]> = {
  1: [{ hue: 0, emoji: '🎵' }, { hue: 15, emoji: '☕' }, { hue: 340, emoji: '🎧' }],
  2: [{ hue: 40, emoji: '✈️' }, { hue: 55, emoji: '🏔️' }, { hue: 25, emoji: '🌍' }, { hue: 50, emoji: '📸' }],
  3: [{ hue: 80, emoji: '🎨' }, { hue: 95, emoji: '✏️' }, { hue: 70, emoji: '🖼️' }],
  4: [{ hue: 130, emoji: '🎮' }, { hue: 145, emoji: '🕹️' }],
  5: [{ hue: 180, emoji: '🎬' }, { hue: 195, emoji: '🎞️' }, { hue: 165, emoji: '🍿' }, { hue: 200, emoji: '📽️' }],
  6: [{ hue: 220, emoji: '⚽' }, { hue: 235, emoji: '🏋️' }, { hue: 210, emoji: '🏃' }],
  7: [{ hue: 270, emoji: '💻' }, { hue: 285, emoji: '⚙️' }, { hue: 255, emoji: '🤖' }, { hue: 290, emoji: '🧑‍💻' }],
  8: [{ hue: 310, emoji: '🌸' }, { hue: 325, emoji: '⛩️' }, { hue: 295, emoji: '📚' }],
};

const MOCK_PROFILES = [
  { id: 1,  flag: '🇲🇽', age: 24, tag: 'Música',     hue: 0,   rating: 4.8, reviews: 34, bio: 'Amante de la música indie y el café. Siempre con audífonos puestos 🎧',      comments: ['Muy buena onda, platicamos horas', 'Super divertido/a', 'Volvería a hablar con esta persona'] },
  { id: 2,  flag: '🇦🇷', age: 21, tag: 'Viajes',     hue: 40,  rating: 4.5, reviews: 21, bio: 'Mochilera empedernida. Ya visité 12 países y voy por más ✈️',                comments: ['Tiene historias increíbles de viajes', 'Muy entretenida la conv', 'Aprendí mucho hablando con ella'] },
  { id: 3,  flag: '🇪🇸', age: 27, tag: 'Arte',       hue: 80,  rating: 4.9, reviews: 58, bio: 'Ilustrador/a digital. El arte es mi forma de ver el mundo 🎨',               comments: ['Persona muy creativa y auténtica', 'Me mostró su portfolio, genial', 'Muy buena charla'] },
  { id: 4,  flag: '🇺🇸', age: 22, tag: 'Gaming',     hue: 130, rating: 4.2, reviews: 17, bio: 'Pro gamer wannabe 😅 Fortnite, Valorant y mucho café por las noches 🎮',      comments: ['Buen jugador, muy positivo', 'Hablamos de videojuegos toda la sesión', 'Tranquilo y divertido'] },
  { id: 5,  flag: '🇧🇷', age: 25, tag: 'Cine',       hue: 180, rating: 4.7, reviews: 43, bio: 'Cinéfilo/a de corazón. Nolan y Lynch son mis dioses 🎬',                     comments: ['Sabe muchísimo de cine', 'Conversación intelectual muy buena', 'Me recomendó películas increíbles'] },
  { id: 6,  flag: '🇨🇴', age: 19, tag: 'Deportes',   hue: 220, rating: 4.3, reviews: 12, bio: 'Atleta aficionado. Gym, fútbol y naturaleza son mi vida 🏋️',                 comments: ['Muy energético y motivador', 'Buena vibra', 'Conversación corta pero amena'] },
  { id: 7,  flag: '🇫🇷', age: 30, tag: 'Tecnología', hue: 270, rating: 4.6, reviews: 29, bio: 'Dev full-stack de día, gamer de noche. Open source lover 💻',                comments: ['Habla de tech sin hacerlo aburrido', 'Muy inteligente', 'Gran conversación sobre el futuro de la IA'] },
  { id: 8,  flag: '🇯🇵', age: 23, tag: 'Anime',      hue: 310, rating: 4.4, reviews: 38, bio: 'Otaku orgulloso/a. Mangaka en mis sueños, oficinista en la realidad 🌸',     comments: ['Conoce todo sobre anime', 'Super amable y detallista', 'Una de las mejores conversaciones que he tenido'] },
];

export default function VideoChatApp() {
  const { data: session } = useSession();

  // ── App state ─────────────────────────────────────────────
  const [appView, setAppView] = useState<'home' | 'chat'>('home');
  const [chatSessionId, setChatSessionId] = useState(0);
  const [points, setPoints] = useState(540); // overridden by localStorage on mount
  const [showNoPointsModal, setShowNoPointsModal] = useState(false);
  const [showPremiumMenu, setShowPremiumMenu] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState<string | null>(null);

  // ── Schedule state ────────────────────────────────────────
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [scheduleNote, setScheduleNote] = useState('');
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [mySlots, setMySlots] = useState<ScheduledSlot[]>([]);
  const [prefGender, setPrefGender] = useState('Todos');
  const [prefRegion, setPrefRegion] = useState('Global');
  const [prefAge, setPrefAge] = useState('Todos');
  const prefGenderRef = useRef('Todos');
  const prefRegionRef = useRef('Global');
  const prefAgeRef    = useRef('Todos');
  const [enteringChat, setEnteringChat] = useState(false);
  const [activeTab, setActiveTab] = useState<'home' | 'chat' | 'search' | 'profile'>('chat');
  const [profilePhoto, setProfilePhoto] = useState<string>('');
  const [profileIdx, setProfileIdx] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const activeTabRef = useRef(activeTab);

  // ── Profile editing ───────────────────────────────────────
  const [bio, setBio] = useState('');
  const [userAge, setUserAge] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [profileSaved, setProfileSaved] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [selectedProfile, setSelectedProfile] = useState<typeof MOCK_PROFILES[0] | null>(null);
  const [customPhoto, setCustomPhoto] = useState('');
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [galleryPhotos, setGalleryPhotos] = useState<string[]>([]);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // ── Ratings ───────────────────────────────────────────────
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [pendingRatingAction, setPendingRatingAction] = useState<'next' | 'stop' | null>(null);
  const [ratingValue, setRatingValue] = useState(0);
  const [ratingsGiven, setRatingsGiven] = useState<{stars: number, comment: string, date: string}[]>([]);
  const [ratingComment, setRatingComment] = useState('');

  // ── Invites ───────────────────────────────────────────────
  const [showInviteModal, setShowInviteModal]         = useState(false);
  const [inviteConnection, setInviteConnection]       = useState<Connection | null>(null);
  const [inviteDate, setInviteDate]                   = useState('');
  const [inviteTime, setInviteTime]                   = useState('');
  const [inviteMessage, setInviteMessage]             = useState('');
  const [inviteSaving, setInviteSaving]               = useState(false);
  const [inviteSent, setInviteSent]                   = useState(false);
  const [pendingInvites, setPendingInvites]           = useState<MeetingInvite[]>([]);
  const [showAcceptModal, setShowAcceptModal]         = useState(false);
  const [currentInviteToken, setCurrentInviteToken]   = useState<string | null>(null);
  const [currentInvite, setCurrentInvite]             = useState<MeetingInvite | null>(null);
  const [acceptLoading, setAcceptLoading]             = useState(false);
  const [acceptDone, setAcceptDone]                   = useState<'accepted' | 'declined' | null>(null);

  // ── Connections ───────────────────────────────────────────
  const [strangerProfile, setStrangerProfile] = useState<StrangerProfile | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [connectionNote, setConnectionNote] = useState('');
  const [connectionSaving, setConnectionSaving] = useState(false);
  const [myConnections, setMyConnections] = useState<Connection[]>([]);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // ── Chat moderation ───────────────────────────────────────
  const [blockedWarning, setBlockedWarning] = useState(false);

  // ── Chat state ────────────────────────────────────────────
  const [roomId, setRoomId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [searching, setSearching] = useState(true);
  const [status, setStatus] = useState('Conectando al servidor...');
  const [dcReady, setDcReady] = useState(false);
  const [relayMode, setRelayMode] = useState(false);
  const log = (..._: unknown[]) => {};

  // ── Refs ──────────────────────────────────────────────────
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const pendingChatRef = useRef<string[]>([]);
  const reconnectTimerRef = useRef<number | null>(null);
  const politeRef = useRef(false);
  const iceCandidateQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const rtcConfigRef = useRef<RTCConfiguration>(DEFAULT_RTC_CONFIG);
  const remoteImgRef = useRef<HTMLImageElement>(null);
  const relayIntervalRef = useRef<number | null>(null);
  const lastFrameUrlRef = useRef<string | null>(null);
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioHandlerRef = useRef<((payload: ArrayBuffer) => void) | null>(null);
  const audioNextTimeRef = useRef(0);
  const pointsIntervalRef = useRef<number | null>(null);
  const myProfileRef = useRef<StrangerProfile>({ name: 'Anónimo', email: '', photo: '' });

  // ── Load points from localStorage + handle post-payment redirect ──
  useEffect(() => {
    const saved = localStorage.getItem('va_points');
    if (saved !== null) setPoints(parseInt(saved, 10));

    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    const addedPoints = parseInt(params.get('points') ?? '0', 10);
    if (payment === 'success' && addedPoints > 0) {
      setPoints(prev => {
        const next = prev + addedPoints;
        localStorage.setItem('va_points', String(next));
        return next;
      });
    }
    if (payment) window.history.replaceState({}, '', '/');

    // Invite token from email link
    const inviteToken = params.get('invite');
    if (inviteToken) {
      setCurrentInviteToken(inviteToken);
      fetch(`/api/invite/${inviteToken}`)
        .then(r => r.json())
        .then(data => {
          if (data.invite?.status === 'pending') {
            setCurrentInvite(data.invite);
            setShowAcceptModal(true);
            setActiveTab('profile');
          }
        })
        .catch(() => {});
    }
  }, []);

  // ── Persist points to localStorage on change ───────────────
  useEffect(() => {
    localStorage.setItem('va_points', String(points));
  }, [points]);

  const savePoints = (_pts: number) => {}; // kept for doStop compatibility

  // ── Load profile + ratings from localStorage ─────────────
  useEffect(() => {
    setBio(localStorage.getItem('va_bio') ?? '');
    setUserAge(localStorage.getItem('va_age') ?? '');
    setDisplayName(localStorage.getItem('va_name') ?? '');
    setCustomPhoto(localStorage.getItem('va_photo') ?? '');
    try { setInterests(JSON.parse(localStorage.getItem('va_interests') ?? '[]')); } catch {}
    try { setRatingsGiven(JSON.parse(localStorage.getItem('va_ratings_given') ?? '[]')); } catch {}
    try { setGalleryPhotos(JSON.parse(localStorage.getItem('va_gallery') ?? '[]')); } catch {}
  }, []);

  // ── visualViewport (mobile keyboard) ─────────────────────
  useEffect(() => {
    const update = () => {
      const vv = window.visualViewport;
      document.documentElement.style.setProperty('--app-h', `${vv?.height ?? window.innerHeight}px`);
      document.documentElement.style.setProperty('--app-top', `${vv?.offsetTop ?? 0}px`);
    };
    update();
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, []);

  // ── Sync activeTab ref (for use inside stale closures) ───
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  // ── Sync filter refs (used in _doNext outside WebSocket effect) ──
  useEffect(() => { prefGenderRef.current = prefGender; }, [prefGender]);
  useEffect(() => { prefRegionRef.current = prefRegion; }, [prefRegion]);
  useEffect(() => { prefAgeRef.current    = prefAge;    }, [prefAge]);

  // ── Sync profile ref (used in WebSocket onopen) ──────────
  useEffect(() => {
    myProfileRef.current = {
      name:  session?.user?.name ?? displayName ?? 'Anónimo',
      email: session?.user?.email ?? '',
      photo: session?.user?.image ?? customPhoto ?? '',
    };
  }, [session, displayName, customPhoto]);

  // ── Clear unread badge when viewing Chat tab ───────────
  useEffect(() => { if (activeTab === 'chat') setUnreadCount(0); }, [activeTab]);

  // ── Messages scroll ───────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Capture camera snapshot for profile photos ────────────
  useEffect(() => {
    if (appView !== 'chat') return;
    const capture = () => {
      const video = localVideoRef.current;
      if (!video || !video.videoWidth) return;
      const canvas = document.createElement('canvas');
      canvas.width = 240; canvas.height = 320;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      // Mirror the capture to match what the user sees
      ctx.translate(240, 0); ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, 240, 320);
      setProfilePhoto(canvas.toDataURL('image/jpeg', 0.75));
    };
    capture();
    const interval = window.setInterval(capture, 4000);
    return () => clearInterval(interval);
  }, [appView]);

  // ── Unlock AudioContext on first gesture (iOS) ────────────
  useEffect(() => {
    const unlock = () => {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      audioCtxRef.current.resume().catch(() => {});
    };
    document.addEventListener('touchstart', unlock, { once: true });
    document.addEventListener('click', unlock, { once: true });
    return () => {
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('click', unlock);
    };
  }, []);

  // ── Points ticker (runs only while in chat) ───────────────
  useEffect(() => {
    if (appView !== 'chat') return;
    pointsIntervalRef.current = window.setInterval(() => {
      setPoints(prev => {
        if (prev <= 1) { setShowNoPointsModal(true); return 0; }
        return prev - 1;
      });
    }, 60_000);
    return () => {
      if (pointsIntervalRef.current) clearInterval(pointsIntervalRef.current);
    };
  }, [appView]);

  // ── WebRTC / WebSocket (runs on each chat session) ────────
  useEffect(() => {
    if (chatSessionId === 0) return;
    let stopped = false;

    const getSignalingUrl = () => {
      const env = (process.env.NEXT_PUBLIC_SIGNALING_URL ?? '').trim();
      if (env) return env;
      const host = window.location.hostname || 'localhost';
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      return `${protocol}://${host}:3001`;
    };

    const fetchIceConfig = async () => {
      try {
        const signalingBase = getSignalingUrl().replace(/^ws/, 'http');
        const res = await fetch(`${signalingBase}/ice-config`);
        if (res.ok) {
          const data = await res.json();
          if (data?.iceServers) rtcConfigRef.current = { iceServers: data.iceServers };
        }
      } catch { /* use default */ }
    };

    const ensureLocalMedia = async () => {
      if (localStreamRef.current) {
        // Stream pre-captured by home screen — wire it to the video element
        if (localVideoRef.current && localVideoRef.current.srcObject !== localStreamRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
        }
        return localStreamRef.current;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (stopped) { for (const t of stream.getTracks()) t.stop(); return null; }
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      return stream;
    };

    const cleanupPc = () => {
      politeRef.current = false;
      iceCandidateQueueRef.current = [];
      setDcReady(false);
      if (pcRef.current) {
        try {
          pcRef.current.onicecandidate = null;
          pcRef.current.ontrack = null;
          pcRef.current.onnegotiationneeded = null;
          pcRef.current.ondatachannel = null;
          pcRef.current.onconnectionstatechange = null;
          pcRef.current.close();
        } catch {}
        pcRef.current = null;
      }
      if (dataChannelRef.current) {
        try {
          dataChannelRef.current.onmessage = null;
          dataChannelRef.current.onopen = null;
          dataChannelRef.current.onclose = null;
          dataChannelRef.current.close();
        } catch {}
        dataChannelRef.current = null;
      }
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      setStrangerProfile(null);
    };

    const attachDataChannel = (dc: RTCDataChannel) => {
      if (dataChannelRef.current && dataChannelRef.current !== dc) {
        try { dc.close(); } catch {}
        return;
      }
      dataChannelRef.current = dc;
      dc.onopen = () => {
        setDcReady(true);
        const queued = pendingChatRef.current.splice(0);
        for (const text of queued) {
          try { dc.send(text); } catch { pendingChatRef.current.unshift(text); break; }
        }
      };
      dc.onmessage = (event) => {
        const text = String(event.data ?? '').trim();
        if (!text) return;
        setMessages(prev => [
          ...prev,
          { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, sender: 'stranger', text },
        ]);
        if (activeTabRef.current !== 'chat') setUnreadCount(prev => prev + 1);
      };
      dc.onclose = () => {
        if (dataChannelRef.current === dc) dataChannelRef.current = null;
        setDcReady(false);
      };
    };

    const stopRelayCapture = () => {
      if (relayIntervalRef.current !== null) { clearInterval(relayIntervalRef.current); relayIntervalRef.current = null; }
      if (audioRecorderRef.current) { try { audioRecorderRef.current.stop(); } catch {} audioRecorderRef.current = null; }
      audioHandlerRef.current = null;
    };

    const startRelayCapture = () => {
      stopRelayCapture();
      // Video: canvas → JPEG → WS (type byte 0)
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 240;
      const ctx = canvas.getContext('2d')!;
      relayIntervalRef.current = window.setInterval(() => {
        const video = localVideoRef.current;
        const ws = wsRef.current;
        if (!video || !video.videoWidth || !ws || ws.readyState !== WebSocket.OPEN) return;
        ctx.drawImage(video, 0, 0, 320, 240);
        canvas.toBlob(blob => {
          if (!blob) return;
          blob.arrayBuffer().then(buf => {
            const msg = new Uint8Array(1 + buf.byteLength);
            msg[0] = 0;
            msg.set(new Uint8Array(buf), 1);
            wsRef.current?.send(msg.buffer);
          });
        }, 'image/jpeg', 0.65);
      }, 100);

      // Audio: Web Audio API → PCM/WAV → cross-browser compatible (iOS + Android + Chrome)
      const stream = localStreamRef.current;
      if (!stream || !stream.getAudioTracks().length) return;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const audioCtx = audioCtxRef.current;
      audioCtx.resume().catch(() => {});
      audioNextTimeRef.current = audioCtx.currentTime;

      // Receiver: decodeAudioData works for WAV on all browsers including iOS
      audioHandlerRef.current = async (payload: ArrayBuffer) => {
        try {
          await audioCtx.resume();
          const audioBuf = await audioCtx.decodeAudioData(payload.slice(0));
          const src = audioCtx.createBufferSource();
          src.buffer = audioBuf;
          src.connect(audioCtx.destination);
          const now = audioCtx.currentTime;
          if (audioNextTimeRef.current > now + 0.12) audioNextTimeRef.current = now + 0.02;
          if (audioNextTimeRef.current < now + 0.02) audioNextTimeRef.current = now + 0.02;
          src.start(audioNextTimeRef.current);
          audioNextTimeRef.current += audioBuf.duration;
        } catch {}
      };

      // Sender: capture PCM via ScriptProcessor, encode as WAV (~42ms chunks)
      const buildWAV = (pcm: Int16Array, rate: number): ArrayBuffer => {
        const buf = new ArrayBuffer(44 + pcm.byteLength);
        const v = new DataView(buf);
        const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
        w(0, 'RIFF'); v.setUint32(4, 36 + pcm.byteLength, true);
        w(8, 'WAVE'); w(12, 'fmt ');
        v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
        v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
        v.setUint16(32, 2, true); v.setUint16(34, 16, true);
        w(36, 'data'); v.setUint32(40, pcm.byteLength, true);
        new Int16Array(buf, 44).set(pcm);
        return buf;
      };

      const audioStream = new MediaStream(stream.getAudioTracks());
      const source = audioCtx.createMediaStreamSource(audioStream);
      const processor = audioCtx.createScriptProcessor(2048, 1, 1);
      processor.onaudioprocess = (e) => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;
        const samples = e.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
          pcm[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
        }
        const wav = buildWAV(pcm, audioCtx.sampleRate);
        const msg = new Uint8Array(1 + wav.byteLength);
        msg[0] = 1;
        msg.set(new Uint8Array(wav), 1);
        wsRef.current!.send(msg.buffer);
      };
      source.connect(processor);
      processor.connect(audioCtx.destination);
      // Store cleanup handle
      (audioRecorderRef as any).current = { stop: () => { try { processor.disconnect(); source.disconnect(); } catch {} } };
    };

    const activateRelay = () => {
      setRelayMode(true);
      setSearching(false);
      setStatus('Conectado (relay)');
      startRelayCapture();
    };

    const setupPc = async (polite: boolean) => {
      cleanupPc();
      politeRef.current = polite;
      const stream = localStreamRef.current;
      if (!stream) return;
      const pc = new RTCPeerConnection(rtcConfigRef.current);
      pcRef.current = pc;
      for (const track of stream.getTracks()) pc.addTrack(track, stream);

      // Prefer H.264 for video — Safari has hardware acceleration for it
      try {
        for (const transceiver of pc.getTransceivers()) {
          if (transceiver.sender.track?.kind === 'video') {
            const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs ?? [];
            const h264 = codecs.filter(c => c.mimeType === 'video/H264');
            const rest = codecs.filter(c => c.mimeType !== 'video/H264');
            if (h264.length > 0) transceiver.setCodecPreferences([...h264, ...rest]);
          }
        }
      } catch {}

      pc.ontrack = (event) => {
        if (!remoteVideoRef.current) return;
        if (!(remoteVideoRef.current.srcObject instanceof MediaStream)) {
          remoteVideoRef.current.srcObject = new MediaStream();
        }
        (remoteVideoRef.current.srcObject as MediaStream).addTrack(event.track);
        // Reassign srcObject so iOS Safari detects the new track
        remoteVideoRef.current.srcObject = remoteVideoRef.current.srcObject;
        remoteVideoRef.current.play().catch(() => {});
        // Zero playout delay — show frames as soon as they arrive
        if (typeof (event.receiver as any).playoutDelayHint !== 'undefined') {
          (event.receiver as any).playoutDelayHint = 0;
        }
      };
      pc.ondatachannel = (event) => attachDataChannel(event.channel);
      if (!polite) { try { attachDataChannel(pc.createDataChannel('chat')); } catch {} }
      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        try { wsRef.current?.send(JSON.stringify({ type: 'ice-candidate', candidate: event.candidate.toJSON() })); } catch {}
      };
      pc.onnegotiationneeded = () => {};
      const switchToRelay = () => {
        if (pcRef.current !== pc) return;
        cleanupPc();
        if (!stopped && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'use-relay' }));
        }
        activateRelay();
      };
      const iceTimer = window.setTimeout(switchToRelay, 12000);
      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === 'connected') { clearTimeout(iceTimer); setSearching(false); setStatus('Conectado'); }
        if (st === 'connecting') setStatus('Conectando video...');
        if (st === 'disconnected') setStatus('Conexión interrumpida, esperando...');
        if (st === 'failed') { clearTimeout(iceTimer); switchToRelay(); }
      };
      if (!polite) {
        try {
          const offer = await pc.createOffer();
          if (pcRef.current !== pc) return;
          await pc.setLocalDescription(offer);
          wsRef.current?.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription! }));
        } catch {}
      }
    };

    const handleSignal = async (msg: SignalMessage) => {
      if (msg.type === 'waiting') {
        setSearching(true); setStatus('Buscando a alguien...'); setRoomId(''); setMessages([]); cleanupPc(); return;
      }
      if (msg.type === 'matched') {
        setRoomId(msg.roomId); setStatus('Conectando video...'); setMessages([]);
        setStrangerProfile(msg.stranger ?? null);
        await setupPc(msg.polite); return;
      }
      if (msg.type === 'peer-left') {
        cleanupPc(); stopRelayCapture(); setRelayMode(false); setSearching(true); setRoomId(''); setMessages([]);
        setStatus('El extraño se fue, buscando otro...');
        if (!stopped && wsRef.current?.readyState === WebSocket.OPEN) {
          setTimeout(() => {
            if (!stopped && wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'find-match', gender: prefGender, region: prefRegion, age: prefAge }));
            }
          }, 1500);
        }
        return;
      }
      if (msg.type === 'use-relay') { activateRelay(); return; }
      if (msg.type === 'relay-chat') {
        const text = String(msg.text ?? '').trim();
        if (!text) return;
        setMessages(prev => [...prev, { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, sender: 'stranger', text }]);
        if (activeTabRef.current !== 'chat') setUnreadCount(prev => prev + 1);
        return;
      }
      const pc = pcRef.current;
      if (!pc) return;
      if (msg.type === 'offer') {
        await pc.setRemoteDescription(msg.sdp);
        for (const c of iceCandidateQueueRef.current) { try { await pc.addIceCandidate(c); } catch {} }
        iceCandidateQueueRef.current = [];
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        wsRef.current?.send(JSON.stringify({ type: 'answer', sdp: pc.localDescription! }));
        return;
      }
      if (msg.type === 'answer') {
        await pc.setRemoteDescription(msg.sdp);
        for (const c of iceCandidateQueueRef.current) { try { await pc.addIceCandidate(c); } catch {} }
        iceCandidateQueueRef.current = [];
        return;
      }
      if (msg.type === 'ice-candidate') {
        if (!pc.remoteDescription) iceCandidateQueueRef.current.push(msg.candidate);
        else { try { await pc.addIceCandidate(msg.candidate); } catch {} }
      }
    };

    const scheduleReconnect = (attempt: number) => {
      if (stopped) return;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      const delay = Math.min(10_000, 500 * Math.pow(2, Math.min(6, attempt)));
      reconnectTimerRef.current = window.setTimeout(() => connect(attempt + 1).catch(console.error), delay);
    };

    const connect = async (attempt = 0) => {
      if (stopped) return;
      try {
        const stream = await ensureLocalMedia();
        if (!stream) return;
        if (attempt === 0) await fetchIceConfig();
        const ws = new WebSocket(getSignalingUrl());
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;
        ws.onopen = () => {
          setStatus('Buscando a alguien...');
          ws.send(JSON.stringify({ type: 'set-profile', ...myProfileRef.current }));
          ws.send(JSON.stringify({ type: 'find-match', gender: prefGender, region: prefRegion, age: prefAge }));
        };
        ws.onerror = () => setStatus('Error: no se pudo conectar al servidor');
        ws.onmessage = async (event) => {
          try {
            if (event.data instanceof ArrayBuffer) {
              const view = new Uint8Array(event.data);
              const type = view[0];
              const payload = event.data.slice(1);
              if (type === 0) {
                const blob = new Blob([payload], { type: 'image/jpeg' });
                const url = URL.createObjectURL(blob);
                if (lastFrameUrlRef.current) URL.revokeObjectURL(lastFrameUrlRef.current);
                lastFrameUrlRef.current = url;
                if (remoteImgRef.current) remoteImgRef.current.src = url;
              } else if (type === 1) {
                audioHandlerRef.current?.(payload);
              }
              return;
            }
            const data = JSON.parse(String(event.data)) as SignalMessage;
            await handleSignal(data);
          } catch (e) { console.error(e); }
        };
        ws.onclose = () => { if (!stopped) { setStatus('Reconectando...'); scheduleReconnect(attempt); } };
      } catch (e) { console.error(e); scheduleReconnect(attempt); }
    };

    connect().catch(console.error);

    return () => {
      stopped = true;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      if (relayIntervalRef.current !== null) { clearInterval(relayIntervalRef.current); relayIntervalRef.current = null; }
      if (audioRecorderRef.current) { try { audioRecorderRef.current.stop(); } catch {} audioRecorderRef.current = null; }
      audioHandlerRef.current = null;
      if (lastFrameUrlRef.current) { URL.revokeObjectURL(lastFrameUrlRef.current); lastFrameUrlRef.current = null; }
      try { wsRef.current?.send(JSON.stringify({ type: 'leave' })); } catch {}
      try { wsRef.current?.close(); } catch {}
      wsRef.current = null;
      cleanupPc();
      if (localStreamRef.current) {
        for (const t of localStreamRef.current.getTracks()) t.stop();
        localStreamRef.current = null;
      }
    };
  }, [chatSessionId]);

  // ── Flip camera ───────────────────────────────────────────
  const handleFlipCamera = async () => {
    const newFacing = facingMode === 'user' ? 'environment' : 'user';

    // Stop existing video track first — required on most mobile browsers
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(t => t.stop());
    }

    // iOS needs a moment to fully release the camera hardware
    await new Promise(resolve => setTimeout(resolve, 300));

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newFacing },
        audio: false,
      });
      const newVideoTrack = newStream.getVideoTracks()[0];
      if (!newVideoTrack) return;

      // Replace track in peer connection (no call interruption)
      if (pcRef.current) {
        const sender = pcRef.current.getSenders().find(s => s.track?.kind === 'video');
        if (sender) await sender.replaceTrack(newVideoTrack);
      }

      // Swap track in local stream
      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach(t => localStreamRef.current!.removeTrack(t));
        localStreamRef.current.addTrack(newVideoTrack);
      }

      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
      setFacingMode(newFacing);
    } catch {
      // Fallback: restart full stream with new facing mode
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        const newVideoTrack = newStream.getVideoTracks()[0];
        if (pcRef.current) {
          const sender = pcRef.current.getSenders().find(s => s.track?.kind === 'video');
          if (sender) await sender.replaceTrack(newVideoTrack);
        }
        if (localStreamRef.current) {
          localStreamRef.current.getVideoTracks().forEach(t => localStreamRef.current!.removeTrack(t));
          localStreamRef.current.addTrack(newVideoTrack);
        }
        if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
        setFacingMode(newFacing);
      } catch {
        alert('No se pudo cambiar la cámara.');
      }
    }
  };

  // ── Handlers ──────────────────────────────────────────────
  const handleEnterChat = async () => {
    setEnteringChat(true);
    try {
      if (!localStreamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
      }
      setAppView('chat');
      setChatSessionId(prev => prev + 1);
    } catch {
      alert('Necesitamos acceso a tu cámara y micrófono para continuar.');
    } finally {
      setEnteringChat(false);
    }
  };

  // ── Load & save connections ───────────────────────────────
  const loadConnections = async () => {
    if (!session?.user?.email) return;
    try {
      const res = await fetch('/api/connections');
      const data = await res.json();
      if (data.connections) setMyConnections(data.connections);
    } catch {}
  };

  useEffect(() => { loadConnections(); }, [session]);
  useEffect(() => { loadPendingInvites(); }, [session]);

  const handleSaveConnection = async () => {
    if (!strangerProfile) return;
    if (myConnections.length >= 5 && !session?.user?.email) { setShowUpgradeModal(true); return; }
    if (myConnections.length >= 5) { setShowUpgradeModal(true); return; }
    setConnectionSaving(true);
    try {
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          stranger_name:  strangerProfile.name,
          stranger_email: strangerProfile.email,
          stranger_photo: strangerProfile.photo,
          room_id: roomId,
          note: connectionNote,
        }),
      });
      if (res.ok) {
        await loadConnections();
        setShowSaveModal(false);
        setConnectionNote('');
      }
    } catch {} finally { setConnectionSaving(false); }
  };

  const handleDeleteConnection = async (id: string) => {
    try {
      await fetch('/api/connections', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setMyConnections(prev => prev.filter(c => c.id !== id));
    } catch {}
  };

  // ── Invite handlers ──────────────────────────────────────
  const loadPendingInvites = async () => {
    if (!session?.user?.email) return;
    try {
      const res = await fetch(`/api/invite?to_email=${encodeURIComponent(session.user.email)}`);
      const data = await res.json();
      if (data.invites) setPendingInvites(data.invites);
    } catch {}
  };

  const handleSendInvite = async () => {
    if (!inviteDate || !inviteTime || !inviteConnection?.stranger_email) return;
    setInviteSaving(true);
    try {
      const scheduled_at = new Date(`${inviteDate}T${inviteTime}`).toISOString();
      const res = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          to_email:    inviteConnection.stranger_email,
          to_name:     inviteConnection.stranger_name,
          scheduled_at,
          message:     inviteMessage || null,
        }),
      });
      if (res.ok) {
        setInviteSent(true);
        setTimeout(() => {
          setShowInviteModal(false);
          setInviteSent(false);
          setInviteDate(''); setInviteTime(''); setInviteMessage('');
          setInviteConnection(null);
        }, 2000);
      }
    } catch {} finally { setInviteSaving(false); }
  };

  const handleRespondInvite = async (action: 'accept' | 'decline') => {
    if (!currentInviteToken) return;
    setAcceptLoading(true);
    try {
      const res = await fetch(`/api/invite/${currentInviteToken}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        setAcceptDone(action === 'accept' ? 'accepted' : 'declined');
        if (action === 'accept') await loadSlots();
        setPendingInvites(prev => prev.filter(i => i.token !== currentInviteToken));
        setTimeout(() => {
          setShowAcceptModal(false);
          setCurrentInvite(null);
          setCurrentInviteToken(null);
          setAcceptDone(null);
          window.history.replaceState({}, '', '/');
        }, 2500);
      }
    } catch {} finally { setAcceptLoading(false); }
  };

  // ── Load scheduled slots ──────────────────────────────────
  const loadSlots = async () => {
    if (!session?.user?.email) return;
    try {
      const res = await fetch('/api/schedule');
      const data = await res.json();
      if (data.slots) setMySlots(data.slots);
    } catch {}
  };

  useEffect(() => { loadSlots(); }, [session]);

  const handleCreateSlot = async () => {
    if (!scheduleDate || !scheduleTime) return;
    setScheduleSaving(true);
    try {
      const scheduled_at = new Date(`${scheduleDate}T${scheduleTime}`).toISOString();
      const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scheduled_at, note: scheduleNote }),
      });
      if (res.ok) {
        await loadSlots();
        setShowScheduleModal(false);
        setScheduleDate(''); setScheduleTime(''); setScheduleNote('');
      }
    } catch {} finally { setScheduleSaving(false); }
  };

  const handleCancelSlot = async (id: string) => {
    try {
      await fetch('/api/schedule', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setMySlots(prev => prev.filter(s => s.id !== id));
    } catch {}
  };

  const handleBuyPoints = async (pkg: string) => {
    if (!session) { signIn('google'); return; }
    setPaymentLoading(pkg);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pkg }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch {
      alert('Error al procesar el pago. Intenta de nuevo.');
    } finally {
      setPaymentLoading(null);
    }
  };

  const doStop = () => {
    if (pointsIntervalRef.current) { clearInterval(pointsIntervalRef.current); pointsIntervalRef.current = null; }
    setPoints(prev => { savePoints(prev); return prev; });
    setShowNoPointsModal(false);
    setRelayMode(false);
    setDcReady(false);
    setSearching(true);
    setMessages([]);
    setRoomId('');
    setStatus('Conectando al servidor...');
    setChatSessionId(0);
    setAppView('home');
  };

  const handleStop = () => {
    if (!searching) {
      setPendingRatingAction('stop');
      setRatingValue(0);
      setShowRatingModal(true);
    } else {
      doStop();
    }
  };

  const _doNext = () => {
    if (pcRef.current) { try { pcRef.current.close(); } catch {} pcRef.current = null; }
    if (dataChannelRef.current) { try { dataChannelRef.current.close(); } catch {} dataChannelRef.current = null; }
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (relayIntervalRef.current !== null) { clearInterval(relayIntervalRef.current); relayIntervalRef.current = null; }
    if (lastFrameUrlRef.current) { URL.revokeObjectURL(lastFrameUrlRef.current); lastFrameUrlRef.current = null; }
    if (remoteImgRef.current) remoteImgRef.current.src = '';
    if (audioRecorderRef.current) { try { audioRecorderRef.current.stop(); } catch {} audioRecorderRef.current = null; }
    audioHandlerRef.current = null;
    politeRef.current = false;
    setRelayMode(false);
    setSearching(true);
    setMessages([]);
    setRoomId('');
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'find-match', gender: prefGenderRef.current, region: prefRegionRef.current, age: prefAgeRef.current }));
    }
  };

  const handleNext = () => {
    if (!searching) {
      setPendingRatingAction('next');
      setRatingValue(0);
      setShowRatingModal(true);
    } else {
      _doNext();
    }
  };

  const handleRatingSubmit = (stars: number) => {
    if (stars > 0) {
      const entry = { stars, comment: ratingComment.trim(), date: new Date().toISOString() };
      const updated = [entry, ...ratingsGiven];
      setRatingsGiven(updated);
      localStorage.setItem('va_ratings_given', JSON.stringify(updated));
    }
    setShowRatingModal(false);
    setRatingValue(0);
    setRatingComment('');
    if (pendingRatingAction === 'next') _doNext();
    else if (pendingRatingAction === 'stop') doStop();
    setPendingRatingAction(null);
  };

  const handleSendMessage = () => {
    const text = inputValue.trim();
    if (!text) return;
    const lower = text.toLowerCase();
    if (BANNED_WORDS.some(w => lower.includes(w))) {
      setBlockedWarning(true);
      setTimeout(() => setBlockedWarning(false), 2500);
      setInputValue('');
      return;
    }
    setMessages(prev => [...prev, { id: Date.now().toString(), sender: 'user', text }]);
    const dc = dataChannelRef.current;
    if (dc?.readyState === 'open') { try { dc.send(text); } catch {} }
    else if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'relay-chat', text }));
    }
    setInputValue('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
  };

  // ── Chat JSX helpers ──────────────────────────────────────
  const messagesList = messages.map((msg) => (
    <div key={msg.id} style={{ display: 'flex', justifyContent: msg.sender === 'user' ? 'flex-end' : 'flex-start' }}>
      {msg.sender === 'stranger' ? (
        <div style={{ maxWidth: 240 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(165,180,252,0.7)', marginBottom: 4, marginLeft: 10, letterSpacing: '0.08em' }}>EXTRAÑO</div>
          <div style={{ background: 'rgba(255,255,255,0.92)', color: '#0e0e2e', padding: '10px 16px', borderRadius: 20, fontSize: 14, boxShadow: '0 2px 12px rgba(0,0,0,0.3)' }}>{msg.text}</div>
        </div>
      ) : (
        <div style={{ maxWidth: 240 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#a5b4fc', marginBottom: 4, marginRight: 10, textAlign: 'right', letterSpacing: '0.08em' }}>TÚ</div>
          <div style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', color: 'white', padding: '10px 16px', borderRadius: 20, fontSize: 14, boxShadow: '0 2px 12px rgba(99,102,241,0.4)' }}>{msg.text}</div>
        </div>
      )}
    </div>
  ));

  // ── Shared premium menu items ─────────────────────────────
  const premiumItems = [
    { icon: '🌍', label: 'Filtro por País', cost: '2 pts/min' },
    { icon: '⚧', label: 'Género Exacto', cost: '1 pt/min' },
  ];

  // ── Render ────────────────────────────────────────────────
  return (
    <div
      style={{
        position: 'fixed',
        top: 'var(--app-top, 0px)',
        left: 0, right: 0,
        height: 'var(--app-h, 100dvh)',
        overflow: 'hidden',
        background: '#07071a',
      }}
    >
      {/* ════════════════ HOME VIEW ════════════════ */}
      <div
        style={{
          position: 'absolute', inset: 0,
          opacity: appView === 'home' ? 1 : 0,
          transform: appView === 'home' ? 'scale(1)' : 'scale(0.96)',
          transition: 'opacity 0.45s ease, transform 0.45s ease',
          pointerEvents: appView === 'home' ? 'auto' : 'none',
          background: 'linear-gradient(160deg, #07071a 0%, #0e0e2e 55%, #07071a 100%)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <div style={{ width: '100%', maxWidth: 340, padding: '0 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          {/* Logo */}
          <div style={{
            width: 84, height: 84, borderRadius: '50%',
            background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 26, fontWeight: 800, color: 'white',
            animation: 'logo-pulse 3s ease-in-out infinite',
            marginBottom: 22,
          }}>
            VA
          </div>
          <h1 style={{
            fontFamily: 'Georgia, "Times New Roman", serif',
            fontSize: 21, fontWeight: 400, color: 'white',
            letterSpacing: '0.22em', textTransform: 'uppercase', margin: '0 0 8px',
          }}>
            The Velvet Aperture
          </h1>
          <p style={{ color: 'rgba(165,180,252,0.6)', fontSize: 14, fontStyle: 'italic', margin: '0 0 48px' }}>
            Encuentra tu conexión
          </p>

          {/* Entrar al Chat */}
          <button
            onClick={handleEnterChat}
            disabled={enteringChat}
            style={{
              width: '100%', padding: '17px 0',
              background: enteringChat ? 'rgba(99,102,241,0.35)' : 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
              border: 'none', borderRadius: 16,
              color: 'white', fontSize: 15, fontWeight: 800,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              cursor: enteringChat ? 'not-allowed' : 'pointer',
              boxShadow: enteringChat ? 'none' : '0 0 35px rgba(99,102,241,0.5), 0 6px 24px rgba(0,0,0,0.4)',
              transition: 'all 0.2s', marginBottom: 14,
            }}
          >
            {enteringChat ? 'Abriendo cámara...' : 'Entrar al Chat'}
          </button>

          {/* Iniciar sesión con Google */}
          <button
            onClick={() => session ? signOut() : signIn('google')}
            style={{
              width: '100%', padding: '15px 0',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 16, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.09)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
              <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: 600 }}>
              {session ? `Conectado como ${session.user?.name?.split(' ')[0]}` : 'Continuar con Google'}
            </span>
          </button>

          <p style={{ color: 'rgba(255,255,255,0.18)', fontSize: 11, marginTop: 24 }}>
            Al entrar aceptas nuestros términos de uso · +18
          </p>
        </div>
      </div>

      {/* ════════════════ CHAT VIEW ════════════════ */}
      <div
        style={{
          position: 'absolute', inset: 0,
          opacity: appView === 'chat' ? 1 : 0,
          transform: appView === 'chat' ? 'scale(1)' : 'scale(1.04)',
          transition: 'opacity 0.45s ease, transform 0.45s ease',
          pointerEvents: appView === 'chat' ? 'auto' : 'none',
          display: 'flex', justifyContent: 'center',
          background: 'linear-gradient(160deg, #07071a 0%, #0e0e2e 55%, #07071a 100%)',
        }}
      >
        <div style={{ width: '100%', maxWidth: 448, display: 'flex', flexDirection: 'column', height: '100%' }}>

          {/* ── Tab content area ── */}
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>

            {/* ── INICIO TAB ── */}
            {activeTab === 'home' && (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Header */}
                <div style={{ background: 'rgba(7,7,26,0.92)', backdropFilter: 'blur(14px)', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
                  <div style={{ padding: '20px 20px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <p style={{ color: 'rgba(165,180,252,0.5)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', margin: '0 0 2px' }}>En línea ahora</p>
                      <h2 style={{ color: 'white', fontSize: 20, fontWeight: 700, margin: 0 }}>
                        <span style={{ color: '#a5b4fc' }}>2.4k</span> personas
                      </h2>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 20, padding: '6px 14px', marginBottom: 6 }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 6px #4ade80' }} />
                        <span style={{ color: 'rgba(165,180,252,0.8)', fontSize: 12, fontWeight: 600 }}>🪙 {points}</span>
                      </div>
                    </div>
                  </div>
                  {/* Points progress bar */}
                  <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', margin: '0 20px 14px' }}>
                    <div style={{ height: '100%', width: `${(points / 540) * 100}%`, background: points > 100 ? 'linear-gradient(90deg,#4f46e5,#7c3aed)' : 'linear-gradient(90deg,#ef4444,#f97316)', borderRadius: 2, transition: 'width 1s ease' }} />
                  </div>
                </div>

                {/* Swipe card */}
                {(() => {
                  const p = MOCK_PROFILES[profileIdx];
                  return (
                    <div style={{ flex: 1, overflow: 'hidden', padding: '14px 16px 16px' }}>
                      <div style={{ height: '100%', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 26, overflow: 'hidden', position: 'relative' }}>
                        {/* Photo */}
                        {profilePhoto ? (
                          <img src={profilePhoto} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: `hue-rotate(${p.hue}deg) saturate(1.15)` }} />
                        ) : (
                          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(99,102,241,0.06)' }}>
                            <Video size={56} color="rgba(165,180,252,0.25)" />
                          </div>
                        )}
                        {/* Gradient overlay */}
                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%', background: 'linear-gradient(to top, rgba(7,7,26,0.98) 0%, rgba(7,7,26,0.5) 50%, transparent 100%)' }} />
                        {/* Live badge */}
                        <div style={{ position: 'absolute', top: 16, left: 16, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', borderRadius: 10, padding: '5px 11px', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 8px #4ade80' }} />
                          <span style={{ color: 'white', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em' }}>EN VIVO</span>
                        </div>
                        {/* Counter */}
                        <div style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', borderRadius: 10, padding: '5px 11px' }}>
                          <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: 600 }}>{profileIdx + 1} / {MOCK_PROFILES.length}</span>
                        </div>
                        {/* Info */}
                        <div style={{ position: 'absolute', bottom: 90, left: 20 }}>
                          <div style={{ color: 'white', fontSize: 28, fontWeight: 800, marginBottom: 8 }}>{p.flag} {p.age} años</div>
                          <span style={{ background: 'rgba(99,102,241,0.28)', border: '1px solid rgba(99,102,241,0.5)', color: '#a5b4fc', fontSize: 13, fontWeight: 600, padding: '5px 14px', borderRadius: 20 }}>{p.tag}</span>
                        </div>
                        {/* Action buttons */}
                        <div style={{ position: 'absolute', bottom: 18, left: 18, right: 18, display: 'flex', gap: 8 }}>
                          <button
                            onClick={() => setProfileIdx(i => (i + 1) % MOCK_PROFILES.length)}
                            style={{ width: 48, height: 48, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 14, color: 'white', fontWeight: 700, fontSize: 18, cursor: 'pointer', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                          >
                            →
                          </button>
                          <button
                            onClick={() => setSelectedProfile(p)}
                            style={{ flex: 1, padding: '14px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 14, color: 'white', fontWeight: 700, fontSize: 14, cursor: 'pointer', backdropFilter: 'blur(10px)' }}
                          >
                            Ver perfil
                          </button>
                          <button
                            onClick={() => { setActiveTab('chat'); handleNext(); }}
                            style={{ flex: 1, padding: '14px', background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', border: 'none', borderRadius: 14, color: 'white', fontWeight: 800, fontSize: 14, cursor: 'pointer', boxShadow: '0 0 28px rgba(99,102,241,0.55)' }}
                          >
                            Conectar
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ── CHAT TAB — always in DOM so WebRTC stays alive ── */}
            <div style={{ display: activeTab === 'chat' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
              {/* Top bar */}
              <div style={{ background: 'rgba(7,7,26,0.88)', backdropFilter: 'blur(14px)', borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, zIndex: 40, position: 'relative' }}>
                <div style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.35)', color: '#a5b4fc', padding: '7px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600 }}>
                  {searching ? 'Buscando...' : 'Extraño'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', padding: '7px 14px', borderRadius: 20, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#a5b4fc', fontWeight: 600 }}>🪙 {points}</span>
                    <span style={{ color: 'rgba(255,255,255,0.2)' }}>|</span>
                    <span style={{ color: 'rgba(255,255,255,0.4)' }}>🔗 {roomId || '...'}</span>
                  </div>
                  <div style={{ position: 'relative' }}>
                    <button onClick={() => setShowPremiumMenu(v => !v)} style={{ background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.4)', borderRadius: 20, padding: '7px 10px', color: '#a5b4fc', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                      <Diamond size={13} />
                    </button>
                    {showPremiumMenu && (
                      <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, background: 'rgba(12,12,38,0.97)', backdropFilter: 'blur(20px)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 14, padding: '8px', minWidth: 210, zIndex: 50, boxShadow: '0 12px 40px rgba(0,0,0,0.7)' }}>
                        <div style={{ padding: '4px 10px 8px', color: 'rgba(165,180,252,0.5)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Filtros Premium</div>
                        {premiumItems.map(item => (
                          <button key={item.label} onClick={() => setShowPremiumMenu(false)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '9px 10px', borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer', color: 'white', fontSize: 12, textAlign: 'left' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.15)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                            <span>{item.icon} {item.label}</span>
                            <span style={{ color: '#818cf8', fontSize: 11, fontWeight: 700 }}>{item.cost}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {/* Video area – remote fullscreen + local PiP */}
              <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#07071a' }}>
                {/* Remote video – fills entire area */}
                <video ref={remoteVideoRef} autoPlay playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: relayMode ? 'none' : 'block' }} />
                <img ref={remoteImgRef} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: relayMode ? 'block' : 'none' }} />

                {/* Searching overlay with pulsing rings */}
                {searching && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(7,7,26,0.93)', zIndex: 10 }}>
                    <div style={{ textAlign: 'center', position: 'relative' }}>
                      {[0, 1, 2].map(i => (
                        <div key={i} style={{ position: 'absolute', top: '50%', left: '50%', width: 64, height: 64, borderRadius: '50%', border: '2px solid rgba(99,102,241,0.55)', animation: `pulse-ring 2.2s ease-out ${i * 0.73}s infinite` }} />
                      ))}
                      <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 22px', fontSize: 28, boxShadow: '0 0 40px rgba(99,102,241,0.65)', position: 'relative', zIndex: 1 }}>🔍</div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: 'rgba(165,180,252,0.9)', position: 'relative', zIndex: 1 }}>Buscando a alguien...</div>
                      <div style={{ fontSize: 11, color: 'rgba(165,180,252,0.4)', marginTop: 8, position: 'relative', zIndex: 1 }}>{status}</div>
                    </div>
                  </div>
                )}

                {/* Extraño label */}
                {!searching && <span style={{ position: 'absolute', top: 10, left: 12, background: 'rgba(7,7,26,0.65)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(165,180,252,0.9)', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, zIndex: 5 }}>Extraño</span>}

                {/* Local video PiP */}
                <div style={{ position: 'absolute', top: 12, right: 12, width: 92, height: 134, borderRadius: 16, overflow: 'hidden', border: '2px solid rgba(99,102,241,0.45)', boxShadow: '0 6px 28px rgba(0,0,0,0.75)', zIndex: 20 }}>
                  <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }} />
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.65), transparent)', paddingTop: 10, paddingBottom: 5, textAlign: 'center' }}>
                    <span style={{ color: 'white', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em' }}>TÚ</span>
                  </div>
                </div>

                {/* Flip camera button — below PiP, easy to tap */}
                <button
                  onClick={handleFlipCamera}
                  style={{ position: 'absolute', top: 154, right: 12, width: 44, height: 44, borderRadius: '50%', background: 'rgba(7,7,26,0.75)', backdropFilter: 'blur(8px)', border: '1px solid rgba(99,102,241,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.5)' }}
                >
                  <SwitchCamera size={20} color="#a5b4fc" />
                </button>

                {/* Save connection button — visible when connected and stranger has a profile */}
                {!searching && strangerProfile && (
                  <button
                    onClick={() => setShowSaveModal(true)}
                    style={{
                      position: 'absolute', top: 12, left: 12, zIndex: 20,
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '8px 14px', borderRadius: 20,
                      background: 'rgba(99,102,241,0.85)', backdropFilter: 'blur(8px)',
                      border: '1px solid rgba(165,180,252,0.4)',
                      color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      boxShadow: '0 2px 12px rgba(99,102,241,0.4)',
                    }}
                  >
                    <span>💾</span> Guardar conexión
                  </button>
                )}

                {/* Messages overlay */}
                <div style={{ position: 'absolute', bottom: 108, left: 0, right: 0, maxHeight: 150, overflowY: 'auto', padding: '0 16px', pointerEvents: 'none', zIndex: 15 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{messagesList}</div>
                  <div ref={messagesEndRef} />
                </div>

                {/* Floating controls */}
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(to top, rgba(7,7,26,0.96) 0%, rgba(7,7,26,0.5) 65%, transparent 100%)', zIndex: 20, paddingTop: 44 }}>
                  <div style={{ padding: '0 16px 8px', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="text" value={inputValue} onChange={e => setInputValue(e.target.value)} onKeyPress={handleKeyPress} placeholder={searching ? 'Esperando conexión...' : 'Escribe un mensaje...'} disabled={searching}
                      style={{ flex: 1, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(99,102,241,0.25)', color: 'white', borderRadius: 24, padding: '11px 16px', fontSize: 14, outline: 'none', opacity: searching ? 0.4 : 1 }} />
                    <button onClick={handleSendMessage} style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', color: 'white', border: 'none', borderRadius: '50%', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, boxShadow: '0 0 16px rgba(99,102,241,0.5)' }}>
                      <Send size={18} />
                    </button>
                  </div>
                  <div style={{ padding: '0 16px 18px', display: 'flex', gap: 10 }}>
                    <button onClick={handleStop} style={{ background: 'rgba(239,68,68,0.85)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 14, padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 18px rgba(239,68,68,0.35)' }}>
                      <Square size={22} fill="white" color="white" />
                    </button>
                    <button onClick={handleNext} style={{ flex: 1, background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', border: 'none', borderRadius: 14, color: 'white', fontWeight: 800, fontSize: 14, letterSpacing: '0.06em', padding: '12px', cursor: 'pointer', boxShadow: '0 0 22px rgba(99,102,241,0.45)' }}>
                      Siguiente
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* ── BUSCAR TAB ── */}
            {activeTab === 'search' && (
              <div style={{ height: '100%', overflowY: 'auto', padding: '32px 24px' }}>
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>Buscar personas</p>
                <h2 style={{ color: 'white', fontSize: 20, fontWeight: 700, margin: '0 0 28px' }}>Filtros</h2>
                {/* Gender */}
                <div style={{ marginBottom: 22 }}>
                  <p style={{ color: 'rgba(165,180,252,0.5)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 10px' }}>Género</p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {['Todos', 'Hombres', 'Mujeres'].map(g => (
                      <button key={g} onClick={() => setPrefGender(g)} style={{ flex: 1, padding: '10px 0', borderRadius: 12, fontSize: 13, fontWeight: 500, border: prefGender === g ? '1px solid rgba(99,102,241,0.8)' : '1px solid rgba(255,255,255,0.09)', background: prefGender === g ? 'rgba(99,102,241,0.22)' : 'rgba(255,255,255,0.03)', color: prefGender === g ? '#a5b4fc' : 'rgba(255,255,255,0.5)', cursor: 'pointer', transition: 'all 0.15s' }}>{g}</button>
                    ))}
                  </div>
                </div>
                {/* Region */}
                <div style={{ marginBottom: 22 }}>
                  <p style={{ color: 'rgba(165,180,252,0.5)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 10px' }}>Región</p>
                  <div style={{ position: 'relative' }}>
                    <select value={prefRegion} onChange={e => setPrefRegion(e.target.value)} style={{ width: '100%', padding: '11px 36px 11px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 12, color: 'rgba(255,255,255,0.75)', fontSize: 13, cursor: 'pointer', appearance: 'none', outline: 'none' }}>
                      {REGIONS.map(r => <option key={r} value={r} style={{ background: '#1a1a3e' }}>{r}</option>)}
                    </select>
                    <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)', pointerEvents: 'none' }}>▾</span>
                  </div>
                </div>
                {/* Age */}
                <div style={{ marginBottom: 32 }}>
                  <p style={{ color: 'rgba(165,180,252,0.5)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 10px' }}>Edad</p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {['Todos', '18–25', '26–35', '36+'].map(a => (
                      <button key={a} onClick={() => setPrefAge(a)} style={{ flex: 1, padding: '10px 0', borderRadius: 12, fontSize: 12, fontWeight: 500, border: prefAge === a ? '1px solid rgba(99,102,241,0.8)' : '1px solid rgba(255,255,255,0.09)', background: prefAge === a ? 'rgba(99,102,241,0.22)' : 'rgba(255,255,255,0.03)', color: prefAge === a ? '#a5b4fc' : 'rgba(255,255,255,0.5)', cursor: 'pointer', transition: 'all 0.15s' }}>{a}</button>
                    ))}
                  </div>
                </div>
                <button onClick={() => { setActiveTab('chat'); handleNext(); }} style={{ width: '100%', padding: '15px', background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', border: 'none', borderRadius: 14, color: 'white', fontWeight: 800, fontSize: 14, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer', boxShadow: '0 0 28px rgba(99,102,241,0.45)' }}>
                  Buscar ahora
                </button>
              </div>
            )}

            {/* ── PERFIL TAB ── */}
            {activeTab === 'profile' && (
              <div style={{ height: '100%', overflowY: 'auto', padding: '28px 20px 32px' }}>
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>Tu cuenta</p>
                <h2 style={{ color: 'white', fontSize: 20, fontWeight: 700, margin: '0 0 24px' }}>Perfil</h2>

                {/* Avatar + name */}
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = ev => {
                      const result = ev.target?.result as string;
                      setCustomPhoto(result);
                    };
                    reader.readAsDataURL(file);
                    e.target.value = '';
                  }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 24, gap: 14 }}>
                  {/* Tappable photo */}
                  <div
                    onClick={() => photoInputRef.current?.click()}
                    style={{ position: 'relative', cursor: 'pointer', flexShrink: 0 }}
                  >
                    {customPhoto || session?.user?.image ? (
                      <img
                        src={customPhoto || session!.user!.image!}
                        alt=""
                        style={{ width: 90, height: 90, borderRadius: '50%', border: '3px solid rgba(99,102,241,0.6)', objectFit: 'cover', boxShadow: '0 0 28px rgba(99,102,241,0.4)', display: 'block' }}
                      />
                    ) : (
                      <div style={{ width: 90, height: 90, borderRadius: '50%', background: 'rgba(99,102,241,0.2)', border: '2px solid rgba(99,102,241,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <User size={36} color="rgba(165,180,252,0.7)" />
                      </div>
                    )}
                    {/* Camera overlay */}
                    <div style={{ position: 'absolute', bottom: 2, right: 2, width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>
                      <span style={{ fontSize: 14 }}>📷</span>
                    </div>
                  </div>

                  {/* Editable name */}
                  <div style={{ width: '100%' }}>
                    <p style={{ color: 'rgba(165,180,252,0.5)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 6px', textAlign: 'center' }}>Nombre</p>
                    <input
                      type="text"
                      value={displayName || session?.user?.name || ''}
                      onChange={e => setDisplayName(e.target.value)}
                      placeholder={session?.user?.name ?? 'Tu nombre'}
                      maxLength={40}
                      style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 12, color: 'white', fontSize: 15, fontWeight: 600, padding: '10px 14px', outline: 'none', boxSizing: 'border-box', textAlign: 'center' }}
                    />
                  </div>

                  {/* Email + rating */}
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ color: 'rgba(165,180,252,0.4)', fontSize: 12, margin: '0 0 4px' }}>{session?.user?.email ?? 'Sin cuenta vinculada'}</p>
                    {ratingsGiven.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                        <span style={{ color: '#fbbf24', fontSize: 13 }}>{'★'.repeat(Math.round(ratingsGiven.reduce((a,b)=>a+b.stars,0)/ratingsGiven.length))}</span>
                        <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>{(ratingsGiven.reduce((a,b)=>a+b.stars,0)/ratingsGiven.length).toFixed(1)} · {ratingsGiven.length} cal.</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Stats */}
                <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '4px 0', marginBottom: 20 }}>
                  {[
                    { label: 'Puntos disponibles', value: `${points} 🪙` },
                    { label: 'Calificaciones dadas', value: `${ratingsGiven.length}` },
                    { label: 'Plan', value: 'Gratuito' },
                  ].map((item, i, arr) => (
                    <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 16px', borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                      <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>{item.label}</span>
                      <span style={{ color: '#a5b4fc', fontWeight: 600, fontSize: 13 }}>{item.value}</span>
                    </div>
                  ))}
                </div>

                {/* Bio */}
                <div style={{ marginBottom: 18 }}>
                  <p style={{ color: 'rgba(165,180,252,0.5)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 8px' }}>Bio</p>
                  <textarea
                    value={bio}
                    onChange={e => setBio(e.target.value)}
                    placeholder="Cuéntanos algo de ti..."
                    maxLength={120}
                    rows={3}
                    style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 12, color: 'white', fontSize: 14, padding: '11px 14px', resize: 'none', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                  />
                  <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, textAlign: 'right', margin: '4px 0 0' }}>{bio.length}/120</p>
                </div>

                {/* Age */}
                <div style={{ marginBottom: 18 }}>
                  <p style={{ color: 'rgba(165,180,252,0.5)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 8px' }}>Edad</p>
                  <input
                    type="number"
                    value={userAge}
                    onChange={e => setUserAge(e.target.value)}
                    placeholder="Tu edad"
                    min={18} max={99}
                    style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 12, color: 'white', fontSize: 14, padding: '11px 14px', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>

                {/* Interests */}
                <div style={{ marginBottom: 24 }}>
                  <p style={{ color: 'rgba(165,180,252,0.5)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 10px' }}>Intereses</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {ALL_INTERESTS.map(interest => {
                      const active = interests.includes(interest);
                      return (
                        <button
                          key={interest}
                          onClick={() => setInterests(prev => active ? prev.filter(i => i !== interest) : [...prev, interest])}
                          style={{ padding: '7px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500, border: active ? '1px solid rgba(99,102,241,0.8)' : '1px solid rgba(255,255,255,0.09)', background: active ? 'rgba(99,102,241,0.22)' : 'rgba(255,255,255,0.03)', color: active ? '#a5b4fc' : 'rgba(255,255,255,0.5)', cursor: 'pointer', transition: 'all 0.15s' }}
                        >
                          {interest}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Save button */}
                <button
                  onClick={() => {
                    localStorage.setItem('va_bio', bio);
                    localStorage.setItem('va_age', userAge);
                    localStorage.setItem('va_interests', JSON.stringify(interests));
                    localStorage.setItem('va_name', displayName);
                    if (customPhoto) localStorage.setItem('va_photo', customPhoto);
                    setProfileSaved(true);
                    setTimeout(() => setProfileSaved(false), 2000);
                  }}
                  style={{ width: '100%', padding: '14px', background: profileSaved ? 'rgba(74,222,128,0.15)' : 'linear-gradient(135deg,#4f46e5,#7c3aed)', border: profileSaved ? '1px solid rgba(74,222,128,0.4)' : 'none', borderRadius: 14, color: profileSaved ? '#4ade80' : 'white', fontWeight: 800, fontSize: 14, cursor: 'pointer', marginBottom: 12, transition: 'all 0.3s', boxShadow: profileSaved ? 'none' : '0 0 22px rgba(99,102,241,0.35)' }}
                >
                  {profileSaved ? '✓ Guardado' : 'Guardar perfil'}
                </button>

                {/* My connections */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <p style={{ color: 'rgba(165,180,252,0.5)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
                      Mis conexiones {myConnections.length > 0 && `(${myConnections.length}/5)`}
                    </p>
                    {!session && <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11 }}>Inicia sesión para guardar</span>}
                  </div>
                  {myConnections.length === 0 ? (
                    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: '20px', textAlign: 'center' }}>
                      <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 13, margin: 0 }}>
                        Conecta con alguien y guárdalos con 💾 durante la llamada
                      </p>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {myConnections.map(c => (
                        <div key={c.id} style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 14, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
                          {c.stranger_photo ? (
                            <img src={c.stranger_photo} alt="" style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} referrerPolicy="no-referrer" />
                          ) : (
                            <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(99,102,241,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>👤</div>
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: 'white', fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {c.stranger_name ?? 'Anónimo'}
                            </div>
                            {c.note && <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.note}</div>}
                            <div style={{ color: 'rgba(165,180,252,0.5)', fontSize: 11, marginTop: 2 }}>
                              {new Date(c.created_at).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
                            {c.stranger_email ? (
                              <button
                                onClick={() => { setInviteConnection(c); setShowInviteModal(true); }}
                                style={{ padding: '6px 10px', background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)', borderRadius: 10, color: '#a5b4fc', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                              >
                                Invitar
                              </button>
                            ) : (
                              <button
                                title="Este usuario no inició sesión con Google"
                                onClick={() => { setScheduleNote(`Sesión con ${c.stranger_name ?? 'mi conexión'}`); setShowScheduleModal(true); }}
                                style={{ padding: '6px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: 'rgba(255,255,255,0.3)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                              >
                                Agendar
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteConnection(c.id)}
                              style={{ padding: '6px 10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, color: 'rgba(239,68,68,0.7)', fontSize: 11, cursor: 'pointer' }}
                            >
                              Eliminar
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Scheduled sessions */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <p style={{ color: 'rgba(165,180,252,0.5)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>Sesiones agendadas</p>
                    {session && (
                      <button
                        onClick={() => setShowScheduleModal(true)}
                        style={{ background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.4)', borderRadius: 20, padding: '5px 12px', color: '#a5b4fc', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                      >
                        + Agendar
                      </button>
                    )}
                  </div>
                  {mySlots.length === 0 ? (
                    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: '20px', textAlign: 'center' }}>
                      <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 13, margin: 0 }}>No tienes sesiones agendadas</p>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {mySlots.map(slot => {
                        const date = new Date(slot.scheduled_at);
                        const now = new Date();
                        const diffMs = date.getTime() - now.getTime();
                        const diffH = Math.floor(diffMs / 3600000);
                        const diffM = Math.floor((diffMs % 3600000) / 60000);
                        const isNow = diffMs >= 0 && diffMs < 10 * 60000;
                        return (
                          <div key={slot.id} style={{ background: isNow ? 'rgba(74,222,128,0.08)' : 'rgba(255,255,255,0.04)', border: `1px solid ${isNow ? 'rgba(74,222,128,0.3)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 14, padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                            <div>
                              <div style={{ color: 'white', fontWeight: 600, fontSize: 14 }}>
                                {date.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })} · {date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                              </div>
                              {slot.note && <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 2 }}>{slot.note}</div>}
                              <div style={{ color: isNow ? '#4ade80' : 'rgba(165,180,252,0.5)', fontSize: 11, marginTop: 4, fontWeight: 600 }}>
                                {isNow ? '🟢 ¡Es ahora! Entra al chat' : diffMs > 0 ? `En ${diffH}h ${diffM}m` : 'Pasada'}
                              </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {isNow && (
                                <button onClick={() => { setActiveTab('chat'); handleNext(); }} style={{ padding: '7px 12px', background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', border: 'none', borderRadius: 10, color: 'white', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                                  Conectar
                                </button>
                              )}
                              <button onClick={() => handleCancelSlot(slot.id)} style={{ padding: '6px 10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, color: 'rgba(239,68,68,0.7)', fontSize: 11, cursor: 'pointer' }}>
                                Cancelar
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Gallery photos */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <p style={{ color: 'rgba(165,180,252,0.5)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
                      Mis fotos {galleryPhotos.length > 0 && `(${galleryPhotos.length}/9)`}
                    </p>
                    {galleryPhotos.length < 9 && (
                      <button
                        onClick={() => galleryInputRef.current?.click()}
                        style={{ background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.4)', borderRadius: 20, padding: '5px 12px', color: '#a5b4fc', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                      >
                        + Subir
                      </button>
                    )}
                  </div>
                  <input
                    ref={galleryInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = ev => {
                        const result = ev.target?.result as string;
                        setGalleryPhotos(prev => {
                          const next = [...prev, result].slice(0, 9);
                          localStorage.setItem('va_gallery', JSON.stringify(next));
                          return next;
                        });
                      };
                      reader.readAsDataURL(file);
                      e.target.value = '';
                    }}
                  />
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                    {galleryPhotos.map((photo, i) => (
                      <div key={i} style={{ position: 'relative', aspectRatio: '1', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        <button
                          onClick={() => setGalleryPhotos(prev => {
                            const next = prev.filter((_, idx) => idx !== i);
                            localStorage.setItem('va_gallery', JSON.stringify(next));
                            return next;
                          })}
                          style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: '50%', background: 'rgba(0,0,0,0.65)', border: 'none', color: 'white', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {galleryPhotos.length === 0 && (
                      <div
                        onClick={() => galleryInputRef.current?.click()}
                        style={{ aspectRatio: '1', borderRadius: 12, border: '1.5px dashed rgba(99,102,241,0.3)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', background: 'rgba(99,102,241,0.04)' }}
                      >
                        <span style={{ fontSize: 22 }}>📷</span>
                        <span style={{ color: 'rgba(165,180,252,0.5)', fontSize: 11 }}>Subir foto</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* My reviews */}
                {ratingsGiven.length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <p style={{ color: 'rgba(165,180,252,0.5)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 12px' }}>Mis reseñas ({ratingsGiven.length})</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {ratingsGiven.slice(0, 5).map((r, i) => (
                        <div key={i} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '12px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: r.comment ? 6 : 0 }}>
                            <span style={{ color: '#fbbf24', fontSize: 15, letterSpacing: 2 }}>{'★'.repeat(r.stars)}{'☆'.repeat(5 - r.stars)}</span>
                            <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11 }}>
                              {new Date(r.date).toLocaleDateString('es', { day: 'numeric', month: 'short' })}
                            </span>
                          </div>
                          {r.comment && <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13, margin: 0, lineHeight: 1.45 }}>{r.comment}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Auth button */}
                {session ? (
                  <button onClick={() => signOut()} style={{ width: '100%', padding: '13px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)', borderRadius: 14, cursor: 'pointer' }}>
                    <span style={{ color: 'rgba(239,68,68,0.8)', fontSize: 14, fontWeight: 600 }}>Cerrar sesión</span>
                  </button>
                ) : (
                  <button onClick={() => signIn('google')} style={{ width: '100%', padding: '13px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer' }}>
                    <svg width="16" height="16" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908C16.658 14.017 17.64 11.71 17.64 9.2z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/><path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/></svg>
                    <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: 600 }}>Vincular cuenta de Google</span>
                  </button>
                )}
              </div>
            )}

          </div>{/* end tab content */}

          {/* ── Bottom Navigation Bar ── */}
          <div style={{ flexShrink: 0, height: 62, background: 'rgba(7,7,26,0.95)', backdropFilter: 'blur(16px)', borderTop: '1px solid rgba(99,102,241,0.15)', display: 'flex', alignItems: 'center' }}>
            {([
              { id: 'home',    icon: <Home size={20} />,   label: 'Inicio'  },
              { id: 'chat',    icon: <Video size={20} />,  label: 'Chat'    },
              { id: 'search',  icon: <Search size={20} />, label: 'Buscar'  },
              { id: 'profile', icon: <User size={20} />,   label: 'Perfil'  },
            ] as const).map(tab => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    flex: 1, height: '100%', border: 'none', background: 'transparent',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                    cursor: 'pointer',
                    color: active ? '#a5b4fc' : 'rgba(255,255,255,0.3)',
                    transition: 'color 0.2s',
                  }}
                >
                  <div style={{ opacity: active ? 1 : 0.6, filter: active ? 'drop-shadow(0 0 6px rgba(165,180,252,0.6))' : 'none', transition: 'all 0.2s', position: 'relative' }}>
                    {tab.icon}
                    {tab.id === 'chat' && unreadCount > 0 && (
                      <div style={{ position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, background: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', animation: 'badge-pop 0.3s ease-out' }}>
                        <span style={{ color: 'white', fontSize: 9, fontWeight: 800 }}>{unreadCount > 9 ? '9+' : unreadCount}</span>
                      </div>
                    )}
                    {tab.id === 'profile' && pendingInvites.length > 0 && (
                      <div style={{ position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, background: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                        <span style={{ color: 'white', fontSize: 9, fontWeight: 800 }}>{pendingInvites.length > 9 ? '9+' : pendingInvites.length}</span>
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 10, fontWeight: active ? 700 : 400, letterSpacing: '0.04em' }}>{tab.label}</span>
                  {active && <div style={{ position: 'absolute', bottom: 0, width: 28, height: 2, background: 'linear-gradient(90deg,#4f46e5,#7c3aed)', borderRadius: 2 }} />}
                </button>
              );
            })}
          </div>

        </div>
      </div>

      {/* ════════════════ PROFILE DETAIL MODAL ════════════════ */}
      {selectedProfile && (
        <div
          onClick={() => setSelectedProfile(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 75, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(10px)' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'rgba(10,10,32,0.99)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '26px 26px 0 0', padding: '24px 22px 36px', width: '100%', maxWidth: 448, maxHeight: '85vh', overflowY: 'auto' }}
          >
            {/* Handle */}
            <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 2, margin: '0 auto 20px' }} />

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
              <div style={{ width: 68, height: 68, borderRadius: '50%', background: `linear-gradient(135deg, hsl(${selectedProfile.hue},70%,40%), hsl(${selectedProfile.hue + 40},70%,30%))`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, flexShrink: 0, border: '2px solid rgba(99,102,241,0.4)' }}>
                {selectedProfile.flag}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ color: 'white', fontWeight: 800, fontSize: 18 }}>{selectedProfile.age} años</span>
                  <span style={{ background: 'rgba(99,102,241,0.22)', border: '1px solid rgba(99,102,241,0.5)', color: '#a5b4fc', fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20 }}>{selectedProfile.tag}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#fbbf24', fontSize: 14 }}>{'★'.repeat(Math.round(selectedProfile.rating))}</span>
                  <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>{selectedProfile.rating} · {selectedProfile.reviews} reseñas</span>
                </div>
              </div>
            </div>

            {/* Bio */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '14px 16px', marginBottom: 20 }}>
              <p style={{ color: 'rgba(165,180,252,0.5)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 6px' }}>Bio</p>
              <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, lineHeight: 1.5, margin: 0 }}>{selectedProfile.bio}</p>
            </div>

            {/* Photos */}
            {MOCK_PHOTOS[selectedProfile.id] && (
              <div style={{ marginBottom: 20 }}>
                <p style={{ color: 'rgba(165,180,252,0.5)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 12px' }}>Fotos</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                  {MOCK_PHOTOS[selectedProfile.id].map((p, i) => (
                    <div key={i} style={{ aspectRatio: '1', borderRadius: 12, overflow: 'hidden', background: `linear-gradient(135deg, hsl(${p.hue},65%,22%), hsl(${p.hue + 30},65%,14%))`, border: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>
                      {p.emoji}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reviews */}
            <p style={{ color: 'rgba(165,180,252,0.5)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 12px' }}>Reseñas recientes</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22 }}>
              {selectedProfile.comments.map((comment, i) => (
                <div key={i} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', gap: 2, marginBottom: 6 }}>
                    {[1,2,3,4,5].map(s => (
                      <span key={s} style={{ color: s <= 5 - (i % 2) ? '#fbbf24' : 'rgba(255,255,255,0.2)', fontSize: 13 }}>★</span>
                    ))}
                  </div>
                  <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, margin: 0, lineHeight: 1.45 }}>{comment}</p>
                  <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, margin: '6px 0 0' }}>Hace {i + 1} día{i > 0 ? 's' : ''}</p>
                </div>
              ))}
            </div>

            {/* Connect button */}
            <button
              onClick={() => { setSelectedProfile(null); setActiveTab('chat'); handleNext(); }}
              style={{ width: '100%', padding: '15px', background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', border: 'none', borderRadius: 16, color: 'white', fontWeight: 800, fontSize: 15, cursor: 'pointer', boxShadow: '0 0 28px rgba(99,102,241,0.5)' }}
            >
              Conectar con {selectedProfile.flag}
            </button>
          </div>
        </div>
      )}

      {/* ════════════════ BLOCKED MESSAGE TOAST ════════════════ */}
      {blockedWarning && (
        <div style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', zIndex: 80, background: 'rgba(239,68,68,0.92)', backdropFilter: 'blur(10px)', borderRadius: 24, padding: '10px 20px', boxShadow: '0 4px 24px rgba(239,68,68,0.4)' }}>
          <span style={{ color: 'white', fontSize: 13, fontWeight: 600 }}>⚠️ Mensaje bloqueado por contenido inapropiado</span>
        </div>
      )}

      {/* ════════════════ RATING MODAL ════════════════ */}
      {showRatingModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)' }}>
          <div style={{ background: 'rgba(12,12,38,0.98)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 26, padding: '32px 28px', maxWidth: 300, width: '88%', textAlign: 'center', boxShadow: '0 0 60px rgba(99,102,241,0.2)' }}>
            <div style={{ fontSize: 44, marginBottom: 12 }}>⭐</div>
            <h2 style={{ color: 'white', fontSize: 19, fontWeight: 800, margin: '0 0 6px' }}>¿Cómo fue la conversación?</h2>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, margin: '0 0 24px' }}>Califica al extraño</p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 20 }}>
              {[1,2,3,4,5].map(star => (
                <button
                  key={star}
                  onClick={() => setRatingValue(star)}
                  style={{ fontSize: 38, background: 'none', border: 'none', cursor: 'pointer', color: star <= ratingValue ? '#fbbf24' : 'rgba(255,255,255,0.2)', transition: 'color 0.15s, transform 0.15s', transform: star <= ratingValue ? 'scale(1.2)' : 'scale(1)', padding: '4px' }}
                >
                  ★
                </button>
              ))}
            </div>
            <textarea
              value={ratingComment}
              onChange={e => setRatingComment(e.target.value)}
              placeholder="Deja un comentario opcional..."
              maxLength={200}
              rows={3}
              style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: 'white', fontSize: 13, padding: '10px 13px', resize: 'none', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: 16 }}
            />
            <button
              onClick={() => handleRatingSubmit(ratingValue)}
              disabled={ratingValue === 0}
              style={{ width: '100%', padding: '13px', background: ratingValue > 0 ? 'linear-gradient(135deg,#4f46e5,#7c3aed)' : 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 14, color: ratingValue > 0 ? 'white' : 'rgba(255,255,255,0.3)', fontWeight: 800, fontSize: 14, cursor: ratingValue > 0 ? 'pointer' : 'not-allowed', marginBottom: 10, boxShadow: ratingValue > 0 ? '0 0 22px rgba(99,102,241,0.4)' : 'none', transition: 'all 0.2s' }}
            >
              Enviar calificación
            </button>
            <button
              onClick={() => handleRatingSubmit(0)}
              style={{ width: '100%', padding: '11px', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: 13, cursor: 'pointer' }}
            >
              Omitir
            </button>
          </div>
        </div>
      )}

      {/* ════════════════ INVITE MODAL ════════════════ */}
      {showInviteModal && inviteConnection && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)' }}
          onClick={() => setShowInviteModal(false)}>
          <div style={{ background: 'rgba(12,12,38,0.98)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: '26px 26px 0 0', padding: '28px 24px 40px', width: '100%', maxWidth: 480, boxShadow: '0 -20px 80px rgba(99,102,241,0.15)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 2, margin: '0 auto 22px' }} />
            <h2 style={{ color: 'white', fontSize: 20, fontWeight: 800, margin: '0 0 6px', textAlign: 'center' }}>Invitar a sesión</h2>
            <p style={{ color: 'rgba(165,180,252,0.6)', fontSize: 13, textAlign: 'center', margin: '0 0 20px' }}>
              {inviteConnection.stranger_name ?? 'Tu conexión'} recibirá un email con la invitación
            </p>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 14, padding: '12px 14px', marginBottom: 20 }}>
              {inviteConnection.stranger_photo ? (
                <img src={inviteConnection.stranger_photo} alt="" referrerPolicy="no-referrer" style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
              ) : (
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(99,102,241,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>👤</div>
              )}
              <div>
                <div style={{ color: 'white', fontWeight: 700, fontSize: 14 }}>{inviteConnection.stranger_name ?? 'Anónimo'}</div>
                <div style={{ color: 'rgba(165,180,252,0.5)', fontSize: 12 }}>{inviteConnection.stranger_email}</div>
              </div>
            </div>

            <label style={{ color: 'rgba(165,180,252,0.7)', fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Fecha</label>
            <input type="date" value={inviteDate} onChange={e => setInviteDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              style={{ width: '100%', marginTop: 8, marginBottom: 16, padding: '13px 16px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, color: 'white', fontSize: 15, boxSizing: 'border-box', colorScheme: 'dark' }} />

            <label style={{ color: 'rgba(165,180,252,0.7)', fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Hora</label>
            <input type="time" value={inviteTime} onChange={e => setInviteTime(e.target.value)}
              style={{ width: '100%', marginTop: 8, marginBottom: 16, padding: '13px 16px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, color: 'white', fontSize: 15, boxSizing: 'border-box', colorScheme: 'dark' }} />

            <label style={{ color: 'rgba(165,180,252,0.7)', fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Mensaje (opcional)</label>
            <textarea value={inviteMessage} onChange={e => setInviteMessage(e.target.value)}
              placeholder="Ej: ¿Practicamos inglés juntos?" rows={2}
              style={{ width: '100%', marginTop: 8, marginBottom: 20, padding: '13px 16px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, color: 'white', fontSize: 14, boxSizing: 'border-box', resize: 'none', fontFamily: 'inherit' }} />

            <button onClick={handleSendInvite}
              disabled={inviteSaving || inviteSent || !inviteDate || !inviteTime}
              style={{ width: '100%', padding: '15px', borderRadius: 16, border: inviteSent ? '1px solid rgba(74,222,128,0.4)' : 'none', background: inviteSent ? 'rgba(74,222,128,0.12)' : (inviteSaving || !inviteDate || !inviteTime ? 'rgba(99,102,241,0.3)' : 'linear-gradient(135deg,#4f46e5,#7c3aed)'), color: inviteSent ? '#4ade80' : 'white', fontSize: 15, fontWeight: 800, cursor: inviteSaving || !inviteDate || !inviteTime ? 'not-allowed' : 'pointer', marginBottom: 10 }}>
              {inviteSent ? '✓ Invitación enviada' : inviteSaving ? 'Enviando...' : 'Enviar invitación ✉️'}
            </button>
            <button onClick={() => setShowInviteModal(false)}
              style={{ width: '100%', padding: '13px', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: 14, cursor: 'pointer' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ════════════════ ACCEPT INVITE MODAL ════════════════ */}
      {showAcceptModal && currentInvite && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(12px)' }}>
          <div style={{ background: 'rgba(12,12,38,0.99)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: '26px 26px 0 0', padding: '28px 24px 44px', width: '100%', maxWidth: 480, boxShadow: '0 -20px 80px rgba(124,58,237,0.2)' }}>
            <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 2, margin: '0 auto 22px' }} />

            {acceptDone ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: 52, marginBottom: 14 }}>{acceptDone === 'accepted' ? '🎉' : '👋'}</div>
                <h2 style={{ color: 'white', fontSize: 20, fontWeight: 800, margin: '0 0 8px' }}>
                  {acceptDone === 'accepted' ? '¡Sesión confirmada!' : 'Invitación rechazada'}
                </h2>
                <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, margin: 0 }}>
                  {acceptDone === 'accepted' ? 'La sesión aparece ahora en tu agenda.' : 'La invitación ha sido rechazada.'}
                </p>
              </div>
            ) : (
              <>
                <h2 style={{ color: 'white', fontSize: 20, fontWeight: 800, margin: '0 0 6px', textAlign: 'center' }}>Invitación a sesión</h2>
                <p style={{ color: 'rgba(165,180,252,0.6)', fontSize: 13, textAlign: 'center', margin: '0 0 20px' }}>
                  <strong style={{ color: '#a5b4fc' }}>{currentInvite.from_name ?? currentInvite.from_email}</strong> te invita a chatear
                </p>

                <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 14, padding: '16px', marginBottom: 24, textAlign: 'center' }}>
                  <div style={{ color: 'rgba(165,180,252,0.6)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>Fecha y hora</div>
                  <div style={{ color: 'white', fontWeight: 700, fontSize: 16 }}>
                    {new Date(currentInvite.scheduled_at).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </div>
                  <div style={{ color: '#a5b4fc', fontWeight: 600, fontSize: 15 }}>
                    {new Date(currentInvite.scheduled_at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  {currentInvite.message && (
                    <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 10, fontStyle: 'italic' }}>
                      "{currentInvite.message}"
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <button onClick={() => handleRespondInvite('decline')} disabled={acceptLoading}
                    style={{ flex: 1, padding: '14px', borderRadius: 14, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)', color: 'rgba(239,68,68,0.8)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                    Rechazar
                  </button>
                  <button onClick={() => handleRespondInvite('accept')} disabled={acceptLoading}
                    style={{ flex: 2, padding: '14px', borderRadius: 14, background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', border: 'none', color: 'white', fontSize: 14, fontWeight: 800, cursor: 'pointer', boxShadow: '0 0 20px rgba(99,102,241,0.35)' }}>
                    {acceptLoading ? 'Procesando...' : '✓ Aceptar invitación'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ════════════════ SAVE CONNECTION MODAL ════════════════ */}
      {showSaveModal && strangerProfile && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 60,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)',
        }} onClick={() => setShowSaveModal(false)}>
          <div style={{
            background: 'rgba(12,12,38,0.98)',
            border: '1px solid rgba(99,102,241,0.25)',
            borderRadius: '26px 26px 0 0', padding: '28px 24px 40px',
            width: '100%', maxWidth: 480,
            boxShadow: '0 -20px 80px rgba(99,102,241,0.15)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 2, margin: '0 auto 22px' }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
              {strangerProfile.photo ? (
                <img src={strangerProfile.photo} alt="" referrerPolicy="no-referrer" style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(99,102,241,0.4)' }} />
              ) : (
                <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(99,102,241,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>👤</div>
              )}
              <div>
                <div style={{ color: 'white', fontWeight: 800, fontSize: 17 }}>{strangerProfile.name}</div>
                <div style={{ color: 'rgba(165,180,252,0.5)', fontSize: 13 }}>Guardar como conexión</div>
              </div>
            </div>

            <label style={{ color: 'rgba(165,180,252,0.7)', fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Nota (opcional)</label>
            <textarea
              value={connectionNote}
              onChange={e => setConnectionNote(e.target.value)}
              placeholder="¿De qué hablaron? ¿Por qué guardarlos?..."
              rows={3}
              style={{
                width: '100%', marginTop: 8, marginBottom: 20, padding: '13px 16px',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 14, color: 'white', fontSize: 14, boxSizing: 'border-box',
                resize: 'none', fontFamily: 'inherit',
              }}
            />

            {!session && (
              <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 12, padding: '10px 14px', marginBottom: 16, color: 'rgba(251,191,36,0.8)', fontSize: 13 }}>
                ⚠️ Inicia sesión con Google para guardar conexiones permanentemente.
              </div>
            )}

            <button
              onClick={handleSaveConnection}
              disabled={connectionSaving}
              style={{
                width: '100%', padding: '15px', borderRadius: 16,
                background: connectionSaving ? 'rgba(99,102,241,0.3)' : 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                border: 'none', color: 'white', fontSize: 15, fontWeight: 800,
                cursor: connectionSaving ? 'not-allowed' : 'pointer',
                marginBottom: 10, boxShadow: '0 0 25px rgba(99,102,241,0.3)',
              }}
            >
              {connectionSaving ? 'Guardando...' : '💾 Guardar conexión'}
            </button>
            <button
              onClick={() => setShowSaveModal(false)}
              style={{ width: '100%', padding: '13px', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: 14, cursor: 'pointer' }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ════════════════ UPGRADE MODAL ════════════════ */}
      {showUpgradeModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 60,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(10px)',
        }}>
          <div style={{
            background: 'rgba(12,12,38,0.98)',
            border: '1px solid rgba(99,102,241,0.3)',
            borderRadius: 26, padding: '36px 28px',
            maxWidth: 300, width: '88%', textAlign: 'center',
            boxShadow: '0 0 80px rgba(99,102,241,0.2)',
          }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>🔒</div>
            <h2 style={{ color: 'white', fontSize: 21, fontWeight: 800, margin: '0 0 10px' }}>Límite alcanzado</h2>
            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, margin: '0 0 6px', lineHeight: 1.5 }}>
              El plan gratuito permite hasta <strong style={{ color: 'white' }}>5 conexiones</strong>.
            </p>
            <p style={{ color: 'rgba(165,180,252,0.6)', fontSize: 13, margin: '0 0 26px', lineHeight: 1.5 }}>
              Próximamente: Premium ilimitado.
            </p>
            <button
              onClick={() => setShowUpgradeModal(false)}
              style={{
                width: '100%', padding: '14px', borderRadius: 14,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.65)', fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Entendido
            </button>
          </div>
        </div>
      )}

      {/* ════════════════ PAYMENT MODAL ════════════════ */}
      {showPaymentModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(10px)' }}>
          <div style={{ background: 'rgba(10,10,32,0.99)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '26px 26px 0 0', padding: '24px 20px 40px', width: '100%', maxWidth: 448 }}>
            <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 2, margin: '0 auto 22px' }} />
            <h2 style={{ color: 'white', fontSize: 20, fontWeight: 800, margin: '0 0 4px', textAlign: 'center' }}>Recargar Puntos</h2>
            <p style={{ color: 'rgba(165,180,252,0.5)', fontSize: 13, textAlign: 'center', margin: '0 0 24px' }}>Elige el paquete que mejor te convenga</p>

            {[
              { pkg: 'starter', emoji: '🥉', label: '500 Puntos',   price: '$2.99', bonus: null,              popular: false },
              { pkg: 'popular', emoji: '🥈', label: '1,500 Puntos', price: '$7.99', bonus: '+200 de regalo',  popular: true  },
              { pkg: 'pro',     emoji: '🥇', label: '5,000 Puntos', price: '$19.99', bonus: '+1,000 de regalo', popular: false },
            ].map(item => (
              <button
                key={item.pkg}
                onClick={() => handleBuyPoints(item.pkg)}
                disabled={paymentLoading !== null}
                style={{
                  width: '100%', marginBottom: 10, padding: '16px 18px',
                  background: item.popular ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.04)',
                  border: item.popular ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 16, cursor: paymentLoading ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  opacity: paymentLoading && paymentLoading !== item.pkg ? 0.5 : 1,
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 26 }}>{item.emoji}</span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ color: 'white', fontWeight: 700, fontSize: 15 }}>{item.label}</div>
                    {item.bonus && <div style={{ color: '#4ade80', fontSize: 12, fontWeight: 600 }}>{item.bonus}</div>}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {item.popular && <div style={{ color: '#a5b4fc', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>Popular</div>}
                  <div style={{ color: paymentLoading === item.pkg ? '#a5b4fc' : 'white', fontWeight: 800, fontSize: 16 }}>
                    {paymentLoading === item.pkg ? '...' : item.price}
                  </div>
                </div>
              </button>
            ))}

            <button
              onClick={() => setShowPaymentModal(false)}
              style={{ width: '100%', padding: '13px', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: 14, cursor: 'pointer', marginTop: 4 }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ════════════════ SCHEDULE MODAL ════════════════ */}
      {showScheduleModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 60,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)',
        }} onClick={() => setShowScheduleModal(false)}>
          <div style={{
            background: 'rgba(12,12,38,0.98)',
            border: '1px solid rgba(99,102,241,0.25)',
            borderRadius: '26px 26px 0 0', padding: '28px 24px 40px',
            width: '100%', maxWidth: 480,
            boxShadow: '0 -20px 80px rgba(99,102,241,0.15)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 2, margin: '0 auto 22px' }} />
            <h2 style={{ color: 'white', fontSize: 20, fontWeight: 800, margin: '0 0 20px', textAlign: 'center' }}>Agendar Sesión</h2>

            <label style={{ color: 'rgba(165,180,252,0.7)', fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Fecha</label>
            <input
              type="date"
              value={scheduleDate}
              onChange={e => setScheduleDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              style={{
                width: '100%', marginTop: 8, marginBottom: 16, padding: '13px 16px',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 14, color: 'white', fontSize: 15, boxSizing: 'border-box',
                colorScheme: 'dark',
              }}
            />

            <label style={{ color: 'rgba(165,180,252,0.7)', fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Hora</label>
            <input
              type="time"
              value={scheduleTime}
              onChange={e => setScheduleTime(e.target.value)}
              style={{
                width: '100%', marginTop: 8, marginBottom: 16, padding: '13px 16px',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 14, color: 'white', fontSize: 15, boxSizing: 'border-box',
                colorScheme: 'dark',
              }}
            />

            <label style={{ color: 'rgba(165,180,252,0.7)', fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Nota (opcional)</label>
            <textarea
              value={scheduleNote}
              onChange={e => setScheduleNote(e.target.value)}
              placeholder="Ej: Quiero practicar inglés..."
              rows={3}
              style={{
                width: '100%', marginTop: 8, marginBottom: 20, padding: '13px 16px',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 14, color: 'white', fontSize: 14, boxSizing: 'border-box',
                resize: 'none', fontFamily: 'inherit',
              }}
            />

            <button
              onClick={handleCreateSlot}
              disabled={scheduleSaving || !scheduleDate || !scheduleTime}
              style={{
                width: '100%', padding: '15px', borderRadius: 16,
                background: scheduleSaving || !scheduleDate || !scheduleTime
                  ? 'rgba(99,102,241,0.3)' : 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                border: 'none', color: 'white', fontSize: 15, fontWeight: 800,
                cursor: scheduleSaving || !scheduleDate || !scheduleTime ? 'not-allowed' : 'pointer',
                marginBottom: 10, boxShadow: '0 0 25px rgba(99,102,241,0.3)',
              }}
            >
              {scheduleSaving ? 'Guardando...' : 'Confirmar Sesión ✓'}
            </button>
            <button
              onClick={() => setShowScheduleModal(false)}
              style={{
                width: '100%', padding: '13px', background: 'transparent',
                border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: 14, cursor: 'pointer',
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ════════════════ NO-POINTS MODAL ════════════════ */}
      {showNoPointsModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 60,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(10px)',
        }}>
          <div style={{
            background: 'rgba(12,12,38,0.98)',
            border: '1px solid rgba(99,102,241,0.3)',
            borderRadius: 26, padding: '36px 28px',
            maxWidth: 300, width: '88%', textAlign: 'center',
            boxShadow: '0 0 80px rgba(99,102,241,0.2)',
          }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>🪙</div>
            <h2 style={{ color: 'white', fontSize: 21, fontWeight: 800, margin: '0 0 10px' }}>
              ¡Sin puntos!
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, margin: '0 0 26px', lineHeight: 1.5 }}>
              Ups, te quedaste sin puntos. Recarga para seguir conectando.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                onClick={() => { setShowNoPointsModal(false); setShowPaymentModal(true); }}
                style={{
                  padding: '14px', borderRadius: 14,
                  background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                  border: 'none', color: 'white', fontSize: 14, fontWeight: 800,
                  cursor: 'pointer', boxShadow: '0 0 25px rgba(99,102,241,0.45)',
                }}>
                Recargar Puntos
              </button>
              <button
                onClick={doStop}
                style={{
                  padding: '14px', borderRadius: 14,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'rgba(255,255,255,0.65)', fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                Volver al inicio
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
