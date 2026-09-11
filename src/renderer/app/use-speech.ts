import { useCallback, useEffect, useRef } from "react";

const hasText = (value: string) => value.length > 0;

export function useSpeech() {
  const generation = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string>("");
  const finish = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    generation.current += 1;
    audio.current?.pause();
    finish.current?.();
    if (hasText(url.current)) {
      URL.revokeObjectURL(url.current);
    }
    audio.current = null;
    finish.current = null;
    url.current = "";
  }, []);
  const speak = async (text: string, languageCode: string) => {
    stop();
    const request = generation.current;
    try {
      const bytes = await window.boloDesktop.speech(
        text.slice(0, 600),
        languageCode
      );
      if (request !== generation.current) {
        return;
      }
      url.current = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: "audio/wav" })
      );
      const playback = new Audio(url.current);
      audio.current = playback;
      await new Promise<void>((resolve, reject) => {
        finish.current = resolve;
        playback.addEventListener("ended", () => resolve(), { once: true });
        playback.addEventListener("error", reject, { once: true });
        playback.play().catch(reject);
      });
    } catch {
      // Spoken output is optional; the persisted transcript remains visible.
    } finally {
      if (request === generation.current) {
        stop();
      }
    }
  };
  useEffect(() => () => stop(), [stop]);
  return { speak, stop };
}
