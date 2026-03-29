import {
  appendOpenAiRealtimeAudio,
  pollOpenAiRealtimeTranscription,
  startOpenAiRealtimeTranscription,
  stopOpenAiRealtimeTranscription,
  transcribeWavChunkLocal,
  type RealtimeTranscriptEvent,
} from './voiceOverlay';

export type SttProviderId = 'webview2' | 'openai_online' | 'openai_whisper_local';

export type ProviderSnapshot = {
  provider: SttProviderId;
  transcript: string;
  latencyMs: number;
  ok: boolean;
  detail?: string;
  updatedAtMs: number;
};

export type LiveSttConfig = {
  provider: SttProviderId;
  compareAll: boolean;
  language: string;
};

export type LiveSttCallbacks = {
  onStatus: (message: string) => void;
  onProviderSnapshot: (snapshot: ProviderSnapshot) => void;
};

type SpeechRecognitionCtor = new () => {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
  length: number;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

export class LiveSttController {
  private config: LiveSttConfig | null = null;
  private callbacks: LiveSttCallbacks | null = null;
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private speechRecognition: InstanceType<SpeechRecognitionCtor> | null = null;
  private openAiPollTimer: number | null = null;
  private running = false;
  private localBusy = false;
  private openAiBusy = false;
  private lastOpenAiFlushAtMs = 0;
  private lastLocalFlushAtMs = 0;
  private rollingPcmChunks: Int16Array[] = [];
  private pendingOpenAiChunks: Int16Array[] = [];

  async start(config: LiveSttConfig, callbacks: LiveSttCallbacks): Promise<void> {
    if (this.running) {
      await this.stop();
    }

    this.config = config;
    this.callbacks = callbacks;
    this.running = true;
    this.lastOpenAiFlushAtMs = Date.now();
    this.lastLocalFlushAtMs = Date.now();
    this.rollingPcmChunks = [];
    this.pendingOpenAiChunks = [];

    callbacks.onStatus('Requesting microphone access...');
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });

    this.audioContext = new AudioContext({ sampleRate: 24000 });
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.processorNode.onaudioprocess = (event) => {
      if (!this.running) {
        return;
      }
      const input = event.inputBuffer.getChannelData(0);
      const pcm16 = floatTo16BitPcm(input);
      this.rollingPcmChunks.push(pcm16);
      this.trimRollingChunksToMs(9_000);

      if (this.needsOpenAi()) {
        this.pendingOpenAiChunks.push(pcm16);
        if (Date.now() - this.lastOpenAiFlushAtMs >= 250) {
          void this.flushOpenAi();
        }
      }

      if (this.needsLocalWhisper() && Date.now() - this.lastLocalFlushAtMs >= 4_000) {
        void this.flushLocalWhisper();
      }
    };

    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.audioContext.destination);

    if (this.needsOpenAi()) {
      callbacks.onStatus('Connecting OpenAI realtime speech-to-text...');
      await startOpenAiRealtimeTranscription({
        model: 'gpt-4o-transcribe',
        language: config.language,
      });
      this.openAiPollTimer = window.setInterval(() => {
        void this.pollOpenAi();
      }, 300);
    }

    if (this.needsWebSpeech()) {
      this.startWebSpeechRecognition();
    }

    callbacks.onStatus('Live transcription is running.');
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.openAiPollTimer !== null) {
      window.clearInterval(this.openAiPollTimer);
      this.openAiPollTimer = null;
    }

    try {
      if (this.needsOpenAi()) {
        const events = await stopOpenAiRealtimeTranscription();
        this.consumeRealtimeEvents(events);
      }
    } catch {
      // ignore stop errors on shutdown
    }

    if (this.speechRecognition) {
      try {
        this.speechRecognition.onend = null;
        this.speechRecognition.stop();
      } catch {
        // ignore
      }
      this.speechRecognition = null;
    }

    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode.onaudioprocess = null;
      this.processorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.audioContext) {
      await this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.pendingOpenAiChunks = [];
    this.rollingPcmChunks = [];
  }

  private needsOpenAi(): boolean {
    return !!this.config && (this.config.provider === 'openai_online' || this.config.compareAll);
  }

  private needsWebSpeech(): boolean {
    return !!this.config && (this.config.provider === 'webview2' || this.config.compareAll);
  }

  private needsLocalWhisper(): boolean {
    return !!this.config && (this.config.provider === 'openai_whisper_local' || this.config.compareAll);
  }

  private async flushOpenAi(): Promise<void> {
    if (!this.running || !this.needsOpenAi() || this.openAiBusy || this.pendingOpenAiChunks.length === 0) {
      return;
    }

    this.openAiBusy = true;
    const chunk = mergeInt16Chunks(this.pendingOpenAiChunks);
    this.pendingOpenAiChunks = [];
    this.lastOpenAiFlushAtMs = Date.now();

    try {
      const events = await appendOpenAiRealtimeAudio(int16ToBase64(chunk));
      this.consumeRealtimeEvents(events);
    } catch (error) {
      this.callbacks?.onProviderSnapshot({
        provider: 'openai_online',
        transcript: '',
        latencyMs: 0,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        updatedAtMs: Date.now(),
      });
    } finally {
      this.openAiBusy = false;
    }
  }

  private async pollOpenAi(): Promise<void> {
    if (!this.running || !this.needsOpenAi() || this.openAiBusy) {
      return;
    }

    this.openAiBusy = true;
    try {
      const events = await pollOpenAiRealtimeTranscription();
      this.consumeRealtimeEvents(events);
    } catch (error) {
      this.callbacks?.onProviderSnapshot({
        provider: 'openai_online',
        transcript: '',
        latencyMs: 0,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        updatedAtMs: Date.now(),
      });
    } finally {
      this.openAiBusy = false;
    }
  }

  private consumeRealtimeEvents(events: RealtimeTranscriptEvent[]): void {
    for (const event of events) {
      if (event.kind === 'status') {
        if (event.detail) {
          this.callbacks?.onStatus(`OpenAI realtime: ${event.detail}`);
        }
        continue;
      }

      if (event.kind === 'error') {
        this.callbacks?.onProviderSnapshot({
          provider: 'openai_online',
          transcript: '',
          latencyMs: event.latencyMs ?? 0,
          ok: false,
          detail: event.detail ?? 'Unknown realtime transcription error',
          updatedAtMs: Date.now(),
        });
        continue;
      }

      if (event.text.trim()) {
        this.callbacks?.onProviderSnapshot({
          provider: 'openai_online',
          transcript: event.text,
          latencyMs: event.latencyMs ?? 0,
          ok: true,
          detail: event.kind === 'delta' ? 'partial' : 'final',
          updatedAtMs: Date.now(),
        });
      }
    }
  }

  private async flushLocalWhisper(): Promise<void> {
    if (!this.running || !this.needsLocalWhisper() || this.localBusy || this.rollingPcmChunks.length === 0) {
      return;
    }

    this.localBusy = true;
    this.lastLocalFlushAtMs = Date.now();
    const chunk = mergeInt16Chunks(this.rollingPcmChunks);
    const wavBase64 = wavToBase64(chunk, 24_000);

    try {
      const result = await transcribeWavChunkLocal({
        audioBase64: wavBase64,
        language: this.config?.language,
        model: 'base',
      });
      this.callbacks?.onProviderSnapshot({
        provider: 'openai_whisper_local',
        transcript: result.transcript,
        latencyMs: result.latencyMs,
        ok: result.ok,
        detail: result.detail ?? result.audioPath,
        updatedAtMs: Date.now(),
      });
    } catch (error) {
      this.callbacks?.onProviderSnapshot({
        provider: 'openai_whisper_local',
        transcript: '',
        latencyMs: 0,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        updatedAtMs: Date.now(),
      });
    } finally {
      this.keepRollingOverlapMs(1_000);
      this.localBusy = false;
    }
  }

  private startWebSpeechRecognition(): void {
    const ctor = (
      window as unknown as {
        SpeechRecognition?: SpeechRecognitionCtor;
        webkitSpeechRecognition?: SpeechRecognitionCtor;
      }
    ).SpeechRecognition ?? (
      window as unknown as {
        webkitSpeechRecognition?: SpeechRecognitionCtor;
      }
    ).webkitSpeechRecognition;

    if (!ctor) {
      this.callbacks?.onProviderSnapshot({
        provider: 'webview2',
        transcript: '',
        latencyMs: 0,
        ok: false,
        detail: 'SpeechRecognition is not available in this WebView2 runtime.',
        updatedAtMs: Date.now(),
      });
      return;
    }

    const recognition = new ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = mapSpeechRecognitionLanguage(this.config?.language ?? 'de');
    recognition.onresult = (event) => {
      let transcript = '';
      let isFinal = false;
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        transcript += result[0]?.transcript ?? '';
        if (result.isFinal) {
          isFinal = true;
        }
      }

      this.callbacks?.onProviderSnapshot({
        provider: 'webview2',
        transcript: transcript.trim(),
        latencyMs: 0,
        ok: transcript.trim().length > 0,
        detail: isFinal ? 'final' : 'interim',
        updatedAtMs: Date.now(),
      });
    };
    recognition.onerror = (event) => {
      this.callbacks?.onProviderSnapshot({
        provider: 'webview2',
        transcript: '',
        latencyMs: 0,
        ok: false,
        detail: event.error ?? 'Unknown WebView2 speech recognition error',
        updatedAtMs: Date.now(),
      });
    };
    recognition.onend = () => {
      if (this.running) {
        try {
          recognition.start();
        } catch {
          // ignore restart race
        }
      }
    };

    this.speechRecognition = recognition;
    recognition.start();
  }

  private trimRollingChunksToMs(maxMs: number): void {
    if (!this.audioContext) {
      return;
    }

    const maxSamples = Math.floor((this.audioContext.sampleRate * maxMs) / 1000);
    while (countSamples(this.rollingPcmChunks) > maxSamples && this.rollingPcmChunks.length > 1) {
      this.rollingPcmChunks.shift();
    }
  }

  private keepRollingOverlapMs(overlapMs: number): void {
    if (!this.audioContext) {
      this.rollingPcmChunks = [];
      return;
    }

    const overlapSamples = Math.floor((this.audioContext.sampleRate * overlapMs) / 1000);
    const merged = mergeInt16Chunks(this.rollingPcmChunks);
    const kept = merged.length > overlapSamples ? merged.slice(merged.length - overlapSamples) : merged;
    this.rollingPcmChunks = kept.length ? [kept] : [];
  }
}

function floatTo16BitPcm(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] ?? 0));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

function mergeInt16Chunks(chunks: Int16Array[]): Int16Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Int16Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function countSamples(chunks: Int16Array[]): number {
  return chunks.reduce((sum, chunk) => sum + chunk.length, 0);
}

function int16ToBase64(pcm: Int16Array): string {
  return uint8ToBase64(new Uint8Array(pcm.buffer.slice(0)));
}

function wavToBase64(pcm: Int16Array, sampleRate: number): string {
  const bytesPerSample = 2;
  const dataSize = pcm.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let index = 0; index < pcm.length; index += 1) {
    view.setInt16(offset, pcm[index] ?? 0, true);
    offset += 2;
  }

  return `data:audio/wav;base64,${uint8ToBase64(new Uint8Array(buffer))}`;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary);
}

function mapSpeechRecognitionLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  switch (normalized) {
    case 'de':
      return 'de-DE';
    case 'en':
      return 'en-US';
    case 'fr':
      return 'fr-FR';
    case 'es':
      return 'es-ES';
    default:
      return normalized || 'de-DE';
  }
}
