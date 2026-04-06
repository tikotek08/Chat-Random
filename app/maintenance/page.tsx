'use client';

import { useEffect, useState } from 'react';

type Visit = {
  id: string;
  ip: string | null;
  country: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  referrer: string | null;
  created_at: string;
};

const COUNTRY_FLAGS: Record<string, string> = {
  MX: '🇲🇽', US: '🇺🇸', AR: '🇦🇷', ES: '🇪🇸', CO: '🇨🇴',
  BR: '🇧🇷', CL: '🇨🇱', PE: '🇵🇪', VE: '🇻🇪', EC: '🇪🇨',
  GT: '🇬🇹', CR: '🇨🇷', PA: '🇵🇦', DO: '🇩🇴', BO: '🇧🇴',
  UY: '🇺🇾', PY: '🇵🇾', HN: '🇭🇳', SV: '🇸🇻', NI: '🇳🇮',
  DE: '🇩🇪', FR: '🇫🇷', GB: '🇬🇧', IT: '🇮🇹', CA: '🇨🇦',
  JP: '🇯🇵', KR: '🇰🇷', CN: '🇨🇳', AU: '🇦🇺', IN: '🇮🇳',
};

function Particle({ style }: { style: React.CSSProperties }) {
  return (
    <div style={{
      position: 'absolute', borderRadius: '50%',
      background: 'rgba(99,102,241,0.15)',
      animation: 'float 8s ease-in-out infinite',
      ...style,
    }} />
  );
}

