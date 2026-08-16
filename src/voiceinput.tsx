import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Check, CornerDownLeft, Loader2, Mic, Square, X } from 'lucide-react';
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

function VoicePanel() {
  const [status, setStatus] = useState<'idle' | 'listening' | 'error' | 'stopped'>('idle');
  const [message, setMessage] = useState('');
  const [polish, setPolish] = useState('');
  const [raw, setRaw] = useState('');
  const startingRef = useRef(false);
  const polishRef = useRef('');

  const start = async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setMessage('');
    try {
      const cfg = (await window.electronAPI?.voiceGetConfig?.()) as VoiceConfig | undefined;
      if (!cfg?.apiKey || !cfg?.workspaceId) {
        setStatus('error');
        setMessage('请先在「设置 → 语音输入」填写 百炼 API Key 与 Workspace ID');
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
    const unPolish = window.electronAPI?.onVoicePolish?.((text) => {
      polishRef.current = text;
      setPolish(text);
    });
    const unRaw = window.electronAPI?.onVoiceRaw?.((text) => setRaw(text));
    const unStatus = window.electronAPI?.onVoiceStatus?.((s: any) => {
      if (s?.state === 'error') {
        setStatus('error');
        setMessage(s?.message || '识别失败');
      } else if (s?.state === 'listening') {
        setStatus('listening');
        setMessage('');
      } else if (s?.state === 'stopped') {
        setStatus('stopped');
        stopCapture();
      }
    });
    void start();
    return () => {
      unPolish?.();
      unRaw?.();
      unStatus?.();
      stopCapture();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const adopt = () => {
    if (polishRef.current) void window.electronAPI?.voiceAdopt?.();
  };
  const enter = () => {
    void window.electronAPI?.voiceEnter?.();
    window.close();
  };
  const stop = () => {
    void window.electronAPI?.voiceStop?.();
    window.close();
  };

  const listening = status === 'listening';

  return (
    <div className="voice-root">
      <div className="voice-header" style={{ WebkitAppRegion: 'drag' } as any}>
        <Mic size={14} style={{ color: listening ? '#f87171' : 'var(--voice-muted)' }} />
        <span className="voice-title">语音输入</span>
        <span className="voice-hint">Alt+H 关闭</span>
      </div>

      <div className="voice-body">
        {status === 'error' ? (
          <div className="voice-error">{message}</div>
        ) : status === 'idle' ? (
          <div className="voice-loading"><Loader2 size={16} className="spin" /> 正在启动…</div>
        ) : (
          <>
            <div className="voice-row voice-raw">
              <span className="voice-label">原文</span>
              <span className="voice-text">{raw || (listening ? '正在聆听…' : '已结束')}</span>
            </div>
            <div className="voice-row voice-polish">
              <span className="voice-label">润色</span>
              <span className="voice-text polish">{polish || (listening ? '等待润色结果…' : '—')}</span>
            </div>
          </>
        )}
      </div>

      <div className="voice-footer">
        <button type="button" className="voice-btn primary" disabled={!polish || status !== 'listening'} onClick={adopt} title="用润色文本覆盖刚输入的文段">
          <Check size={13} /> 采纳
        </button>
        <button type="button" className="voice-btn" onClick={enter} title="结束并保留当前内容">
          <CornerDownLeft size={13} /> 回车
        </button>
        <button type="button" className="voice-btn" onClick={stop} title="结束">
          <Square size={12} /> 停止
        </button>
        <button type="button" className="voice-btn close" onClick={stop} title="关闭">
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<VoicePanel />);
