'use client';

import { useEffect, useRef, useState } from 'react';
import { Send, Square } from 'lucide-react';

interface Message {
  id: string;
  sender: 'stranger' | 'user';
  text: string;
}

type SignalMessage =
  | { type: 'join'; roomId: string }
  | { type: 'joined'; roomId: string; peers: number }
  | { type: 'peer-joined' }
  | { type: 'peer-left' }
  | { type: 'offer'; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'ice-candidate'; candidate: RTCIceCandidateInit }
  | { type: 'leave' };

function randomRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

const rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
};

export default function VideoChatApp() {
  const [roomId, setRoomId] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      sender: 'stranger',
      text: 'Hola! De dónde eres?',
    },
    {
      id: '2',
      sender: 'user',
      text: 'Hola, soy de Madrid. ¿Y tú?',
    },
  ]);

  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const pendingChatRef = useRef<string[]>([]);
  const reconnectTimerRef = useRef<number | null>(null);
  const connectingRef = useRef(false);

  const makingOfferRef = useRef(false);
  const ignoreOfferRef = useRef(false);
  const politeRef = useRef(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = () => {
    if (inputValue.trim()) {
      const newMessage: Message = {
        id: Date.now().toString(),
        sender: 'user',
        text: inputValue,
      };
      setMessages([...messages, newMessage]);

      const dc = dataChannelRef.current;
      if (dc && dc.readyState === 'open') {
        try {
          dc.send(inputValue);
        } catch {}
      } else {
        pendingChatRef.current.push(inputValue);
      }

      setInputValue('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  useEffect(() => {
    let stopped = false;

    const cleanupWs = () => {
      try {
        wsRef.current?.send(JSON.stringify({ type: 'leave' } satisfies SignalMessage));
      } catch {}

      try {
        wsRef.current?.close();
      } catch {}
      wsRef.current = null;
    };

    const cleanupPeerConnection = () => {
      makingOfferRef.current = false;
      ignoreOfferRef.current = false;

      politeRef.current = false;

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
    };

    const cleanup = () => {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      cleanupWs();
      cleanupPeerConnection();

      const stream = localStreamRef.current;
      if (stream) {
        for (const t of stream.getTracks()) t.stop();
      }
      localStreamRef.current = null;

      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    };

    const ensureRoomInUrl = () => {
      const url = new URL(window.location.href);
      let room = url.searchParams.get('room')?.trim() ?? '';
      if (!room) {
        room = randomRoomId();
        url.searchParams.set('room', room);
        window.history.replaceState({}, '', url.toString());
      }
      return room.toUpperCase();
    };

    const getSignalingUrl = () => {
      const env = (process.env.NEXT_PUBLIC_SIGNALING_URL ?? '').trim();
      if (env) return env;
      const host = window.location.hostname || 'localhost';
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      return `${protocol}://${host}:3001`;
    };

    const ensureLocalMedia = async () => {
      if (localStreamRef.current) return localStreamRef.current;
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (stopped) {
        for (const t of stream.getTracks()) t.stop();
        return null;
      }
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      return stream;
    };

    const scheduleReconnect = (attempt: number) => {
      if (stopped) return;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      const delay = Math.min(10_000, 500 * Math.pow(2, Math.min(6, attempt)));
      reconnectTimerRef.current = window.setTimeout(() => {
        connect(attempt + 1).catch((e) => console.error(e));
      }, delay);
    };

    const connect = async (attempt = 0) => {
      if (stopped) return;
      if (connectingRef.current) return;
      connectingRef.current = true;

      try {
        const roomId = ensureRoomInUrl();
        setRoomId(roomId);

        const stream = await ensureLocalMedia();
        if (!stream) return;

        // reset transport/rtc but keep local media to avoid re-prompt
        cleanupWs();
        cleanupPeerConnection();

        const ws = new WebSocket(getSignalingUrl());
        wsRef.current = ws;

        const pc = new RTCPeerConnection(rtcConfig);
        pcRef.current = pc;

        for (const track of stream.getTracks()) pc.addTrack(track, stream);

        pc.ontrack = (event) => {
          const [remoteStream] = event.streams;
          if (remoteVideoRef.current && remoteStream) remoteVideoRef.current.srcObject = remoteStream;
        };

        const attachDataChannel = (dc: RTCDataChannel) => {
          if (dataChannelRef.current && dataChannelRef.current !== dc) {
            try {
              dc.close();
            } catch {}
            return;
          }

          dataChannelRef.current = dc;
          dc.onopen = () => {
            const queued = pendingChatRef.current.splice(0, pendingChatRef.current.length);
            for (const text of queued) {
              try {
                dc.send(text);
              } catch {
                pendingChatRef.current.unshift(text);
                break;
              }
            }
          };
          dc.onmessage = (event) => {
            const text = String(event.data ?? '');
            if (!text.trim()) return;
            setMessages((prev) => [
              ...prev,
              { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, sender: 'stranger', text },
            ]);
          };
          dc.onclose = () => {
            if (dataChannelRef.current === dc) dataChannelRef.current = null;
          };
        };

        pc.ondatachannel = (event) => {
          attachDataChannel(event.channel);
        };

        // Create an outbound chat channel on every connection.
        // If the remote side also creates one, we keep the first and close duplicates in attachDataChannel.
        try {
          attachDataChannel(pc.createDataChannel('chat'));
        } catch {}

        pc.onicecandidate = (event) => {
          if (!event.candidate) return;
          try {
            wsRef.current?.send(
              JSON.stringify({ type: 'ice-candidate', candidate: event.candidate.toJSON() } satisfies SignalMessage),
            );
          } catch {}
        };

        const makeOffer = async () => {
          try {
            makingOfferRef.current = true;
            const offer = await pc.createOffer();
            if (pc.signalingState !== 'stable') return;
            await pc.setLocalDescription(offer);
            wsRef.current?.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription! } satisfies SignalMessage));
          } catch (e) {
            console.error(e);
          } finally {
            makingOfferRef.current = false;
          }
        };

        pc.onnegotiationneeded = async () => {
          await makeOffer();
        };

        pc.onconnectionstatechange = () => {
          const st = pc.connectionState;
          if (st === 'failed' || st === 'disconnected') {
            // Rebuild the peer connection while keeping camera/mic.
            scheduleReconnect(attempt);
          }
        };

        const handleSignal = async (msg: SignalMessage) => {
          if (!pcRef.current) return;

          if (msg.type === 'joined') {
            // The peer that joins second becomes "polite" to reduce glare.
            // This stays stable across refreshes and avoids "nobody offers" deadlocks.
            politeRef.current = msg.peers > 0;
            return;
          }

          if (msg.type === 'peer-joined') {
            await makeOffer();
            return;
          }

          if (msg.type === 'peer-left') {
            if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
            return;
          }

          const pcNow = pcRef.current;

          if (msg.type === 'offer') {
            const offerCollision = makingOfferRef.current || pcNow.signalingState !== 'stable';
            ignoreOfferRef.current = !politeRef.current && offerCollision;
            if (ignoreOfferRef.current) return;

            await pcNow.setRemoteDescription(msg.sdp);
            const answer = await pcNow.createAnswer();
            await pcNow.setLocalDescription(answer);
            wsRef.current?.send(JSON.stringify({ type: 'answer', sdp: pcNow.localDescription! } satisfies SignalMessage));
            return;
          }

          if (msg.type === 'answer') {
            await pcNow.setRemoteDescription(msg.sdp);
            return;
          }

          if (msg.type === 'ice-candidate') {
            try {
              await pcNow.addIceCandidate(msg.candidate);
            } catch (err) {
              if (!ignoreOfferRef.current) throw err;
            }
          }
        };

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'join', roomId } satisfies SignalMessage));
        };
        ws.onmessage = async (event) => {
          try {
            const data = JSON.parse(String(event.data)) as SignalMessage;
            await handleSignal(data);
          } catch (e) {
            console.error(e);
          }
        };
        ws.onerror = () => {
          try {
            ws.close();
          } catch {}
        };
        ws.onclose = () => {
          if (!stopped) scheduleReconnect(attempt);
        };
      } finally {
        connectingRef.current = false;
      }
    };

    connect().catch((e) => console.error(e));

    return () => {
      stopped = true;
      cleanup();
    };
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-900 p-4">
      {/* Mobile Container */}
      <div className="w-full max-w-md bg-gray-900 rounded-3xl overflow-hidden shadow-2xl flex flex-col h-screen max-h-screen">
        {/* Top Status Bar */}
        <div className="bg-black/40 backdrop-blur-md px-6 py-3 flex justify-between items-center relative z-40">
          {/* Stranger Badge */}
          <div className="bg-gray-600 text-white px-4 py-2 rounded-full text-sm font-medium">Extraño</div>

          {/* Stats Capsule */}
          <div className="bg-gray-700 text-white px-4 py-2 rounded-full flex items-center gap-3 text-xs font-medium">
            <span>🔗 {roomId || '...'}</span>
            <div className="w-px h-4 bg-gray-500"></div>
            <span>💎 12</span>
          </div>
        </div>

        {/* Remote Video Panel (Stranger) */}
        <div className="flex-1 relative overflow-hidden bg-gradient-to-b from-blue-100 to-gray-100">
          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
        </div>

        {/* Local Video with Floating Chat */}
        <div className="relative h-1/2 overflow-hidden">
          {/* Local User Video Background */}
          <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />

          {/* Floating Chat Panel */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent rounded-b-3xl flex flex-col">
            {/* User Label */}
            <div className="px-6 pt-4">
              <div className="bg-gray-600 text-white px-3 py-1 rounded-full text-xs font-medium w-fit">Tú</div>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.sender === 'stranger' ? (
                    <div className="max-w-xs">
                      <div className="text-xs font-bold text-gray-300 mb-1 ml-2">EXTRAÑO</div>
                      <div className="bg-white text-gray-900 px-4 py-3 rounded-3xl shadow-lg drop-shadow-lg">{msg.text}</div>
                    </div>
                  ) : (
                    <div className="max-w-xs">
                      <div className="text-xs font-bold text-blue-300 mb-1 mr-2 text-right">TÚ</div>
                      <div className="bg-blue-500 text-white px-4 py-3 rounded-3xl shadow-lg drop-shadow-lg">{msg.text}</div>
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input and Send Button */}
            <div className="px-4 py-3 flex gap-2 items-end">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Escribe un mensaje..."
                className="flex-1 bg-white text-gray-900 rounded-full px-4 py-3 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-lg drop-shadow-md"
              />
              <button
                onClick={handleSendMessage}
                className="bg-blue-500 hover:bg-blue-600 text-white rounded-full p-3 flex items-center justify-center shadow-lg drop-shadow-lg transition-colors"
              >
                <Send size={20} />
              </button>
            </div>

            {/* Action Buttons */}
            <div className="px-4 py-3 flex gap-3">
              <button className="bg-red-500 hover:bg-red-600 rounded-2xl p-3 flex items-center justify-center shadow-lg drop-shadow-lg transition-colors">
                <Square size={24} className="text-white fill-white" />
              </button>
              <button className="flex-1 bg-blue-500 hover:bg-blue-600 text-white rounded-2xl py-3 font-bold text-center shadow-lg drop-shadow-lg transition-colors">
                Siguiente
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
