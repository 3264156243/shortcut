import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Download, RefreshCw, X } from 'lucide-react';
import { UpdateState } from '../types';
import { useTranslation } from '../hooks/useTranslation';

function formatSpeed(bytesPerSecond = 0) {
  if (!bytesPerSecond) return '计算中';
  if (bytesPerSecond >= 1024 * 1024) return (bytesPerSecond / 1024 / 1024).toFixed(1) + ' MB/s';
  return Math.max(1, Math.round(bytesPerSecond / 1024)) + ' KB/s';
}

function formatRemaining(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '计算中';
  if (seconds < 60) return Math.max(1, Math.ceil(seconds)) + ' 秒';
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return minutes + ' 分钟';
  const hours = Math.floor(minutes / 60);
  return hours + ' 小时 ' + (minutes % 60) + ' 分钟';
}

interface UpdateModalProps {
  state: UpdateState;
  onDownload: () => void;
  onInstall: () => void;
  onDismiss: () => void;
}

export default function UpdateModal({ state, onDownload, onInstall, onDismiss }: UpdateModalProps) {
  const { t } = useTranslation();
  const available = state.status === 'available';
  const downloading = state.status === 'downloading';
  const downloaded = state.status === 'downloaded';
  const failed = state.status === 'error';
  const visible = available || downloading || downloaded || (failed && !!state.manual);
  const progress = Math.max(0, Math.min(100, state.progress || 0));
  const remainingSeconds = state.bytesPerSecond && state.total
    ? Math.max(0, (state.total - (state.transferred || 0)) / state.bytesPerSecond)
    : Number.NaN;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          data-update-modal
          className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
          style={{ background: 'rgba(8, 10, 14, .72)', backdropFilter: 'blur(4px)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onDismiss}
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: .96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: .97 }}
            transition={{ type: 'spring', damping: 24, stiffness: 320 }}
            className="w-full max-w-md overflow-hidden rounded-xl"
            style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', boxShadow: '0 24px 70px rgba(0,0,0,.45)' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4" style={{ background: 'var(--color-bg-card)', borderBottom: '1px solid var(--color-border)' }}>
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: failed ? '#9b2335' : 'var(--color-accent)', color: 'white' }}>
                  {failed ? <AlertTriangle size={18} /> : downloaded ? <CheckCircle2 size={18} /> : <Download size={18} />}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                    {available ? t('update.availableTitle') : t('update.title')}
                  </div>
                  <div className="mt-0.5 truncate text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {state.version ? t('update.version', { version: state.version }) : t('update.current', { version: state.currentVersion })}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={onDismiss}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-opacity hover:opacity-75"
                style={{ color: 'var(--color-text-muted)' }}
                title={t('update.close')}
              >
                <X size={17} />
              </button>
            </div>

            <div className="px-5 py-5">
              {failed ? (
                <div className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                  {t('update.failed')}
                  <div className="mt-2 break-words rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-muted)' }}>
                    {state.error || t('update.unknownError')}
                  </div>
                </div>
              ) : available ? (
                <div>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                    {t('update.availablePrompt')}
                  </p>
                  <div className="mt-4">
                    <div className="mb-2 text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>{t('update.releaseNotes')}</div>
                    <div
                      className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg px-3 py-3 text-sm leading-6"
                      style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
                    >
                      {state.releaseNotes || t('update.noReleaseNotes')}
                    </div>
                  </div>
                </div>
              ) : downloaded ? (
                <div className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                  {t('update.ready', { version: state.version || '' })}
                </div>
              ) : (
                <div className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                  {t('update.downloading')}
                  <div className="mt-4 h-2 overflow-hidden rounded-full" style={{ background: 'var(--color-bg-card-hover)' }}>
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: 'var(--color-accent)' }}
                      initial={{ width: 0 }}
                      animate={{ width: progress + '%' }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-xs tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                    <span>速度 {formatSpeed(state.bytesPerSecond)} · 预计剩余 {formatRemaining(remainingSeconds)}</span>
                    <span>{Math.round(progress)}%</span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 pb-5">
              {failed ? (
                <button
                  type="button"
                  onClick={onDismiss}
                  className="rounded-lg px-4 py-2 text-sm transition-opacity hover:opacity-80"
                  style={{ background: 'var(--color-bg-card-hover)', color: 'var(--color-text-secondary)' }}
                >
                  {t('update.close')}
                </button>
              ) : available ? (
                <>
                  <button
                    type="button"
                    onClick={onDismiss}
                    className="rounded-lg px-4 py-2 text-sm transition-opacity hover:opacity-80"
                    style={{ background: 'var(--color-bg-card-hover)', color: 'var(--color-text-secondary)' }}
                  >
                    {t('update.later')}
                  </button>
                  <button
                    type="button"
                    onClick={onDownload}
                    className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-85"
                    style={{ background: 'var(--color-accent)', color: 'white' }}
                  >
                    <Download size={15} /> {t('update.download')}
                  </button>
                </>
              ) : downloaded ? (
                <>
                  <button
                    type="button"
                    onClick={onDismiss}
                    className="rounded-lg px-4 py-2 text-sm transition-opacity hover:opacity-80"
                    style={{ background: 'var(--color-bg-card-hover)', color: 'var(--color-text-secondary)' }}
                  >
                    {t('update.later')}
                  </button>
                  <button
                    type="button"
                    onClick={onInstall}
                    className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-85"
                    style={{ background: 'var(--color-accent)', color: 'white' }}
                  >
                    <RefreshCw size={15} /> {t('update.restart')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onDismiss}
                  className="rounded-lg px-4 py-2 text-sm transition-opacity hover:opacity-80"
                  style={{ background: 'var(--color-bg-card-hover)', color: 'var(--color-text-secondary)' }}
                >
                  {t('update.background')}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
