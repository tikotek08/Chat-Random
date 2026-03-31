'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { Send, Square, Diamond, Home, Video, Search, User, SwitchCamera } from 'lucide-react';

interface Message {
  id: string;
  sender: 'stranger' | 'user';
  text: string;
}

type SignalMessage =
  | { type: 'find-match' }
  | { type: 'waiting' }
  | { type: 'matched'; roomId: string; polite: boolean }
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

const MOCK_PROFILES = [
  { id: 1,  flag: '🇲🇽', age: 24, tag: 'Música',      hue: 0   },
  { id: 2,  flag: '🇦🇷', age: 21, tag: 'Viajes',      hue: 40  },
  { id: 3,  flag: '🇪🇸', age: 27, tag: 'Arte',        hue: 80  },
  { id: 4,  flag: '🇺🇸', age: 22, tag: 'Gaming',      hue: 130 },
  { id: 5,  flag: '🇧🇷', age: 25, tag: 'Cine',        hue: 180 },
  { id: 6,  flag: '🇨🇴', age: 19, tag: 'Deportes',    hue: 220 },
  { id: 7,  flag: '🇫🇷', age: 30, tag: 'Tecnología',  hue: 270 },
  { id: 8,  flag: '🇯🇵', age: 23, tag: 'Anime',       hue: 310 },
];

