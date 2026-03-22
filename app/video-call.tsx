'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type SignalMessage =
  | { type: 'join'; roomId: string }
  | { type: 'joined'; roomId: string; peers: number }
  | { type: 'peer-joined' }
  | { type: 'peer-left' }
  | { type: 'offer'; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'ice-candidate'; candidate: RTCIceCandidateInit }
  | { type: 'leave' }

function randomRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

const rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
}

/** Resolves when the socket is OPEN; rejects if it errors or closes before that. */
function waitForWebSocketOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve()
      return
    }
    if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
      reject(new Error('WebSocket ya estaba cerrado'))
      return
    }
    const onOpen = () => {
      cleanup()
      resolve()
    }
    const onFail = () => {
      cleanup()
      reject(new Error('WebSocket no pudo abrirse'))
    }
    const cleanup = () => {
      ws.removeEventListener('open', onOpen)
      ws.removeEventListener('error', onFail)
      ws.removeEventListener('close', onFail)
    }
    ws.addEventListener('open', onOpen)
    ws.addEventListener('error', onFail)
    ws.addEventListener('close', onFail)
  })
}

function normalizeSignalingUrl(raw: string): string {
  const t = raw.trim()
  if (!t) return t
  if (t.startsWith('https://')) return `wss://${t.slice('https://'.length)}`
  if (t.startsWith('http://')) return `ws://${t.slice('http://'.length)}`
  return t
}

function wsSend(ws: WebSocket | null, msg: SignalMessage) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify(msg))
}

