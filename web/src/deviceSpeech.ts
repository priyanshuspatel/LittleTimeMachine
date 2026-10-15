export interface NarrationSession {
  pause: () => void;
  resume: () => void;
  stop: () => void;
  isActive: () => boolean;
  isPaused: () => boolean;
}

interface NarrationHandlers {
  onend: () => void;
  onerror: () => void;
}

/**
 * Speaks `text` from the first word through the last.
 * Chromium stops a long utterance after about fifteen seconds unless playback is
 * nudged; the interval does that without starting the sentence over.
 *
 * @param text - The complete quest or reflection. It is not truncated.
 * @param handlers - Called when the voice finishes or fails. Cancelled speech does not count as failure.
 */
export function speakEntireText(text: string, handlers: NarrationHandlers): NarrationSession {
  const synth = window.speechSynthesis;
  let keepAlive = 0;
  let generation = 0;
  let paused = false;
  let finished = false;

  function clearKeepAlive(): void {
    window.clearInterval(keepAlive);
    keepAlive = 0;
  }

  function start(): void {
    const mine = ++generation;
    clearKeepAlive();
    finished = false;
    paused = false;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.92;
    utterance.onend = () => {
      if (mine !== generation || finished) {
        return;
      }
      finished = true;
      paused = false;
      clearKeepAlive();
      handlers.onend();
    };
    utterance.onerror = (event) => {
      if (mine !== generation || event.error === "canceled" || event.error === "interrupted") {
        return;
      }
      finished = true;
      clearKeepAlive();
      handlers.onerror();
    };
    synth.speak(utterance);
    keepAlive = window.setInterval(() => {
      if (!synth.speaking || synth.paused || paused) {
        return;
      }
      synth.pause();
      synth.resume();
    }, 10_000);
  }

  start();

  return {
    pause() {
      if (finished || paused) {
        return;
      }
      paused = true;
      synth.pause();
    },
    resume() {
      if (finished) {
        start();
        return;
      }
      paused = false;
      synth.resume();
    },
    stop() {
      generation += 1;
      finished = true;
      paused = false;
      clearKeepAlive();
      synth.cancel();
    },
    isActive() {
      return synth.speaking && !synth.paused && !paused && !finished;
    },
    isPaused() {
      return paused && !finished;
    },
  };
}