export default function VideoChatApp() {
  const { data: session } = useSession();

  // ── App state ─────────────────────────────────────────────
  const [appView, setAppView] = useState<'home' | 'chat'>('home');
  const [chatSessionId, setChatSessionId] = useState(0);
  const [points, setPoints] = useState(540);
  const [showNoPointsModal, setShowNoPointsModal] = useState(false);
  const [showPremiumMenu, setShowPremiumMenu] = useState(false);
  const [prefGender, setPrefGender] = useState('Todos');
  const [prefRegion, setPrefRegion] = useState('Global');
  const [prefAge, setPrefAge] = useState('Todos');
  const [enteringChat, setEnteringChat] = useState(false);
  const [activeTab, setActiveTab] = useState<'home' | 'chat' | 'search' | 'profile'>('chat');
  const [profilePhoto, setProfilePhoto] = useState<string>('');
  const [profileIdx, setProfileIdx] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const activeTabRef = useRef(activeTab);

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

      // Audio: MediaRecorder → Web Audio API (works on iOS + Android)
      const stream = localStreamRef.current;
      if (!stream || !stream.getAudioTracks().length) return;
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm']
        .find(t => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } });
      if (!mimeType) return;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const audioCtx = audioCtxRef.current;
      audioCtx.resume().catch(() => {});
      audioNextTimeRef.current = audioCtx.currentTime;
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
        } catch {
          // Fallback for mp4 audio (iOS sender → Chrome/Android receiver)
          try {
            const blob = new Blob([payload]);
            const url = URL.createObjectURL(blob);
            const a = new Audio(url);
            a.play().catch(() => {});
            a.onended = () => URL.revokeObjectURL(url);
          } catch {}
        }
      };
      const audioStream = new MediaStream(stream.getAudioTracks());
      const recorder = new MediaRecorder(audioStream, { mimeType });
      audioRecorderRef.current = recorder;
      let initSeg: Uint8Array | null = null;
      recorder.ondataavailable = async (e) => {
        if (e.data.size === 0) return;
        const chunk = new Uint8Array(await e.data.arrayBuffer());
        if (!initSeg) { initSeg = chunk; return; }
        const combined = new Uint8Array(initSeg.byteLength + chunk.byteLength);
        combined.set(initSeg, 0); combined.set(chunk, initSeg.byteLength);
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;
        const msg = new Uint8Array(1 + combined.byteLength);
        msg[0] = 1;
        msg.set(combined, 1);
        wsRef.current.send(msg.buffer);
      };
      // mp4 needs larger chunks (500ms) to be decodable cross-browser; webm works at 40ms
      const timeslice = mimeType.includes('mp4') ? 500 : 40;
      recorder.start(timeslice);
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
      pc.ontrack = (event) => {
        if (!remoteVideoRef.current) return;
        if (!(remoteVideoRef.current.srcObject instanceof MediaStream)) {
          remoteVideoRef.current.srcObject = new MediaStream();
        }
        (remoteVideoRef.current.srcObject as MediaStream).addTrack(event.track);
        // Reassign srcObject so iOS Safari detects the new track
        remoteVideoRef.current.srcObject = remoteVideoRef.current.srcObject;
        remoteVideoRef.current.play().catch(() => {});
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
      const iceTimer = window.setTimeout(switchToRelay, 5000);
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
        setRoomId(msg.roomId); setStatus('Conectando video...'); setMessages([]); await setupPc(msg.polite); return;
      }
      if (msg.type === 'peer-left') {
        cleanupPc(); stopRelayCapture(); setRelayMode(false); setSearching(true); setRoomId(''); setMessages([]);
        setStatus('El extraño se fue, buscando otro...');
        if (!stopped && wsRef.current?.readyState === WebSocket.OPEN) {
          setTimeout(() => {
            if (!stopped && wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'find-match' }));
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
        ws.onopen = () => { setStatus('Buscando a alguien...'); ws.send(JSON.stringify({ type: 'find-match' })); };
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

  const handleStop = () => {
    if (pointsIntervalRef.current) { clearInterval(pointsIntervalRef.current); pointsIntervalRef.current = null; }
    setShowNoPointsModal(false);
    setRelayMode(false);
    setDcReady(false);
    setSearching(true);
    setMessages([]);
    setRoomId('');
    setStatus('Conectando al servidor...');
    setChatSessionId(0); // triggers effect cleanup (closes WS, stops stream, closes PC)
    setAppView('home');
  };

  const handleNext = () => {
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
      wsRef.current.send(JSON.stringify({ type: 'find-match' }));
    }
  };

  const handleSendMessage = () => {
    const text = inputValue.trim();
    if (!text) return;
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
                        <div style={{ position: 'absolute', bottom: 18, left: 18, right: 18, display: 'flex', gap: 10 }}>
                          <button
                            onClick={() => setProfileIdx(i => (i + 1) % MOCK_PROFILES.length)}
                            style={{ flex: 1, padding: '15px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 18, color: 'white', fontWeight: 700, fontSize: 15, cursor: 'pointer', backdropFilter: 'blur(10px)' }}
                          >
                            Siguiente →
                          </button>
                          <button
                            onClick={() => { setActiveTab('chat'); handleNext(); }}
                            style={{ flex: 1, padding: '15px', background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', border: 'none', borderRadius: 18, color: 'white', fontWeight: 800, fontSize: 15, cursor: 'pointer', boxShadow: '0 0 28px rgba(99,102,241,0.55)' }}
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
              <div style={{ height: '100%', overflowY: 'auto', padding: '32px 24px' }}>
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>Tu cuenta</p>
                <h2 style={{ color: 'white', fontSize: 20, fontWeight: 700, margin: '0 0 28px' }}>Perfil</h2>
                {/* Avatar */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 28 }}>
                  {session?.user?.image ? (
                    <img src={session.user.image} alt="" style={{ width: 80, height: 80, borderRadius: '50%', border: '3px solid rgba(99,102,241,0.6)', marginBottom: 12, objectFit: 'cover', boxShadow: '0 0 24px rgba(99,102,241,0.4)' }} />
                  ) : (
                    <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'rgba(99,102,241,0.2)', border: '2px solid rgba(99,102,241,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                      <User size={36} color="rgba(165,180,252,0.7)" />
                    </div>
                  )}
                  <p style={{ color: 'white', fontWeight: 700, fontSize: 18, margin: '0 0 4px' }}>{session?.user?.name ?? 'Anónimo'}</p>
                  <p style={{ color: 'rgba(165,180,252,0.5)', fontSize: 13, margin: 0 }}>{session?.user?.email ?? 'Sin cuenta vinculada'}</p>
                </div>
                {/* Stats card */}
                <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, padding: '4px 0', marginBottom: 20 }}>
                  {[
                    { label: 'Puntos disponibles', value: `${points} 🪙` },
                    { label: 'Sesiones hoy', value: '1' },
                    { label: 'Plan', value: 'Gratuito' },
                  ].map((item, i, arr) => (
                    <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                      <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14 }}>{item.label}</span>
                      <span style={{ color: '#a5b4fc', fontWeight: 600, fontSize: 14 }}>{item.value}</span>
                    </div>
                  ))}
                </div>
                {/* Auth button */}
                {session ? (
                  <button
                    onClick={() => signOut()}
                    style={{ width: '100%', padding: '14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer' }}
                  >
                    <span style={{ color: 'rgba(239,68,68,0.8)', fontSize: 14, fontWeight: 600 }}>Cerrar sesión</span>
                  </button>
                ) : (
                  <button
                    onClick={() => signIn('google')}
                    style={{ width: '100%', padding: '14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer' }}
                  >
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
                  </div>
                  <span style={{ fontSize: 10, fontWeight: active ? 700 : 400, letterSpacing: '0.04em' }}>{tab.label}</span>
                  {active && <div style={{ position: 'absolute', bottom: 0, width: 28, height: 2, background: 'linear-gradient(90deg,#4f46e5,#7c3aed)', borderRadius: 2 }} />}
                </button>
              );
            })}
          </div>

        </div>
      </div>

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
              <button style={{
                padding: '14px', borderRadius: 14,
                background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                border: 'none', color: 'white', fontSize: 14, fontWeight: 800,
                cursor: 'pointer', boxShadow: '0 0 25px rgba(99,102,241,0.45)',
              }}>
                Recargar Puntos
              </button>
              <button
                onClick={handleStop}
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
