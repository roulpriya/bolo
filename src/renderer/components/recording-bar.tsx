import type { Recording } from "../types";

export function RecordingBar({
  recording,
  onCancel,
}: {
  recording: Recording | null;
  onCancel: () => void;
}) {
  if (!recording) {
    return null;
  }
  return (
    <section className="recording-bar">
      <span className="recording-pulse" />
      <strong>{recording.label}</strong>
      <span>
        {Math.floor(recording.seconds / 60)}:
        {String(recording.seconds % 60).padStart(2, "0")}
      </span>
      <button className="quiet-button" onClick={onCancel} type="button">
        Cancel
      </button>
    </section>
  );
}
