import {
  startTimerSignalAlert as startTimerSignalAlertCommand,
  stopTimerSignalAlert as stopTimerSignalAlertCommand,
  type AppSettings,
} from './voiceOverlay';

export type TimerSignalTone = AppSettings['timerSignalTone'];

export async function startTimerSignalAlert(tone: TimerSignalTone): Promise<void> {
  await startTimerSignalAlertCommand(tone);
}

export async function stopTimerSignalAlert(): Promise<void> {
  await stopTimerSignalAlertCommand();
}