export default function MaintenancePage() {
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loadingVisits, setLoadingVisits] = useState(false);
  const [dots, setDots] = useState('');

  // Animated dots
  useEffect(() => {
    const t = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 600);
    return () => clearInterval(t);
  }, []);

  // Track this visit
  useEffect(() => {
    fetch('/api/track-visit', { method: 'POST' }).catch(() => {});
  }, []);

  // Check for admin token in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('admin');
    if (t) setAdminToken(t);
  }, []);

  // Load visits when admin token is present
  useEffect(() => {
    if (!adminToken) return;
    setLoadingVisits(true);
    fetch(`/api/track-visit?token=${adminToken}`)
      .then(r => r.json())
      .then(data => { if (data.visits) setVisits(data.visits); })
      .catch(() => {})
      .finally(() => setLoadingVisits(false));
  }, [adminToken]);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('es', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <>
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px) scale(1); opacity: 0.15; }
          50% { transform: translateY(-30px) scale(1.1); opacity: 0.25; }
        }
        @keyframes pulse-ring {
          0% { transform: scale(0.8); opacity: 0.8; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #07071a; }
      `}</style>

      <div style={{
        minHeight: '100vh', background: 'linear-gradient(135deg, #07071a 0%, #0c0c2e 50%, #07071a 100%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '24px', position: 'relative', overflow: 'hidden', fontFamily: 'system-ui, sans-serif',
      }}>

        {/* Background particles */}
        <Particle style={{ width: 300, height: 300, top: '-100px', left: '-100px', animationDelay: '0s' }} />
        <Particle style={{ width: 200, height: 200, top: '20%', right: '-50px', animationDelay: '2s' }} />
        <Particle style={{ width: 150, height: 150, bottom: '10%', left: '10%', animationDelay: '4s' }} />
        <Particle style={{ width: 250, height: 250, bottom: '-80px', right: '15%', animationDelay: '1s' }} />

        {/* Subtle grid */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'linear-gradient(rgba(99,102,241,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.04) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }} />

        {/* Main card */}
        <div style={{
          position: 'relative', zIndex: 10, textAlign: 'center', maxWidth: 480, width: '100%',
          animation: 'fade-up 0.8s ease-out',
        }}>

          {/* Animated icon */}
          <div style={{ position: 'relative', width: 100, height: 100, margin: '0 auto 32px' }}>
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              border: '2px solid rgba(99,102,241,0.5)',
              animation: 'pulse-ring 2s ease-out infinite',
            }} />
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              border: '2px solid rgba(99,102,241,0.3)',
              animation: 'pulse-ring 2s ease-out infinite',
              animationDelay: '0.6s',
            }} />
            <div style={{
              width: 100, height: 100, borderRadius: '50%',
              background: 'linear-gradient(135deg, rgba(79,70,229,0.2), rgba(124,58,237,0.2))',
              border: '2px solid rgba(99,102,241,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backdropFilter: 'blur(10px)',
              boxShadow: '0 0 40px rgba(99,102,241,0.3)',
            }}>
              <span style={{ fontSize: 42 }}>⚙️</span>
            </div>
          </div>

          {/* Title */}
          <h1 style={{
            color: 'white', fontSize: 28, fontWeight: 900,
            letterSpacing: '-0.5px', marginBottom: 12,
            background: 'linear-gradient(135deg, #fff 0%, #a5b4fc 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            Estamos mejorando para ti
          </h1>

          <p style={{
            color: 'rgba(255,255,255,0.55)', fontSize: 16, lineHeight: 1.6, marginBottom: 32,
          }}>
            Chat Random está en mantenimiento. Estamos trabajando en nuevas funciones para darte la mejor experiencia{dots}
          </p>

          {/* Status badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)',
            borderRadius: 24, padding: '8px 18px', marginBottom: 32,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fbbf24', display: 'inline-block', boxShadow: '0 0 8px #fbbf24', animation: 'pulse-ring 1.5s ease-out infinite' }} />
            <span style={{ color: '#fbbf24', fontSize: 13, fontWeight: 600 }}>Mantenimiento en progreso</span>
          </div>

          {/* Cards row */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 32 }}>
            {[
              { icon: '🚀', label: 'Nuevas funciones', desc: 'Mejoras en camino' },
              { icon: '🔒', label: 'Más seguridad', desc: 'Protección mejorada' },
              { icon: '⚡', label: 'Más velocidad', desc: 'Experiencia fluida' },
            ].map(item => (
              <div key={item.label} style={{
                flex: 1, padding: '16px 12px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: 16, textAlign: 'center',
              }}>
                <div style={{ fontSize: 22, marginBottom: 6 }}>{item.icon}</div>
                <div style={{ color: 'white', fontSize: 12, fontWeight: 700, marginBottom: 2 }}>{item.label}</div>
                <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>{item.desc}</div>
              </div>
            ))}
          </div>

          {/* Footer note */}
          <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>
            Volvemos muy pronto · <span style={{ color: 'rgba(165,180,252,0.5)' }}>Chat Random</span>
          </p>
        </div>

        {/* ── ADMIN PANEL ─────────────────────────────────── */}
        {adminToken && (
          <div style={{
            position: 'relative', zIndex: 10,
            width: '100%', maxWidth: 700, marginTop: 48,
            background: 'rgba(12,12,38,0.9)',
            border: '1px solid rgba(99,102,241,0.3)',
            borderRadius: 20, padding: '24px',
            backdropFilter: 'blur(20px)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ color: 'white', fontSize: 16, fontWeight: 800 }}>
                📊 Visitas durante mantenimiento
              </h2>
              <span style={{
                background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)',
                borderRadius: 20, padding: '4px 12px', color: '#a5b4fc', fontSize: 12, fontWeight: 700,
              }}>
                {visits.length} visitas
              </span>
            </div>

            {loadingVisits ? (
              <div style={{ textAlign: 'center', padding: '32px', color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>
                Cargando{dots}
              </div>
            ) : visits.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px', color: 'rgba(255,255,255,0.25)', fontSize: 14 }}>
                Ninguna visita registrada aún
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' }}>
                {visits.map((v, i) => (
                  <div key={v.id} style={{
                    display: 'grid', gridTemplateColumns: 'auto 1fr auto auto auto',
                    alignItems: 'center', gap: 12,
                    background: i === 0 ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${i === 0 ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.05)'}`,
                    borderRadius: 12, padding: '10px 14px',
                  }}>
                    {/* Index */}
                    <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, minWidth: 20, textAlign: 'right' }}>
                      {i + 1}
                    </span>
                    {/* IP + Country */}
                    <div>
                      <div style={{ color: 'white', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {v.country && (COUNTRY_FLAGS[v.country] ?? '🌐')}
                        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{v.ip ?? '—'}</span>
                      </div>
                      {v.referrer && (
                        <div style={{ color: 'rgba(165,180,252,0.4)', fontSize: 11, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                          {v.referrer}
                        </div>
                      )}
                    </div>
                    {/* Device */}
                    <span style={{
                      background: v.device === 'Móvil' ? 'rgba(74,222,128,0.1)' : 'rgba(99,102,241,0.1)',
                      border: `1px solid ${v.device === 'Móvil' ? 'rgba(74,222,128,0.25)' : 'rgba(99,102,241,0.25)'}`,
                      color: v.device === 'Móvil' ? '#4ade80' : '#a5b4fc',
                      borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 600,
                    }}>
                      {v.device === 'Móvil' ? '📱' : '💻'} {v.device}
                    </span>
                    {/* Browser + OS */}
                    <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, whiteSpace: 'nowrap' }}>
                      {v.browser} · {v.os}
                    </span>
                    {/* Time */}
                    <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, whiteSpace: 'nowrap' }}>
                      {formatTime(v.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
