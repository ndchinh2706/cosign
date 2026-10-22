import { SCREENS } from '@/lib/screens'

export function ScreenPlaceholder({ id, param }: { id: keyof typeof SCREENS; param?: string }) {
  const s = SCREENS[id]
  return (
    <section style={{ padding: '24px 28px' }}>
      <div className="mono muted" style={{ fontSize: 12 }}>
        {s.code} · {s.route}
        {param ? ` · ${param}` : ''}
      </div>
      <h1 style={{ margin: '4px 0 8px', fontSize: 22 }}>{s.name}</h1>
      <p className="muted" style={{ margin: 0 }}>
        Role: <code>{s.roles.join(', ')}</code>
      </p>
      <p className="muted mono" style={{ fontSize: 12 }}>
        TODO port từ design/prototype/{s.proto} · spec docs/SCREENS.md
      </p>
    </section>
  )
}
