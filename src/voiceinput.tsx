import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Check, Loader2, Pause, Mic, X } from 'lucide-react';
import './voiceinput.css';

interface VoiceConfig {
  enabled?: boolean;
  apiKey?: string;
  workspaceId?: string;
  polishMode?: string;
}

let audioCtx: AudioContext | null = null;
let processor: ScriptProcessorNode | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let mediaStream: MediaStream | null = null;

function stopCapture() {
  try { processor?.disconnect(); } catch {}
  try { source?.disconnect(); } catch {}
  try { mediaStream?.getTracks().forEach((t) => t.stop()); } catch {}
  if (audioCtx) { try { void audioCtx.close(); } catch {} }
  audioCtx = null;
  processor = null;
  source = null;
  mediaStream = null;
}

function VoiceCapsule() {
  const [status, setStatus] = useState<'idle' | 'listening' | 'paused' | 'processing' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [session, setSession] = useState('');
  const startingRef = useRef(false);

  const start = async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setMessage('');
    try {
      const cfg = (await window.electronAPI?.voiceGetConfig?.()) as VoiceConfig | undefined;
      if (!cfg?.apiKey || !cfg?.workspaceId) {
        setStatus('error');
        setMessage('请先在「设置 → 语音输入」填写 API Key 与 Workspace ID');
        startingRef.current = false;
        return;
      }
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      audioCtx = new AudioContext();
      const rate = audioCtx.sampleRate || 48000;
      const ratio = rate / 16000;
      source = audioCtx.createMediaStreamSource(mediaStream);
      processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const out: number[] = [];
        for (let i = 0; i < input.length; i += ratio) {
          const idx = Math.floor(i);
          if (idx < input.length) out.push(input[idx]);
        }
        const pcm = new Int16Array(out.length);
        for (let i = 0; i < out.length; i++) {
          const s = Math.max(-1, Math.min(1, out[i]));
          pcm[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
        }
        if (pcm.length > 0) {
          window.electronAPI?.voiceAudio?.(pcm.buffer.slice(0) as ArrayBuffer);
        }
      };
      const gain = audioCtx.createGain();
      gain.gain.value = 0;
      source.connect(processor);
      processor.connect(gain);
      gain.connect(audioCtx.destination);
      const r = await window.electronAPI?.voiceStart?.();
      if (r && (r as any).success === false) {
        stopCapture();
        setStatus('error');
        setMessage((r as any).message || '启动识别失败');
        startingRef.current = false;
        return;
      }
      setStatus('listening');
    } catch (err: any) {
      setStatus('error');
      setMessage('无法访问麦克风: ' + (err?.message || err));
      stopCapture();
    }
    startingRef.current = false;
  };

  useEffect(() => {
    const unSession = window.electronAPI?.onVoiceSession?.((text) => {
      setSession(text);
    });
    const unPolishError = window.electronAPI?.onVoicePolishError?.((text) => {
      setStatus('error');
      setMessage(text);
    });
    const unStatus = window.electronAPI?.onVoiceStatus?.((s: any) => {
      if (s?.state === 'error') {
        setStatus('error');
        setMessage(s?.message || '识别失败');
      } else if (s?.state === 'listening') {
        setStatus('listening');
        setMessage('');
      } else if (s?.state === 'paused') {
        setStatus('paused');
        setMessage(s?.message || '已暂停');
      } else if (s?.state === 'processing') {
        setStatus('processing');
        setMessage(s?.message || '整理中…');
      } else if (s?.state === 'done') {
        setStatus('listening');
        setMessage('');
      }
    });
    void start();
    return () => {
      unSession?.();
      unPolishError?.();
      unStatus?.();
      stopCapture();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirm = () => {
    void window.electronAPI?.voiceConfirm?.();
  };
  const cancel = () => {
    void window.electronAPI?.voiceCancel?.();
  };

  const processing = status === 'processing';
  const listening = status === 'listening';
  const paused = status === 'paused';
  const hasText = session.length > 0;

  return (
    <div className="capsule-root">
      <button type="button" className="capsule-btn" onClick={cancel} title="取消，不输入（ESC）" disabled={processing}>
        <X size={14} />
      </button>

      <div className="capsule-text-wrap">
        {status === 'error' ? (
          <span className="capsule-text error" title={message}>{message}</span>
        ) : processing ? (
          <span className="capsule-text processing">
            <Loader2 size={12} className="spin" /> 整理中…
          </span>
        ) : (
          <>
            <span className={'capsule-state ' + (paused ? 'paused' : '')} title={paused ? '已暂停（空格继续）' : '正在识别（空格暂停）'}>
              {paused ? <Pause size={10} /> : <Mic size={10} />}
            </span>
            <span className="capsule-text" title={session || ''}>
              {session || (status === 'idle' ? '正在启动…' : '聆听中…')}
            </span>
          </>
        )}
      </div>

      <button
        type="button"
        className={'capsule-btn confirm' + (hasText && !processing ? ' armed' : '')}
        onClick={confirm}
        title="整理结构并输入到光标处（回车）"
        disabled={processing || !hasText}
      >
        {processing ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
      </button>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<VoiceCapsule />);
