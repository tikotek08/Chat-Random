'use client';

import { useEffect, useRef, useState } from 'react';
import { Send, Square } from 'lucide-react';

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

export default function VideoChatApp() {
  const [roomId, setRoomId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [searching, setSearching] = useState(true);
  const [status, setStatus] = useState('Conectando al servidor...');
  const [dcReady, setDcReady] = useState(false);
  const [relayMode, setRelayMode] = useState(false);
  const log = (..._: unknown[]) => {}; // disabled

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Keep --app-h / --app-top in sync with the visual viewport (mobile keyboard)
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

  const handleSendMessage = () => {
    const text = inputValue.trim();
    if (!text) return;
    setMessages((prev) => [...prev, { id: Date.now().toString(), sender: 'user', text }]);
    // Try DataChannel first (lower latency), fall back to WebSocket relay
    const dc = dataChannelRef.current;
    if (dc?.readyState === 'open') {
      try { dc.send(text); } catch {}
    } else if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'relay-chat', text }));
    }
    setInputValue('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  useEffect(() => {
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
          if (data?.iceServers) {
            rtcConfigRef.current = { iceServers: data.iceServers };
            log(`ICE config: ${data.iceServers.length} servidor(es)`);
          }
        }
      } catch { /* use default */ }
    };

    const ensureLocalMedia = async () => {
      if (localStreamRef.current) return localStreamRef.current;
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
        setMessages((prev) => [
          ...prev,
          { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, sender: 'stranger', text },
        ]);
      };
      dc.onclose = () => {
        if (dataChannelRef.current === dc) dataChannelRef.current = null;
        setDcReady(false);
      };
    };

    const stopRelayCapture = () => {
      if (relayIntervalRef.current !== null) {
        clearInterval(relayIntervalRef.current);
        relayIntervalRef.current = null;
      }
      if (audioRecorderRef.current) {
        try { audioRecorderRef.current.stop(); } catch {}
        audioRecorderRef.current = null;
      }
      audioHandlerRef.current = null;
    };

    const startRelayCapture = () => {
      stopRelayCapture();

      // ── Video: canvas → JPEG → WebSocket (type byte 0) ──
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
            msg[0] = 0; // video
            msg.set(new Uint8Array(buf), 1);
            wsRef.current?.send(msg.buffer);
          });
        }, 'image/jpeg', 0.65);
      }, 100); // 10 fps

      // ── Audio: MediaRecorder → Web Audio API (works on iOS + Android) ──
      const stream = localStreamRef.current;
      if (!stream || !stream.getAudioTracks().length) return;

      // Pick best supported codec: opus/webm (Chrome/Android) → mp4 (iOS Safari)
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm']
        .find(t => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } });
      if (!mimeType) return;

      // Ensure AudioContext exists and is running (iOS needs user-gesture unlock)
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const audioCtx = audioCtxRef.current;
      audioCtx.resume().catch(() => {});
      audioNextTimeRef.current = audioCtx.currentTime;

      // Playback handler: decode each self-contained chunk via Web Audio API
      audioHandlerRef.current = async (payload: ArrayBuffer) => {
        try {
          await audioCtx.resume();
          const audioBuf = await audioCtx.decodeAudioData(payload.slice(0));
          const src = audioCtx.createBufferSource();
          src.buffer = audioBuf;
          src.connect(audioCtx.destination);
          const now = audioCtx.currentTime;
          if (audioNextTimeRef.current < now + 0.05) audioNextTimeRef.current = now + 0.05;
          src.start(audioNextTimeRef.current);
          audioNextTimeRef.current += audioBuf.duration;
        } catch { /* decode error — skip chunk */ }
      };

      // Capture: prepend init segment to every chunk so each is independently decodable
      const audioStream = new MediaStream(stream.getAudioTracks());
      const recorder = new MediaRecorder(audioStream, { mimeType });
      audioRecorderRef.current = recorder;
      let initSeg: Uint8Array | null = null;
      recorder.ondataavailable = async (e) => {
        if (e.data.size === 0) return;
        const chunk = new Uint8Array(await e.data.arrayBuffer());
        if (!initSeg) { initSeg = chunk; return; } // first chunk = codec headers only
        // Combine init + data → self-contained decodable packet
        const combined = new Uint8Array(initSeg.byteLength + chunk.byteLength);
        combined.set(initSeg, 0);
        combined.set(chunk, initSeg.byteLength);
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;
        const msg = new Uint8Array(1 + combined.byteLength);
        msg[0] = 1; // audio type
        msg.set(combined, 1);
        wsRef.current.send(msg.buffer);
      };
      recorder.start(500); // 500 ms — larger chunks decode more reliably
    };

    const activateRelay = () => {
      log('Relay WS activado');
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
        remoteVideoRef.current.play().catch(() => {});
      };

      pc.ondatachannel = (event) => attachDataChannel(event.channel);
      if (!polite) {
        try { attachDataChannel(pc.createDataChannel('chat')); } catch {}
      }

      pc.onicecandidate = (event) => {
        if (!event.candidate) { log('ICE gathering completo'); return; }
        const c = event.candidate;
        log(`ICE out: ${c.type} ${c.protocol}`);
        try {
          wsRef.current?.send(JSON.stringify({ type: 'ice-candidate', candidate: c.toJSON() }));
        } catch {}
      };

      pc.oniceconnectionstatechange = () => log(`ICE: ${pc.iceConnectionState}`);

      // Disable onnegotiationneeded — we make the offer explicitly below
      pc.onnegotiationneeded = () => {};

      const switchToRelay = () => {
        if (pcRef.current !== pc) return;
        cleanupPc();
        if (!stopped && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'use-relay' }));
        }
        activateRelay();
      };

      // If WebRTC doesn't connect within 5 s, fall back to WS relay
      const iceTimer = window.setTimeout(switchToRelay, 5000);

      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === 'connected') {
          clearTimeout(iceTimer);
          setSearching(false);
          setStatus('Conectado');
        }
        if (st === 'connecting') setStatus('Conectando video...');
        if (st === 'disconnected') setStatus('Conexión interrumpida, esperando...');
        if (st === 'failed') {
          clearTimeout(iceTimer);
          switchToRelay();
        }
      };

      // Only the impolite peer (polite=false) creates the offer — no collision possible
      if (!polite) {
        try {
          log('Creando offer...');
          const offer = await pc.createOffer();
          if (pcRef.current !== pc) return; // PC was replaced while awaiting, abort
          await pc.setLocalDescription(offer);
          wsRef.current?.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription! }));
          log('Offer enviado');
        } catch (e) { log(`Error offer: ${e}`); }
      }
    };

    const handleSignal = async (msg: SignalMessage) => {
      if (msg.type === 'waiting') {
        log('Servidor: waiting');
        setSearching(true);
        setStatus('Buscando a alguien...');
        setRoomId('');
        setMessages([]);
        cleanupPc();
        return;
      }

      if (msg.type === 'matched') {
        log(`Matched sala=${msg.roomId} polite=${msg.polite}`);
        setRoomId(msg.roomId);
        setStatus('Conectando video...');
        setMessages([]);
        await setupPc(msg.polite);
        return;
      }

      if (msg.type === 'peer-left') {
        cleanupPc();
        stopRelayCapture();
        setRelayMode(false);
        setSearching(true);
        setRoomId('');
        setMessages([]);
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

      if (msg.type === 'use-relay') {
        log('Peer solicitó relay WS');
        activateRelay();
        return;
      }

      if (msg.type === 'relay-chat') {
        const text = String(msg.text ?? '').trim();
        if (!text) return;
        setMessages(prev => [...prev, { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, sender: 'stranger', text }]);
        return;
      }

      const pc = pcRef.current;
      if (!pc) return;

      if (msg.type === 'offer') {
        log(`Offer recibido (${iceCandidateQueueRef.current.length} cands en cola)`);
        await pc.setRemoteDescription(msg.sdp);
        for (const c of iceCandidateQueueRef.current) {
          try { await pc.addIceCandidate(c); } catch {}
        }
        iceCandidateQueueRef.current = [];
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        wsRef.current?.send(JSON.stringify({ type: 'answer', sdp: pc.localDescription! }));
        log('Answer enviado');
        return;
      }

      if (msg.type === 'answer') {
        log(`Answer recibido (${iceCandidateQueueRef.current.length} cands en cola)`);
        await pc.setRemoteDescription(msg.sdp);
        for (const c of iceCandidateQueueRef.current) {
          try { await pc.addIceCandidate(c); } catch {}
        }
        iceCandidateQueueRef.current = [];
        return;
      }

      if (msg.type === 'ice-candidate') {
        const typ = (msg.candidate as RTCIceCandidateInit).candidate?.split(' ')[7] ?? '?';
        if (!pc.remoteDescription) {
          log(`ICE in (buffered): ${typ}`);
          iceCandidateQueueRef.current.push(msg.candidate);
        } else {
          log(`ICE in: ${typ}`);
          try { await pc.addIceCandidate(msg.candidate); } catch {}
        }
      }
    };

    const scheduleReconnect = (attempt: number) => {
      if (stopped) return;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      const delay = Math.min(10_000, 500 * Math.pow(2, Math.min(6, attempt)));
      reconnectTimerRef.current = window.setTimeout(() => {
        connect(attempt + 1).catch(console.error);
      }, delay);
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
          log('WS abierto → find-match');
          setStatus('Buscando a alguien...');
          ws.send(JSON.stringify({ type: 'find-match' }));
        };
        ws.onerror = () => { log('WS error'); setStatus('Error: no se pudo conectar al servidor de señalización'); };
        ws.onmessage = async (event) => {
          try {
            // Binary relay: first byte = type (0 = video, 1 = audio)
            if (event.data instanceof ArrayBuffer) {
              const view = new Uint8Array(event.data);
              const type = view[0];
              const payload = event.data.slice(1);
              if (type === 0) {
                // JPEG video frame
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
        ws.onclose = () => {
          if (!stopped) { setStatus('Reconectando...'); scheduleReconnect(attempt); }
        };
      } catch (e) {
        console.error(e);
        scheduleReconnect(attempt);
      }
    };

    // Unlock AudioContext on first gesture so iOS allows audio playback
    const unlockAudio = () => {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      audioCtxRef.current.resume().catch(() => {});
    };
    document.addEventListener('touchstart', unlockAudio, { once: true });
    document.addEventListener('click', unlockAudio, { once: true });

    connect().catch(console.error);

    return () => {
      stopped = true;
      document.removeEventListener('touchstart', unlockAudio);
      document.removeEventListener('click', unlockAudio);
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      stopRelayCapture();
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
  }, []);

  const handleNext = () => {
    politeRef.current = false;
    if (pcRef.current) { try { pcRef.current.close(); } catch {} pcRef.current = null; }
    if (dataChannelRef.current) { try { dataChannelRef.current.close(); } catch {} dataChannelRef.current = null; }
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (relayIntervalRef.current !== null) { clearInterval(relayIntervalRef.current); relayIntervalRef.current = null; }
    if (lastFrameUrlRef.current) { URL.revokeObjectURL(lastFrameUrlRef.current); lastFrameUrlRef.current = null; }
    if (remoteImgRef.current) remoteImgRef.current.src = '';
    if (audioRecorderRef.current) { try { audioRecorderRef.current.stop(); } catch {} audioRecorderRef.current = null; }
    audioHandlerRef.current = null;
    setRelayMode(false);
    setSearching(true);
    setMessages([]);
    setRoomId('');
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'find-match' }));
    }
  };

  const messagesList = messages.map((msg) => (
    <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
      {msg.sender === 'stranger' ? (
        <div className="max-w-xs">
          <div className="text-xs font-bold text-gray-300 mb-1 ml-2">EXTRAÑO</div>
          <div className="bg-white text-gray-900 px-4 py-3 rounded-3xl shadow-lg">{msg.text}</div>
        </div>
      ) : (
        <div className="max-w-xs">
          <div className="text-xs font-bold text-blue-300 mb-1 mr-2 text-right">TÚ</div>
          <div className="bg-blue-500 text-white px-4 py-3 rounded-3xl shadow-lg">{msg.text}</div>
        </div>
      )}
    </div>
  ));

  const chatInput = (
    <div className="px-4 pt-2 pb-1 flex gap-2 items-end">
      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyPress={handleKeyPress}
        placeholder={searching ? 'Esperando conexión...' : 'Escribe un mensaje...'}
        disabled={searching}
className="flex-1 bg-white text-gray-900 rounded-full px-4 py-3 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-lg disabled:opacity-50"
      />
      <button
        onClick={handleSendMessage}
        className="bg-blue-500 hover:bg-blue-600 text-white rounded-full p-3 flex items-center justify-center shadow-lg transition-colors"
      >
        <Send size={20} />
      </button>
    </div>
  );

  const actionButtons = (
    <div className="px-4 pb-3 flex gap-3">
      <button onClick={handleNext} className="bg-red-500 hover:bg-red-600 rounded-2xl p-3 flex items-center justify-center shadow-lg transition-colors">
        <Square size={24} className="text-white fill-white" />
      </button>
      <button onClick={handleNext} className="flex-1 bg-blue-500 hover:bg-blue-600 text-white rounded-2xl py-3 font-bold text-center shadow-lg transition-colors">
        Siguiente
      </button>
    </div>
  );

  return (
    <div className="fixed left-0 right-0 flex justify-center bg-gray-900 overflow-hidden" style={{ top: 'var(--app-top, 0px)', height: 'var(--app-h, 100dvh)' }}>
      <div className="w-full max-w-md bg-gray-900 flex flex-col overflow-hidden h-full">
        {/* Top Status Bar */}
        <div className="bg-black/40 backdrop-blur-md px-6 py-3 flex justify-between items-center relative z-40 shrink-0">
          <div className="bg-gray-600 text-white px-4 py-2 rounded-full text-sm font-medium">
            {searching ? 'Buscando...' : 'Extraño'}
          </div>
          <div className="bg-gray-700 text-white px-4 py-2 rounded-full flex items-center gap-3 text-xs font-medium">
            <span>🔗 {roomId || '...'}</span>
            <div className="w-px h-4 bg-gray-500"></div>
            <span>💎 12</span>
          </div>
        </div>

        {/* Status bar */}
        <div className="bg-gray-800 px-6 py-1 text-center text-xs text-gray-400 shrink-0">{status}</div>

        {/* Remote Video — 50% */}
        <div className="flex-1 relative overflow-hidden bg-black">
          <video ref={remoteVideoRef} autoPlay playsInline className={`w-full h-full object-cover scale-x-[-1] ${relayMode ? 'hidden' : ''}`} />
          <img ref={remoteImgRef} alt="" className={`w-full h-full object-cover scale-x-[-1] ${relayMode ? '' : 'hidden'}`} />
          {searching && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70">
              <div className="text-white text-center space-y-2">
                <div className="text-4xl">🔍</div>
                <div className="text-sm font-medium">Buscando a alguien...</div>
              </div>
            </div>
          )}
          <div className="absolute top-2 left-3">
            <span className="bg-black/50 text-white text-xs px-2 py-0.5 rounded-full">Extraño</span>
          </div>
        </div>

        {/* Local Video — 50%, input overlaid at bottom with 40% opacity */}
        <div className="flex-1 relative overflow-hidden bg-black">
          <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
          <div className="absolute top-2 left-3">
            <span className="bg-black/50 text-white text-xs px-2 py-0.5 rounded-full">Tú</span>
          </div>
          {/* Chat messages */}
          <div className="absolute bottom-24 left-0 right-0 max-h-28 overflow-y-auto px-4 space-y-2 pointer-events-none">
            {messagesList}
            <div ref={messagesEndRef} />
          </div>
          {/* Input + buttons at bottom, 40% opacity so camera shows through */}
          <div className="absolute bottom-0 left-0 right-0 bg-gray-900/40 backdrop-blur-sm">
            {chatInput}
            {actionButtons}
          </div>
        </div>
      </div>
    </div>
  );
}
