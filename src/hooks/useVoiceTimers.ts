import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  createVoiceTimer,
  deleteVoiceTimer,
  listVoiceTimers,
  onVoiceTimerEvent,
  pauseVoiceTimer,
  resumeVoiceTimer,
  updateVoiceTimer,
  type CreateVoiceTimerRequest,
  type UpdateVoiceTimerRequest,
  type VoiceTimer,
  type VoiceTimerEvent,
} from '../lib/voiceOverlay';

function sortTimers(timers: VoiceTimer[]): VoiceTimer[] {
  return [...timers].sort((left, right) => {
    const leftRank = left.status === 'running' ? 0 : left.status === 'paused' ? 1 : 2;
    const rightRank = right.status === 'running' ? 0 : right.status === 'paused' ? 1 : 2;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    if (left.status === 'running' && right.status === 'running') {
      return (left.endAtMs ?? left.updatedAtMs) - (right.endAtMs ?? right.updatedAtMs);
    }
    return right.updatedAtMs - left.updatedAtMs;
  });
}

export function getVoiceTimerRemainingMs(timer: VoiceTimer, nowMs = Date.now()): number {
  if (timer.status !== 'running') {
    return timer.remainingMs;
  }
  return Math.max(0, (timer.endAtMs ?? timer.updatedAtMs) - nowMs);
}

export function formatVoiceTimerDuration(durationMs: number): string {
  const totalSeconds = Math.max(1, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours} h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} min`);
  }
  if (seconds > 0 && hours === 0) {
    parts.push(`${seconds} sec`);
  }

  return parts[0] ? parts.join(' ') : '1 sec';
}

export function formatVoiceTimerRemaining(timer: VoiceTimer, nowMs = Date.now()): string {
  const remainingMs = getVoiceTimerRemainingMs(timer, nowMs);
  if (remainingMs <= 0) {
    return 'Done';
  }
  return formatVoiceTimerDuration(remainingMs);
}

export function useVoiceTimers(options?: {
  onEvent?: (event: VoiceTimerEvent) => void;
}): {
  timers: VoiceTimer[];
  nowMs: number;
  isLoaded: boolean;
  error: string | null;
  createTimer: (request: CreateVoiceTimerRequest) => Promise<VoiceTimer>;
  updateTimer: (request: UpdateVoiceTimerRequest) => Promise<VoiceTimer>;
  pauseTimer: (timerId: string) => Promise<VoiceTimer>;
  resumeTimer: (timerId: string) => Promise<VoiceTimer>;
  deleteTimer: (timerId: string) => Promise<VoiceTimer>;
} {
  const onEvent = options?.onEvent;
  const [timers, setTimers] = useState<VoiceTimer[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void | Promise<void>) | undefined;

    void listVoiceTimers()
      .then((items) => {
        if (!active) {
          return;
        }
        setTimers(sortTimers(items));
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!active) {
          return;
        }
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) {
          setIsLoaded(true);
        }
      });

    void onVoiceTimerEvent((event) => {
      onEvent?.(event);
      setTimers((current) => {
        if (event.kind === 'deleted') {
          return sortTimers(current.filter((timer) => timer.id !== event.timer.id));
        }

        const next = current.filter((timer) => timer.id !== event.timer.id);
        next.push(event.timer);
        return sortTimers(next);
      });
    }).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => {
      active = false;
      void unlisten?.();
    };
  }, [onEvent]);

  const createTimerAction = useCallback(async (request: CreateVoiceTimerRequest): Promise<VoiceTimer> => {
    const timer = await createVoiceTimer(request);
    setError(null);
    return timer;
  }, []);

  const updateTimerAction = useCallback(async (request: UpdateVoiceTimerRequest): Promise<VoiceTimer> => {
    const timer = await updateVoiceTimer(request);
    setError(null);
    return timer;
  }, []);

  const pauseTimerAction = useCallback(async (timerId: string): Promise<VoiceTimer> => {
    const timer = await pauseVoiceTimer(timerId);
    setError(null);
    return timer;
  }, []);

  const resumeTimerAction = useCallback(async (timerId: string): Promise<VoiceTimer> => {
    const timer = await resumeVoiceTimer(timerId);
    setError(null);
    return timer;
  }, []);

  const deleteTimerAction = useCallback(async (timerId: string): Promise<VoiceTimer> => {
    const timer = await deleteVoiceTimer(timerId);
    setError(null);
    return timer;
  }, []);

  return useMemo(
    () => ({
      timers,
      nowMs,
      isLoaded,
      error,
      createTimer: createTimerAction,
      updateTimer: updateTimerAction,
      pauseTimer: pauseTimerAction,
      resumeTimer: resumeTimerAction,
      deleteTimer: deleteTimerAction,
    }),
    [
      createTimerAction,
      deleteTimerAction,
      error,
      isLoaded,
      nowMs,
      pauseTimerAction,
      resumeTimerAction,
      timers,
      updateTimerAction,
    ],
  );
}
