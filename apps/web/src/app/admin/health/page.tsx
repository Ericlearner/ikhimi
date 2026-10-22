import { getDb } from '@ikhimi/db'
import { formatDate, formatKrw, type MessageKey } from '@ikhimi/i18n'
import { Badge, StatTile } from '@ikhimi/ui/components'
import { Bars, panel, Section, seconds, usd } from '@/components/admin/Bars'
import { getT } from '@/i18n/server'
import { usdToKrw } from '@/server/ai-usage'
import { pageStaff } from '@/server/admin/guard'
import { healthStats } from '@/server/admin/stats'
import { storageUsage } from '@/server/storage-usage'
import { getTelegramSettings, telegramStats } from '@/server/notify'
import { TelegramLinks } from '@/components/admin/TelegramLinks'
import { TelegramSetup } from '@/components/admin/TelegramSetup'

const KINDS = ['speech', 'pictures', 'image', 'pdf', 'doc', 'audio']
const mb = (n: number) => (n >= 1024 * 1024 * 1024 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`)

/** Is homework generation healthy: volume, failures and why, speed, the review step, pictures, AI cost */
export default async function AdminHealth() {
  const db = getDb()
  const { access } = await pageStaff(db, 'health')
  const { t } = await getT()
  const h = await healthStats(db, 14)
  const [tg, tgSettings, storage] = await Promise.all([telegramStats(db), getTelegramSettings(db), storageUsage(db)])
  const sum = h.days.reduce(
    (s, d) => ({
      total: s.total + d.total,
      failed: s.failed + d.failed,
      reviewSkipped: s.reviewSkipped + d.reviewSkipped,
      reviewFailed: s.reviewFailed + d.reviewFailed,
      pointed: s.pointed + d.pictures.pointed,
      located: s.located + d.pictures.located,
      attached: s.attached + d.pictures.attached,
      removed: s.removed + d.pictures.removed,
    }),
    { total: 0, failed: 0, reviewSkipped: 0, reviewFailed: 0, pointed: 0, located: 0, attached: 0, removed: 0 },
  )
  const so = (v: number) => `≈ ${formatKrw(Math.round(v * usdToKrw()))}원`

  return (
    <div className="flex flex-col gap-8">
      <Section title={t('admin.storage.title')}>
        <div className={`${panel} flex flex-col gap-3`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="t-body font-medium">{t('admin.storage.used')}</span>
            <span className={`t-num font-display text-2xl font-bold ${storage.pct >= 80 ? 'text-error-600' : storage.pct >= 60 ? 'text-warn-600' : ''}`}>
              {storage.pct}% · {t('admin.storage.ofLimit', { used: mb(storage.total), limit: mb(storage.limit) })}
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-pill bg-paper-200" role="img" aria-label={`${storage.pct}%`}>
            <div className={`h-full rounded-pill ${storage.pct >= 80 ? 'bg-error-600' : storage.pct >= 60 ? 'bg-warn-600' : 'bg-success-600'}`} style={{ width: `${Math.min(100, storage.pct)}%` }} />
          </div>
          <p className="t-small text-ink-500">{t('admin.storage.hint')}</p>
          {storage.oldWav > 0 && <p className="t-small text-ink-500">{t('admin.storage.oldWav', { n: storage.oldWav })}</p>}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className={panel}>
            <h3 className="t-small mb-2 font-semibold text-ink-500">{t('admin.storage.files')}</h3>
            <ul className="t-small flex flex-col gap-1">
              {storage.files.map((f) => (
                <li key={f.kind} className="flex justify-between gap-2">
                  <span>{KINDS.includes(f.kind) ? t(`admin.storage.kind.${f.kind}` as MessageKey) : f.kind} · {f.n}</span>
                  <span className="t-num">{mb(f.bytes)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className={panel}>
            <h3 className="t-small mb-2 font-semibold text-ink-500">{t('admin.storage.tables')}</h3>
            <ul className="t-small flex flex-col gap-1">
              {storage.tables.map((x) => (
                <li key={x.name} className="flex justify-between gap-2">
                  <span className="break-all">{x.name}</span>
                  <span className="t-num">{mb(x.bytes)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section title={t('admin.health.title14')}>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatTile value={sum.total} label={t('admin.health.generations')} />
          <StatTile value={<span className={sum.failed ? 'text-error-600' : ''}>{sum.failed}</span>} label={t('admin.health.failed')} hint={sum.total ? `${Math.round((sum.failed / sum.total) * 100)}%` : undefined} />
          <StatTile value={sum.reviewSkipped} label={t('admin.health.reviewSkipped')} hint={sum.reviewFailed ? t('admin.health.reviewFailed', { n: sum.reviewFailed }) : undefined} />
          <StatTile value={`${sum.attached}`} label={t('admin.health.picturesAttached')} hint={t('admin.health.picturesHint', { pointed: sum.pointed, located: sum.located, removed: sum.removed })} />
        </div>
        <div className={`${panel} grid gap-6 md:grid-cols-2`}>
          <Bars data={h.days.map((d) => ({ day: d.day, n: d.total }))} caption={t('admin.health.perDay')} />
          <Bars data={h.days.map((d) => ({ day: d.day, n: d.failed }))} caption={t('admin.health.failedPerDay')} tone="bg-error-600" />
          <Bars data={h.days.map((d) => ({ day: d.day, n: Math.round((d.avgMs ?? 0) / 1000) }))} caption={t('admin.health.avgSecondsPerDay')} format={(n) => `${n} s`} tone="bg-ink-500" />
          <Bars data={h.ai.byDay.slice(-14).map((d) => ({ day: d.day, n: Math.round(d.usd * 100) }))} caption={t('admin.health.costPerDay')} format={(n) => usd(n / 100)} tone="bg-success-600" />
        </div>
      </Section>

      <Section title={t('admin.health.failures')}>
        {h.errorCodes.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {h.errorCodes.map((e) => (
              <Badge key={e.code} tone="error">
                {e.code}: {e.n}
              </Badge>
            ))}
          </div>
        )}
        {h.failures.length === 0 ? (
          <p className="t-body text-ink-500">{t('admin.health.noFailures')}</p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-paper-300 bg-paper-50">
            {h.failures.map((f) => (
              <li key={f.id} className="t-small flex flex-col gap-0.5 border-b border-paper-300 px-4 py-2 last:border-b-0">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone="error">{f.status === 'timeout' ? 'timeout' : (f.errorCode ?? 'error')}</Badge>
                  <span className="font-medium">{f.teacherName ?? '—'}</span>
                  <span className="text-ink-500">
                    {formatDate(f.createdAt)} · {f.mode} · {f.kind} · {seconds(f.durationMs)} · {t('admin.health.files', { n: f.materials })}
                  </span>
                </span>
                {f.errorDetail && <span className="break-words text-ink-500">{f.errorDetail.slice(0, 300)}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('admin.health.aiCost')}>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatTile value={usd(h.ai.totalUsd)} label={t('admin.health.cost14')} hint={so(h.ai.totalUsd)} />
          <StatTile value={h.ai.perHomeworkUsd == null ? '—' : usd(h.ai.perHomeworkUsd)} label={t('admin.health.perHomework')} hint={h.ai.perHomeworkUsd == null ? undefined : so(h.ai.perHomeworkUsd)} />
          <StatTile value={h.ai.calls} label={t('admin.health.calls')} hint={h.ai.failedCalls ? t('admin.health.callsFailed', { n: h.ai.failedCalls }) : undefined} />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div className={panel}>
            <h3 className="t-h3 mb-2">{t('admin.health.byPurpose')}</h3>
            <ul className="t-small flex flex-col gap-1">
              {h.ai.byPurpose.map((p) => (
                <li key={p.purpose} className="flex justify-between gap-2">
                  <span>{t(`admin.purpose.${p.purpose}` as MessageKey)}</span>
                  <span className="t-num text-ink-500">
                    {usd(p.usd)} · {p.calls}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className={panel}>
            <h3 className="t-h3 mb-2">{t('admin.health.byModel')}</h3>
            <ul className="t-small flex flex-col gap-1">
              {h.ai.byModel.map((m) => (
                <li key={m.model} className="flex justify-between gap-2">
                  <span className="truncate">{m.model}</span>
                  <span className="t-num shrink-0 text-ink-500">
                    {usd(m.usd)} · {m.calls}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className={panel}>
            <h3 className="t-h3 mb-2">{t('admin.health.topUsers')}</h3>
            <ul className="t-small flex flex-col gap-1">
              {h.ai.topUsers.map((u) => (
                <li key={u.userId} className="flex justify-between gap-2">
                  <a href={`/admin/users/${u.userId}`} className="truncate hover:underline">
                    {u.name ?? '—'}
                  </a>
                  <span className="t-num shrink-0 text-ink-500">{usd(u.usd)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="t-small text-ink-400">{t('admin.health.costNote')}</p>
      </Section>

      <Section title={t('admin.tg.title')}>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatTile value={`${tg.linked}/${tg.students}`} label={t('admin.tg.reach')} hint={t('admin.tg.reachHint')} />
          <StatTile value={tg.sent.new} label={t('admin.tg.sentNew')} hint={t('admin.tg.last7')} />
          <StatTile value={tg.sent.due + tg.sent.nudge} label={t('admin.tg.sentReminders')} hint={t('admin.tg.last7')} />
          <StatTile value={tg.sent.alert} label={t('admin.tg.sentAlerts')} hint={t('admin.tg.last7')} />
        </div>
        <ul className={`${panel} t-small flex flex-col gap-1`}>
          <li>{t(tg.bot ? 'admin.tg.botOn' : 'admin.tg.botOff')}</li>
          <li>{t(tg.cron ? 'admin.tg.cronOn' : 'admin.tg.cronOff')}</li>
          <li>{t(`admin.tg.alerts.${tg.alerts}` as MessageKey)}</li>
        </ul>
        {access.owner && <TelegramLinks initial={tgSettings.links} />}
        {access.owner && <TelegramSetup />}
      </Section>
    </div>
  )
}
