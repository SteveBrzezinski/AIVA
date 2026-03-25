export type OrbState = 'idle' | 'working' | 'listening' | 'speaking' | 'success' | 'error';

type OrbWidgetProps = {
  orbState: OrbState;
  isVisible: boolean;
};

export function OrbWidget({ orbState, isVisible }: OrbWidgetProps) {
  if (!isVisible) return null;

  return (
    <div className="orb-wrapper">
      <div
        className={`orb orb--${orbState}`}
        aria-label="AI Assistent aktiv"
        role="img"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="orb-inner" />
      </div>
    </div>
  );
}