export function VideoCall() {
  const [roomId, setRoomId] = useState<string>(() => randomRoomId())
  const [joinedRoomId, setJoinedRoomId] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('Listo para iniciar')
  const [isJoining, setIsJoining] = useState(false)
  const [micEnabled, setMicEnabled] = useState(true)
  const [camEnabled, setCamEnabled] = useState(true)

  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const makingOfferRef = useRef(false)
  const ignoreOfferRef = useRef(false)
  const politeRef = useRef(false)

  const signalingUrl = useMemo(() => {
    if (typeof window === 'undefined') return 'ws://localhost:3001'
    const env = normalizeSignalingUrl(process.env.NEXT_PUBLIC_SIGNALING_URL ?? '')
    if (env) return env
    const host = window.location.hostname || 'localhost'
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${protocol}://${host}:3001`
  }, [])

  const cleanupPeerConnection = useCallback(() => {
    makingOfferRef.current = false
    ignoreOfferRef.current = false
    politeRef.current = false

    if (pcRef.current) {
      try {
        pcRef.current.onicecandidate = null
        pcRef.current.ontrack = null
        pcRef.current.onnegotiationneeded = null
        pcRef.current.onconnectionstatechange = null
        pcRef.current.close()
      } catch {}
      pcRef.current = null
    }

    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
  }, [])

  const cleanupMedia = useCallback(() => {
    const stream = localStreamRef.current
    if (stream) {
      for (const t of stream.getTracks()) t.stop()
    }
    localStreamRef.current = null
    if (localVideoRef.current) localVideoRef.current.srcObject = null
  }, [])

  const hangUp = useCallback(() => {
    setStatus('Llamada finalizada')
    setJoinedRoomId(null)

    try {
      wsSend(wsRef.current, { type: 'leave' })
    } catch {}

    try {
      wsRef.current?.close()
    } catch {}
    wsRef.current = null

    cleanupPeerConnection()
    cleanupMedia()
  }, [cleanupMedia, cleanupPeerConnection])

  const ensureLocalMedia = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    localStreamRef.current = stream
    if (localVideoRef.current) localVideoRef.current.srcObject = stream
    return stream
  }, [])

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection(rtcConfig)

    pc.onicecandidate = (event) => {
      if (!event.candidate) return
      try {
        wsSend(wsRef.current, { type: 'ice-candidate', candidate: event.candidate.toJSON() })
      } catch {}
    }

    pc.ontrack = (event) => {
      const [stream] = event.streams
      if (remoteVideoRef.current && stream) remoteVideoRef.current.srcObject = stream
    }

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState
      if (st === 'connected') setStatus('Conectado')
      if (st === 'failed') setStatus('Falló la conexión (reintenta)')
      if (st === 'disconnected') setStatus('Desconectado')
      if (st === 'connecting') setStatus('Conectando...')
    }

    pc.onnegotiationneeded = async () => {
      try {
        makingOfferRef.current = true
        const offer = await pc.createOffer()
        if (pc.signalingState !== 'stable') return
        await pc.setLocalDescription(offer)
        wsSend(wsRef.current, { type: 'offer', sdp: pc.localDescription! })
      } catch (e) {
        console.error(e)
      } finally {
        makingOfferRef.current = false
      }
    }

    pcRef.current = pc
    return pc
  }, [])

  const handleSignal = useCallback(
    async (msg: SignalMessage) => {
      if (msg.type === 'joined') {
        setJoinedRoomId(msg.roomId)
        setStatus(msg.peers > 0 ? 'Conectando con el otro usuario…' : 'Esperando a que el otro usuario se una…')
        // First peer in room becomes "polite" to reduce glare when the second joins.
        politeRef.current = msg.peers === 0
        return
      }

      if (msg.type === 'peer-joined') {
        setStatus('Otro usuario conectado, negociando…')
        return
      }

      if (msg.type === 'peer-left') {
        setStatus('El otro usuario salió')
        cleanupPeerConnection()
        return
      }

      const pc = pcRef.current
      if (!pc) return

      if (msg.type === 'offer') {
        const offerCollision = makingOfferRef.current || pc.signalingState !== 'stable'
        ignoreOfferRef.current = !politeRef.current && offerCollision
        if (ignoreOfferRef.current) return

        await pc.setRemoteDescription(msg.sdp)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        wsSend(wsRef.current, { type: 'answer', sdp: pc.localDescription! })
        return
      }

      if (msg.type === 'answer') {
        await pc.setRemoteDescription(msg.sdp)
        return
      }

      if (msg.type === 'ice-candidate') {
        try {
          await pc.addIceCandidate(msg.candidate)
        } catch (err) {
          if (!ignoreOfferRef.current) throw err
        }
      }
    },
    [cleanupPeerConnection],
  )

  const join = useCallback(async () => {
    if (isJoining) return
    setIsJoining(true)
    setStatus('Pidiendo permisos de cámara/mic…')

    try {
      const stream = await ensureLocalMedia()

      setStatus('Conectando al servidor de señalización…')
      const ws = new WebSocket(signalingUrl)
      wsRef.current = ws

      ws.onmessage = async (event) => {
        const data = JSON.parse(String(event.data)) as SignalMessage
        await handleSignal(data)
      }

      ws.onerror = () => setStatus('Error de señalización (¿está corriendo el servidor?)')
      ws.onclose = () => setStatus('Señalización desconectada')

      await waitForWebSocketOpen(ws)

      setStatus('Uniéndose a la sala…')
      wsSend(ws, { type: 'join', roomId })

      const pc = createPeerConnection()
      for (const track of stream.getTracks()) pc.addTrack(track, stream)
    } catch (e) {
      console.error(e)
      setStatus('No se pudo acceder a cámara/mic (revisa permisos)')
      hangUp()
    } finally {
      setIsJoining(false)
    }
  }, [createPeerConnection, ensureLocalMedia, handleSignal, hangUp, isJoining, roomId, signalingUrl])

  useEffect(() => {
    return () => {
      hangUp()
    }
  }, [hangUp])

  useEffect(() => {
    const stream = localStreamRef.current
    if (!stream) return
    for (const t of stream.getAudioTracks()) t.enabled = micEnabled
  }, [micEnabled])

  useEffect(() => {
    const stream = localStreamRef.current
    if (!stream) return
    for (const t of stream.getVideoTracks()) t.enabled = camEnabled
  }, [camEnabled])

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4">
      <div className="mx-auto w-full max-w-5xl space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <div className="text-xl font-semibold">Videollamada 1–a–1</div>
            <div className="text-sm text-white/70">{status}</div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <label className="text-sm text-white/80">Sala</label>
              <input
                value={roomId}
                onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                className="w-36 rounded-lg bg-white/10 px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-blue-500"
                placeholder="ABC123"
                disabled={!!joinedRoomId}
              />
              <button
                className="rounded-lg bg-white/10 px-3 py-2 text-sm ring-1 ring-white/10 hover:bg-white/15"
                onClick={() => setRoomId(randomRoomId())}
                disabled={!!joinedRoomId}
              >
                Nuevo
              </button>
            </div>

            {!joinedRoomId ? (
              <button
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-50"
                onClick={join}
                disabled={isJoining || !roomId.trim()}
              >
                Iniciar / Unirse
              </button>
            ) : (
              <button className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold hover:bg-red-500" onClick={hangUp}>
                Colgar
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="text-sm font-semibold text-white/90">Tu cámara</div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-lg bg-white/10 px-3 py-1.5 text-xs ring-1 ring-white/10 hover:bg-white/15"
                  onClick={() => setMicEnabled((v) => !v)}
                  disabled={!localStreamRef.current}
                >
                  Mic: {micEnabled ? 'ON' : 'OFF'}
                </button>
                <button
                  className="rounded-lg bg-white/10 px-3 py-1.5 text-xs ring-1 ring-white/10 hover:bg-white/15"
                  onClick={() => setCamEnabled((v) => !v)}
                  disabled={!localStreamRef.current}
                >
                  Cam: {camEnabled ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>
            <video ref={localVideoRef} autoPlay playsInline muted className="aspect-video w-full bg-black" />
          </div>

          <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 overflow-hidden">
            <div className="px-4 py-3">
              <div className="text-sm font-semibold text-white/90">Remoto</div>
              <div className="text-xs text-white/60">
                Abre esta misma página en otra pestaña/dispositivo, usa el mismo código de sala y dale a “Iniciar / Unirse”.
              </div>
            </div>
            <video ref={remoteVideoRef} autoPlay playsInline className="aspect-video w-full bg-black" />
          </div>
        </div>
      </div>
    </div>
  )
}

