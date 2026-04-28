import { useCallback, useEffect, useRef } from 'react';

import {
  emitDictationNotification,
  insertDictationText,
  onDictationHotkey,
  reportDictationError,
  reportDictationTranscribing,
  transcribeChatAudio,
  type AppSettings,
  type DictationNotificationRequest,
  type DictationHotkeyEvent,
} from '../lib/voiceOverlay';
import i18n from '../i18n';

type RecordingPhase = 'idle' | 'recording' | 'transcribing';

type ActiveRecording = {
  mode: DictationHotkeyEvent['mode'];
  mimeType: string;
};

function chooseRecordingMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }

  return 'audio/webm';
}

function buildRecordingFileName(mimeType: string): string {
  if (mimeType.includes('mp4')) {
    return 'dictation-recording.mp4';
  }

  return 'dictation-recording.webm';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(new Error('The dictation recording could not be read.'));
    };
    reader.onloadend = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('The dictation recording could not be converted to Base64.'));
        return;
      }

      const separatorIndex = reader.result.indexOf(',');
      resolve(separatorIndex >= 0 ? reader.result.slice(separatorIndex + 1) : reader.result);
    };
    reader.readAsDataURL(blob);
  });
}

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function usePushToDictation(options: {
  settings: AppSettings;
  initialStateLoaded: boolean;
}): void {
  const { settings, initialStateLoaded } = options;
  const settingsRef = useRef(settings);
  const phaseRef = useRef<RecordingPhase>('idle');
  const activeRecordingRef = useRef<ActiveRecording | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const stopRecorderAndCollectBlob = useCallback(
    (recorder: MediaRecorder, mimeType: string): Promise<Blob> =>
      new Promise((resolve, reject) => {
        recorder.onerror = () => {
          reject(new Error('The dictation recording could not be stopped.'));
        };
        recorder.onstop = () => {
          resolve(
            new Blob(recordedChunksRef.current, {
              type: mimeType,
            }),
          );
        };
        recorder.stop();
      }),
    [],
  );

  const stopRecordingResources = useCallback((): void => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      recorder.stop();
    }

    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
    }

    mediaRecorderRef.current = null;
    mediaStreamRef.current = null;
    recordedChunksRef.current = [];
    activeRecordingRef.current = null;
  }, []);

  const emitStatusNotification = useCallback((request: DictationNotificationRequest): void => {
    if (!settingsRef.current.dictationStatusNotifications) {
      return;
    }

    void emitDictationNotification(request).catch(() => undefined);
  }, []);

  const emitErrorNotification = useCallback((
    mode: DictationHotkeyEvent['mode'],
    detail: string,
  ): void => {
    emitStatusNotification({
      kind: 'error',
      mode,
      title: i18n.t('dictationNotifications.errorTitle'),
      detail,
    });
  }, [emitStatusNotification]);

  const startRecording = useCallback(async (mode: DictationHotkeyEvent['mode']): Promise<void> => {
    if (phaseRef.current !== 'idle') {
      const detail = 'A dictation recording is already active.';
      emitErrorNotification(mode, detail);
      await reportDictationError(mode, detail);
      return;
    }

    if (typeof MediaRecorder === 'undefined') {
      const detail = 'MediaRecorder is not available in this WebView2 runtime.';
      emitErrorNotification(mode, detail);
      await reportDictationError(mode, detail);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      const detail = 'Microphone capture is not available in this WebView2 runtime.';
      emitErrorNotification(mode, detail);
      await reportDictationError(mode, detail);
      return;
    }

    emitStatusNotification({
      kind: 'listening',
      mode,
      title: i18n.t('dictationNotifications.listeningTitle'),
      detail: i18n.t('dictationNotifications.listeningDetail'),
    });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const mimeType = chooseRecordingMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      recordedChunksRef.current = [];
      activeRecordingRef.current = { mode, mimeType };
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      phaseRef.current = 'recording';

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };
      recorder.start(200);
    } catch (error: unknown) {
      const detail = detailFromError(error);
      phaseRef.current = 'idle';
      stopRecordingResources();
      emitErrorNotification(mode, detail);
      await reportDictationError(mode, detail);
    }
  }, [emitErrorNotification, emitStatusNotification, stopRecordingResources]);

  const finishRecording = useCallback(async (mode: DictationHotkeyEvent['mode']): Promise<void> => {
    const activeRecording = activeRecordingRef.current;
    const recorder = mediaRecorderRef.current;
    if (phaseRef.current !== 'recording' || !activeRecording || !recorder) {
      return;
    }

    phaseRef.current = 'transcribing';
    await reportDictationTranscribing(activeRecording.mode);
    emitStatusNotification({
      kind: 'transcribing',
      mode: activeRecording.mode,
      title: i18n.t('dictationNotifications.transcribingTitle'),
      detail: i18n.t('dictationNotifications.transcribingDetail'),
    });

    try {
      const blob = await stopRecorderAndCollectBlob(recorder, activeRecording.mimeType);
      stopRecordingResources();

      if (blob.size === 0) {
        throw new Error('The dictation recording did not contain audio.');
      }

      const transcriptionMimeType =
        (blob.type || activeRecording.mimeType).split(';')[0] || 'audio/webm';
      const transcript = await transcribeChatAudio({
        audioBase64: await blobToBase64(blob),
        mimeType: transcriptionMimeType,
        fileName: buildRecordingFileName(transcriptionMimeType),
        language: settingsRef.current.sttLanguage,
      });

      const result = await insertDictationText(transcript.text, activeRecording.mode);
      emitStatusNotification({
        kind: result.pasted ? 'pasted' : 'clipboard',
        mode: result.mode,
        title: i18n.t(
          result.pasted
            ? 'dictationNotifications.pastedTitle'
            : 'dictationNotifications.clipboardTitle',
        ),
        detail: i18n.t(
          result.pasted
            ? 'dictationNotifications.pastedDetail'
            : 'dictationNotifications.clipboardDetail',
        ),
      });
      phaseRef.current = 'idle';
    } catch (error: unknown) {
      const detail = detailFromError(error);
      stopRecordingResources();
      phaseRef.current = 'idle';
      emitErrorNotification(mode, detail);
      await reportDictationError(mode, detail);
    }
  }, [
    emitErrorNotification,
    emitStatusNotification,
    stopRecorderAndCollectBlob,
    stopRecordingResources,
  ]);

  useEffect(() => {
    if (!initialStateLoaded) {
      return undefined;
    }

    let unlisten: (() => void | Promise<void>) | undefined;

    void onDictationHotkey((event) => {
      if (event.action === 'start') {
        void startRecording(event.mode);
        return;
      }

      void finishRecording(event.mode);
    }).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => {
      stopRecordingResources();
      void unlisten?.();
    };
  }, [finishRecording, initialStateLoaded, startRecording, stopRecordingResources]);
}
