import { useEffect, useRef, useState } from "react";
import {
  checkBackendHealth,
  generateQuest,
  processMemory,
  sameOriginMedia,
  type MemoryCard,
} from "./api";

type Screen = "home" | "walk" | "camera" | "reflect" | "saving" | "book";

interface WalkMemory extends MemoryCard {
  id: string;
  locationLabel: string | null;
  voiceUrl: string | null;
  title?: string;
}

const STORAGE_KEY = "memoryquest.walks";

function loadWalks(): WalkMemory[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WalkMemory[];
    return parsed.map((entry) => ({ ...entry, voiceUrl: null }));
  } catch {
    return [];
  }
}

function persistWalks(walks: WalkMemory[]): void {
  const stored = walks.map((entry) => ({ ...entry, voiceUrl: null }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

function locate(): Promise<string | null> {
  if (!navigator.geolocation) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        resolve(`${latitude.toFixed(3)}°N, ${longitude.toFixed(3)}°W`);
      },
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 60_000 },
    );
  });
}

function formatTime(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [error, setError] = useState<string | null>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [demoMode, setDemoMode] = useState<boolean>(false);

  // Quest state
  const [questText, setQuestText] = useState("");
  const [questAudio, setQuestAudio] = useState("");
  const [locationHint, setLocationHint] = useState("");
  const [locationLabel, setLocationLabel] = useState<string | null>(null);

  // Photo & Reflection state
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [walks, setWalks] = useState<WalkMemory[]>(() => loadWalks());

  useEffect(() => {
    let active = true;
    checkBackendHealth().then((isOnline) => {
      if (active) {
        setBackendOnline(isOnline);
        if (!isOnline) {
          setDemoMode(true);
        }
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  function remember(entry: WalkMemory): void {
    setWalks((current) => {
      const next = [entry, ...current];
      persistWalks(next);
      return next;
    });
  }

  function removeWalk(id: string): void {
    setWalks((current) => {
      const next = current.filter((item) => item.id !== id);
      persistWalks(next);
      return next;
    });
  }

  async function startWalk(): Promise<void> {
    setError(null);
    setScreen("saving");
    try {
      const previousMemories = walks.slice(0, 3).map((w) => w.experienceText);
      const quest = await generateQuest({
        userLocation: locationHint.trim() || undefined,
        previousMemories,
        forceDemo: demoMode || !backendOnline,
      });
      setQuestText(quest.questText);
      setQuestAudio(quest.audioUrl ? sameOriginMedia(quest.audioUrl) : "");
      setScreen("walk");
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "Could not open today's chapter";
      setError(
        backendOnline === false
          ? `${msg} (AI library server offline — toggle Demo Mode to explore!)`
          : msg,
      );
      setScreen("home");
    }
  }

  function arrive(): void {
    setError(null);
    void locate().then((loc) => {
      if (loc) setLocationLabel(loc);
    });
    setScreen("camera");
  }

  function handlePhotoCaptured(file: File): void {
    setPhoto(file);
    setScreen("reflect");
  }

  async function finishReflection(experienceText: string, voice: Blob | null): Promise<void> {
    if (!photo) {
      setError("Please capture a keepsake photograph first.");
      setScreen("camera");
      return;
    }
    setError(null);
    setScreen("saving");
    try {
      const card = await processMemory({
        photo,
        questText,
        experienceText,
        forceDemo: demoMode || !backendOnline,
      });
      remember({
        ...card,
        photoUrl: sameOriginMedia(card.photoUrl),
        reflectionAudioUrl: card.reflectionAudioUrl ? sameOriginMedia(card.reflectionAudioUrl) : "",
        id: card.timestamp || new Date().toISOString(),
        locationLabel: locationLabel || locationHint || "Secret Spot",
        title: locationHint.trim() || "A kept thing",
        voiceUrl: voice ? URL.createObjectURL(voice) : null,
      });
      setPhoto(null);
      setScreen("book");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not bind the memory into the archive");
      setScreen("reflect");
    }
  }

  return (
    <div className="min-h-screen bg-bookshelf flex flex-col justify-between text-[#f7eed9] font-serif selection:bg-[#c59d53]/30 selection:text-[#faedd4]">
      {/* Antique Library Bookshelf Header */}
      <header className="sticky top-0 z-30 w-full border-b border-[#3e271a] bg-[#1a110a]/95 backdrop-blur-md px-4 py-3 shadow-lg shadow-black/60">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setScreen("home");
            }}
            className="group flex items-center gap-3 text-left"
          >
            {/* Vintage Book Logo Icon */}
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2c1a10] border border-[#5d3b25] text-[#d4af37] shadow-inner group-hover:border-[#c59d53] transition">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </span>
            <div>
              <p className="font-display text-xs font-bold tracking-[0.18em] text-[#d4af37] uppercase">
                Little Time Machine
              </p>
              <p className="text-[11px] font-sans font-medium text-[#c8b79b] tracking-wide">
                The Memory Bookshelf
              </p>
            </div>
          </button>

          {/* Library Catalog Plaque / Mode Switch */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDemoMode((prev) => !prev)}
              aria-label="Toggle demo archive"
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-sans font-semibold border transition shadow-sm ${
                demoMode
                  ? "bg-[#332014] text-[#e5be79] border-[#6b472e] hover:bg-[#3d2618]"
                  : backendOnline
                    ? "bg-[#1f2d22] text-[#86efac] border-[#2d5538] hover:bg-[#25392a]"
                    : "bg-[#3b1915] text-[#fca5a5] border-[#6b2c25] hover:bg-[#471f1a]"
              }`}
              title={
                demoMode
                  ? "Browsing offline demo records. Click to try live AI."
                  : backendOnline
                    ? "Connected to local Gemma & ElevenLabs archives."
                    : "Library server offline. Running in Demo Mode."
              }
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  demoMode ? "bg-[#d4af37]" : backendOnline ? "bg-[#4ade80] animate-pulse" : "bg-[#f87171]"
                }`}
              />
              <span className="tracking-wide">{demoMode ? "Demo Shelf" : backendOnline ? "Live Ledger" : "Offline"}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Reading Stage */}
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 py-6">
        {screen === "home" && (
          <HomeScreen
            error={error}
            locationHint={locationHint}
            setLocationHint={setLocationHint}
            onStart={() => void startWalk()}
            onBook={() => setScreen("book")}
            walksCount={walks.length}
            isBackendOnline={Boolean(backendOnline)}
            demoMode={demoMode}
          />
        )}

        {screen === "walk" && (
          <WalkScreen
            questText={questText}
            audioUrl={questAudio}
            onArrive={arrive}
            onCancel={() => setScreen("home")}
          />
        )}

        {screen === "camera" && (
          <CameraScreen
            error={error}
            locationLabel={locationLabel}
            onPhoto={handlePhotoCaptured}
            onError={setError}
            onBack={() => setScreen("walk")}
          />
        )}

        {screen === "reflect" && photo && (
          <ReflectScreen
            error={error}
            photoPreview={photoPreview}
            onRetake={() => setScreen("camera")}
            onFinish={(text, voice) => void finishReflection(text, voice)}
          />
        )}

        {screen === "saving" && (
          <SavingScreen
            label={photo ? "Inscribing into the Ledger..." : "Unfolding the Map..."}
            subLabel={
              photo
                ? "Drying the ink on your memory with Gemma, pressing speech with ElevenLabs, and preserving in MongoDB Atlas."
                : "Consulting the local open-weight archive to craft today's outdoor nostalgic quest."
            }
          />
        )}

        {screen === "book" && (
          <BookScreen
            walks={walks}
            onNewWalk={() => {
              setError(null);
              setScreen("home");
            }}
            onDeleteWalk={removeWalk}
          />
        )}
      </main>

      {/* Bookshelf Footledge */}
      <footer className="w-full border-t border-[#3a2519] bg-[#160f0a]/95 py-3.5 px-4 text-center font-sans text-xs text-[#b8a287]">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <p className="flex items-center gap-1.5 font-medium">
            <span className="text-[#d4af37]">❦</span>
            <span>Little Time Machine · Touch Grass Archive</span>
          </p>
          <div className="flex items-center gap-2 text-[#9a846c] text-[11px]">
            <span>Gemma 2</span>
            <span>·</span>
            <span>ElevenLabs</span>
            <span>·</span>
            <span>Atlas</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* =========================================================================
   SCREEN 1: HOME (THE READING ROOM)
   ========================================================================= */

function HomeScreen({
  error,
  locationHint,
  setLocationHint,
  onStart,
  onBook,
  walksCount,
  isBackendOnline,
  demoMode,
}: {
  error: string | null;
  locationHint: string;
  setLocationHint: (val: string) => void;
  onStart: () => void;
  onBook: () => void;
  walksCount: number;
  isBackendOnline: boolean;
  demoMode: boolean;
}) {
  const NOSTALGIC_HAUNTS = [
    "The Secret Backyard Tree",
    "The Creek of Skipping Stones",
    "The Mossy Stone Wall",
    "Under the Old Porch Light",
    "The Dirt Path by the Tracks",
  ];

  return (
    <section className="flex flex-1 flex-col justify-between gap-8 py-2">
      {/* Nostalgic Book Title & Introduction */}
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-5xl sm:text-6xl font-bold tracking-tight text-[#faedd4] leading-[1.12]">
          Step outside. <br />
          <span className="font-script text-[#e5be79] font-normal [word-spacing:0.28em]">
            The <span className="text-[1.22em] text-[#fff6dc]">screen</span> can wait.
          </span>
        </h1>

        <p className="text-lg font-bold leading-relaxed text-[#dfd0b5] font-serif">
          Remember when an afternoon meant exploring until the streetlights came on? Pocket your phone, let the local AI summon an outdoor secret, and capture a keepsake for the archive.
        </p>
      </div>

      {/* Library Catalog Drawer Card */}
      <div className="relative rounded-2xl border-[3px] border-[#c4a46a] bg-parchment p-6 shadow-2xl">
        {/* Ribbon Bookmark Deco */}
        <div className="absolute -top-3 right-6 h-8 w-6 bg-[#9e3325] ribbon-tab shadow-md" />

        <div className="flex items-center justify-between pb-3 border-b border-[#d8c5a2] mb-4">
          <span className="font-display text-lg font-bold tracking-[0.08em] text-[#3d2719] uppercase sm:text-xl">
            Card Catalog Index
          </span>
          <span className="text-xs font-sans text-[#7a5b43] font-medium">Shelf #1994</span>
        </div>

        <label htmlFor="library-location-hint" className="block text-sm font-semibold text-[#29170d] mb-2 font-sans">
          Where would you like to wander today?
        </label>

        <input
          id="library-location-hint"
          type="text"
          value={locationHint}
          onChange={(e) => setLocationHint(e.target.value)}
          placeholder="e.g. The shady bench by the elm where I used to read..."
          className="w-full rounded-xl border border-[#bfa885] bg-[#fffcf5] px-4 py-3 text-sm text-[#23140c] font-sans placeholder:text-[#8c745d] focus:border-[#8c4922] focus:outline-none focus:ring-1 focus:ring-[#8c4922] transition shadow-inner"
        />

        {/* Nostalgic childhood place chips */}
        <div className="flex flex-wrap gap-2 pt-3">
          {NOSTALGIC_HAUNTS.map((haunt) => (
            <button
              key={haunt}
              type="button"
              onClick={() => setLocationHint(haunt)}
              className={`rounded-lg px-2.5 py-1 text-xs font-sans transition ${
                locationHint === haunt
                  ? "bg-[#29170e] text-[#fbf5e8] font-bold shadow-sm"
                  : "bg-[#ebdcc0] text-[#422919] font-medium border border-[#cbaf8b] hover:bg-[#e2ceae]"
              }`}
            >
              ✦ {haunt}
            </button>
          ))}
        </div>
      </div>

      {/* Primary Actions */}
      <div className="flex flex-col gap-3.5">
        {error && (
          <div className="rounded-xl border-2 border-[#822a1f] bg-[#2a1310] p-4 text-sm text-[#fca5a5] flex items-start gap-3 shadow-lg">
            <span className="text-lg">⚠</span>
            <div className="flex-1 font-sans">
              <p className="font-bold text-[#fecaca]">Notice from the Archivist</p>
              <p className="text-xs text-[#fca5a5] mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Main Leather-bound Action Button */}
        <button
          type="button"
          onClick={onStart}
          className="group relative flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-b from-[#d4af37] via-[#c59d53] to-[#ad863c] px-6 py-4 font-display text-base sm:text-lg font-bold text-[#1c1109] shadow-2xl shadow-black/80 hover:brightness-110 active:scale-[0.99] transition border border-[#fed67d]"
        >
          <span>Open Today's Chapter (Start Walk)</span>
          <span className="text-xl transition-transform group-hover:translate-x-1">➔</span>
        </button>

        {walksCount > 0 ? (
          <button
            type="button"
            onClick={onBook}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-[#523624] bg-[#22150d] px-6 py-3.5 text-sm sm:text-base font-serif font-bold text-[#ecdcc4] hover:bg-[#2c1c11] hover:border-[#6f4b32] transition shadow-md"
          >
            <span>📖</span>
            <span>Open the Memory Ledger</span>
            <span className="ml-1 rounded-full bg-[#3d2516] px-2.5 py-0.5 text-xs font-sans font-bold text-[#d4af37] border border-[#6b472e]">
              {walksCount} {walksCount === 1 ? "entry" : "entries"}
            </span>
          </button>
        ) : (
          <p className="text-center text-xs font-sans text-[#b8a287]">
            {!isBackendOnline && !demoMode
              ? "Tip: Click 'Offline' in top-right to browse the Demo Library."
              : "Completed walks will be bound into your personal leather ledger."}
          </p>
        )}
      </div>
    </section>
  );
}

/* =========================================================================
   SCREEN 2: WALK (CHAPTER I: THE CALL TO WANDER)
   ========================================================================= */

function WalkScreen({
  questText,
  audioUrl,
  onArrive,
  onCancel,
}: {
  questText: string;
  audioUrl: string;
  onArrive: () => void;
  onCancel: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [outdoorSeconds, setOutdoorSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setOutdoorSeconds((sec) => sec + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, [audioUrl]);

  function togglePlay(): void {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      audio.pause();
      setPlaying(false);
    }
  }

  return (
    <section className="flex flex-1 flex-col justify-between gap-6 py-2">
      {/* Chapter header */}
      <div className="flex items-center justify-between border-b border-[#3e271a] pb-3">
        <div className="flex items-center gap-2 text-xs font-display font-semibold tracking-wider text-[#d4af37]">
          <span>Chapter I</span>
          <span className="text-[#6d4b35]">✦</span>
          <span>The Call to Wander</span>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-2.5 py-1 text-xs font-sans text-[#cbb89d] hover:text-[#faedd4] hover:bg-[#2b1b11] transition"
        >
          Return to Library
        </button>
      </div>

      {/* Aged Parchment Book Page Card */}
      <div className="bg-parchment rounded-2xl p-6 sm:p-8 shadow-2xl border-2 border-[#cfbc97] relative overflow-hidden">
        {/* Library Stamp */}
        <div className="absolute top-4 right-4 stamp-border rounded-lg px-2.5 py-0.5 text-[10px] font-sans font-bold tracking-widest uppercase rotate-[-6deg]">
          EX LIBRIS · FIELD GUIDE
        </div>

        <div className="mb-4">
          <span className="text-xs font-sans font-bold uppercase tracking-wider text-[#7a5b43]">
            Quest Inscription · Local Gemma 2
          </span>
        </div>

        {/* Quest text styled like a classic novel */}
        <p className="font-serif text-2xl sm:text-3xl leading-relaxed text-[#1f130b] italic font-medium">
          "{questText}"
        </p>

        <div className="mt-6 pt-4 border-t border-[#d8c5a2] flex items-center gap-2 text-xs font-sans text-[#5a3f2c]">
          <span className="text-[#9e3325] text-base">✦</span>
          <span>Close your eyes, memorize this passage, and put the phone into your pocket.</span>
        </div>
      </div>

      {/* Phonograph Style Audio Narration Player */}
      <div className="bg-leather rounded-2xl p-5 flex flex-col gap-4 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? "Pause phonograph narration" : "Play phonograph narration"}
              className="flex h-13 w-13 items-center justify-center rounded-full bg-gradient-to-b from-[#d4af37] to-[#9e7a2b] text-[#1c1109] font-bold shadow-lg shadow-black/60 hover:brightness-110 active:scale-95 transition border border-[#fed67d]"
            >
              {playing ? (
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              ) : (
                <svg className="h-5 w-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
            <div>
              <p className="font-serif text-base font-bold text-[#faedd4]">
                {playing ? "Listening to Narration..." : "Spoken Narration"}
              </p>
              <p className="text-xs font-sans text-[#c8b79b]">Spoken through ElevenLabs Audio</p>
            </div>
          </div>

          {/* Soundwave Bars in warm brass */}
          <div className="flex items-end gap-1.5 h-8">
            {[0, 1, 2, 3, 4, 5].map((bar) => (
              <span
                key={bar}
                className={`w-1.5 rounded-full bg-[#d4af37] transition-all duration-300 ${
                  playing ? "animate-pulse" : "opacity-40"
                }`}
                style={{
                  height: playing ? `${10 + ((bar * 21) % 22)}px` : "5px",
                  animationDelay: `${bar * 130}ms`,
                }}
              />
            ))}
          </div>
        </div>

        {audioUrl && (
          <audio
            ref={audioRef}
            src={audioUrl}
            preload="auto"
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onEnded={() => setPlaying(false)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        )}

        {duration > 0 && (
          <div className="flex items-center gap-3 text-xs font-sans text-[#b8a287]">
            <span>{formatTime(Math.floor(currentTime))}</span>
            <div className="relative flex-1 h-1.5 rounded-full bg-[#180e08] overflow-hidden border border-[#442c1d]">
              <div
                className="h-full bg-gradient-to-r from-[#ad863c] to-[#d4af37] rounded-full transition-all"
                style={{ width: `${(currentTime / duration) * 100}%` }}
              />
            </div>
            <span>{formatTime(Math.floor(duration))}</span>
          </div>
        )}
      </div>

      {/* Disconnection Pocket-Watch Timer */}
      <div className="flex items-center justify-between rounded-xl bg-[#20140c] border border-[#422a1b] px-4 py-3 text-xs font-sans text-[#dfd0b5]">
        <span className="flex items-center gap-2">
          <span className="text-[#d4af37] text-sm">⌛</span>
          <span>Time spent in the living world:</span>
        </span>
        <span className="font-mono font-bold text-[#e5be79] text-sm">
          {formatTime(outdoorSeconds)}
        </span>
      </div>

      {/* Arrival CTA */}
      <button
        type="button"
        onClick={onArrive}
        className="flex w-full items-center justify-center gap-3 rounded-2xl bg-parchment px-6 py-4 font-display text-base sm:text-lg font-bold text-[#1f130b] hover:bg-[#fff9ec] active:scale-[0.99] shadow-2xl shadow-black/80 border-2 border-[#cfbc97] transition"
      >
        <span>I Have Found the Spot</span>
        <span className="text-xl">📷</span>
      </button>
    </section>
  );
}

/* =========================================================================
   SCREEN 3: CAMERA (CHAPTER II: THE KEEPSAKE LENS)
   ========================================================================= */

function CameraScreen({
  error,
  locationLabel,
  onPhoto,
  onError,
  onBack,
}: {
  error: string | null;
  locationLabel: string | null;
  onPhoto: (file: File) => void;
  onError: (message: string) => void;
  onBack: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [streamActive, setStreamActive] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");

  useEffect(() => {
    let currentStream: MediaStream | undefined;
    let isCancelled = false;

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: facingMode } }, audio: false })
      .then((stream) => {
        if (isCancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        currentStream = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.play().then(() => setStreamActive(true)).catch(() => setStreamActive(false));
        }
      })
      .catch(() => {
        setStreamActive(false);
        onError("Camera viewfinder inactive. You can select a photo from your field album below.");
      });

    return () => {
      isCancelled = true;
      currentStream?.getTracks().forEach((track) => track.stop());
    };
  }, [facingMode, onError]);

  function switchCamera(): void {
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
  }

  async function takePhoto(): Promise<void> {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      fileRef.current?.click();
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    if (!blob) return;

    onPhoto(new File([blob], `keepsake-${Date.now()}.jpg`, { type: "image/jpeg" }));
  }

  return (
    <section className="flex flex-1 flex-col justify-between gap-4 py-2">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#3e271a] pb-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-sans text-[#cbb89d] hover:text-[#faedd4] hover:bg-[#2b1b11] transition"
        >
          <span>←</span> Back to Quest
        </button>

        <div className="flex items-center gap-2 text-xs font-display font-semibold tracking-wider text-[#d4af37]">
          <span>Chapter II</span>
          <span className="text-[#6d4b35]">✦</span>
          <span>The Keepsake Lens</span>
        </div>
      </div>

      {/* Viewfinder Framed Like an Antique Bellows Camera */}
      <div className="relative flex-1 min-h-[360px] sm:min-h-[420px] rounded-3xl overflow-hidden border-4 border-[#4a3120] bg-black flex items-center justify-center shadow-2xl">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`h-full w-full object-cover ${streamActive ? "opacity-100" : "opacity-0"}`}
        />

        {/* Vintage Brass Corner Reticle */}
        <div className="pointer-events-none absolute inset-6 rounded-2xl border border-[#d4af37]/30 flex flex-col justify-between p-4">
          <div className="flex justify-between">
            <span className="h-5 w-5 border-t-2 border-l-2 border-[#d4af37]" />
            <span className="h-5 w-5 border-t-2 border-r-2 border-[#d4af37]" />
          </div>
          <div className="flex justify-between">
            <span className="h-5 w-5 border-b-2 border-l-2 border-[#d4af37]" />
            <span className="h-5 w-5 border-b-2 border-r-2 border-[#d4af37]" />
          </div>
        </div>

        {/* Fallback if Camera Permission is Inactive */}
        {!streamActive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center bg-[#18100a]">
            <div className="h-16 w-16 rounded-full bg-[#2c1a10] border border-[#5d3b25] flex items-center justify-center text-3xl">
              📷
            </div>
            <p className="font-serif text-lg font-bold text-[#faedd4]">Viewfinder Resting</p>
            <p className="text-xs font-sans text-[#c8b79b] max-w-xs leading-relaxed">
              Snap photos with your favorite camera or pick an outdoor keepsake from your phone's gallery.
            </p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="mt-2 rounded-xl bg-gradient-to-b from-[#d4af37] to-[#ad863c] px-5 py-2.5 text-xs font-sans font-bold text-[#1f130b] hover:brightness-110 shadow-md transition"
            >
              Choose from Gallery Album
            </button>
          </div>
        )}

        {/* Location tag badge */}
        {locationLabel && (
          <div className="absolute top-4 left-4 rounded-full bg-[#18100a]/80 backdrop-blur-md px-3 py-1 text-xs font-sans font-medium text-[#e5be79] border border-[#d4af37]/40 flex items-center gap-1.5 shadow-md">
            <span>📍</span>
            <span>{locationLabel}</span>
          </div>
        )}

        {/* Camera switch toggle */}
        {streamActive && (
          <button
            type="button"
            onClick={switchCamera}
            aria-label="Flip camera"
            className="absolute top-4 right-4 h-10 w-10 rounded-full bg-[#18100a]/80 backdrop-blur-md border border-[#d4af37]/40 text-[#fbf5e8] flex items-center justify-center hover:bg-[#251810] transition"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        )}
      </div>

      {/* Shutter & File Upload Controls */}
      <div className="flex flex-col items-center gap-3">
        {error && <p className="text-center text-xs font-sans text-[#fca5a5]">{error}</p>}

        <div className="flex w-full items-center justify-around px-4 pt-1">
          {/* Gallery Button */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex flex-col items-center gap-1 text-[#dfd0b5] hover:text-[#faedd4] transition"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#281810] border border-[#523522] shadow-md">
              <span className="text-lg">📁</span>
            </span>
            <span className="text-[11px] font-sans font-medium">Field Album</span>
          </button>

          {/* Mechanical Shutter Button */}
          <button
            type="button"
            onClick={() => void takePhoto()}
            aria-label="Capture keepsake"
            className="group flex h-20 w-20 items-center justify-center rounded-full border-4 border-[#d4af37] bg-[#2a1b12] hover:bg-[#382418] active:scale-95 transition shadow-2xl"
          >
            <span className="h-15 w-15 rounded-full bg-gradient-to-b from-[#faedd4] to-[#c8b79b] group-hover:scale-95 group-active:scale-90 transition shadow-inner" />
          </button>

          <div className="w-12" />
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              onPhoto(file);
            }
          }}
        />
      </div>
    </section>
  );
}

/* =========================================================================
   SCREEN 4: REFLECT (CHAPTER III: THE MEMORY LEDGER)
   ========================================================================= */

function ReflectScreen({
  error,
  photoPreview,
  onRetake,
  onFinish,
}: {
  error: string | null;
  photoPreview: string | null;
  onRetake: () => void;
  onFinish: (text: string, voice: Blob | null) => void;
}) {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [recordedVoice, setRecordedVoice] = useState<Blob | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const CHILDHOOD_CUES = [
    "Damp soil & pine needles 🌲",
    "Sunlight through tree leaves ☀️",
    "A forgotten path from youth 🍂",
    "Quiet wind in the branches 🌬️",
    "Found an old secret stone 🪵",
  ];

  function toggleRecording(): void {
    if (recording) {
      recorderRef.current?.stop();
      setRecording(false);
      return;
    }

    navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((stream) => {
        const recorder = new MediaRecorder(stream);
        chunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
          setRecordedVoice(blob);
          stream.getTracks().forEach((track) => track.stop());
        };

        recorderRef.current = recorder;
        recorder.start();
        setRecording(true);
        setSeconds(0);
      })
      .catch(() => {
        // Fallback
      });
  }

  useEffect(() => {
    let timer: number | undefined;
    if (recording) {
      timer = window.setInterval(() => {
        setSeconds((s) => {
          if (s >= 59) {
            recorderRef.current?.stop();
            setRecording(false);
            return 60;
          }
          return s + 1;
        });
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [recording]);

  function handleSave(): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    onFinish(trimmed, recordedVoice);
  }

  return (
    <section className="flex flex-1 flex-col justify-between gap-5 py-2">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#3e271a] pb-3">
        <button
          type="button"
          onClick={onRetake}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-sans text-[#cbb89d] hover:text-[#faedd4] hover:bg-[#2b1b11] transition"
        >
          <span>←</span> Retake photo
        </button>

        <div className="flex items-center gap-2 text-xs font-display font-semibold tracking-wider text-[#d4af37]">
          <span>Chapter III</span>
          <span className="text-[#6d4b35]">✦</span>
          <span>The Memory Ledger</span>
        </div>
      </div>

      {/* Keepsake Photo Polaroid with Vintage Corner Mounts */}
      {photoPreview && (
        <div className="bg-[#24170f] border-2 border-[#4a3221] rounded-2xl p-3.5 flex items-center gap-4 shadow-xl">
          <div className="relative photo-mount shrink-0">
            <img
              src={photoPreview}
              alt="Keepsake snapshot"
              className="h-20 w-20 rounded-lg object-cover border border-[#d4af37]/40"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-serif text-sm font-bold text-[#faedd4]">Keepsake Mounted</p>
            <p className="text-xs font-sans text-[#c8b79b] truncate mt-0.5">
              Now write a few words to anchor this memory forever.
            </p>
            <button
              type="button"
              onClick={onRetake}
              className="mt-1 text-[11px] font-sans text-[#d4af37] underline hover:text-[#faedd4]"
            >
              Change photograph
            </button>
          </div>
        </div>
      )}

      {/* Wax-Cylinder Spoken Voice Note Recorder */}
      <div className="bg-[#22150d] rounded-2xl border border-[#442c1d] p-4 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3.5">
          <button
            type="button"
            onClick={toggleRecording}
            aria-label={recording ? "Stop voice recording" : "Record spoken voice note"}
            className={`flex h-12 w-12 items-center justify-center rounded-full font-bold transition shadow-lg ${
              recording
                ? "bg-[#9e3325] text-white animate-pulse"
                : recordedVoice
                  ? "bg-[#d4af37] text-[#1c1109]"
                  : "bg-[#382417] text-[#e5be79] border border-[#6b472e] hover:bg-[#48301f]"
            }`}
          >
            {recording ? (
              <span className="h-4 w-4 rounded-sm bg-white" />
            ) : (
              <span className="text-xl">🎙</span>
            )}
          </button>
          <div>
            <p className="font-serif text-sm font-bold text-[#faedd4]">
              {recording
                ? `Inscribing voice... (${seconds}s / 60s)`
                : recordedVoice
                  ? "Spoken Note Captured ✓"
                  : "Spoken Field Note"}
            </p>
            <p className="text-xs font-sans text-[#b8a287]">
              {recording ? "Speak naturally to the archive" : "Optional spoken audio note"}
            </p>
          </div>
        </div>

        {recordedVoice && !recording && (
          <button
            type="button"
            onClick={() => setRecordedVoice(null)}
            className="text-xs font-sans text-[#f87171] hover:text-[#fca5a5] px-2 py-1"
          >
            Clear
          </button>
        )}
      </div>

      {/* Written Observation on Parchment Ledger Paper */}
      <div className="bg-parchment rounded-2xl p-5 border-2 border-[#d2be99] shadow-xl flex flex-col gap-2">
        <div className="flex items-center justify-between pb-1 border-b border-[#d8c5a2]">
          <label htmlFor="ledger-experience-input" className="text-xs font-display font-bold uppercase tracking-wider text-[#3d2719]">
            The Field Inscription
          </label>
          <span className="text-xs font-mono text-[#7a5b43]">{text.length} / 2000</span>
        </div>

        <textarea
          id="ledger-experience-input"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 2000))}
          placeholder="I stood under the giant cedar and listened to the crows. The air carried the scent of rain, exactly like October when I was nine years old..."
          rows={4}
          className="w-full bg-transparent p-2 text-base font-serif text-[#1c1209] placeholder:text-[#8a725b] focus:outline-none resize-none leading-relaxed"
        />

        {/* Nostalgic sensory chips */}
        <div className="flex flex-wrap gap-1.5 pt-2 border-t border-[#d8c5a2]">
          {CHILDHOOD_CUES.map((cue) => (
            <button
              key={cue}
              type="button"
              onClick={() => setText((prev) => (prev ? `${prev} ${cue}` : cue))}
              className="rounded-lg bg-[#ebdcc0] px-2.5 py-1 text-xs font-sans text-[#3d2719] border border-[#cfbc97] hover:bg-[#e2ceae] transition"
            >
              + {cue}
            </button>
          ))}
        </div>
      </div>

      {/* Wax Seal Action Button */}
      <div className="flex flex-col gap-2 pt-1">
        {error && <p className="text-sm font-sans text-[#fca5a5] text-center">{error}</p>}

        <button
          type="button"
          onClick={handleSave}
          disabled={text.trim().length === 0}
          className="flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-b from-[#d4af37] via-[#c59d53] to-[#ad863c] px-6 py-4 font-display text-base sm:text-lg font-bold text-[#1c1109] shadow-2xl hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed border border-[#fed67d] transition"
        >
          <span>Seal into the Time Machine</span>
          <span className="text-xl">❦</span>
        </button>
      </div>
    </section>
  );
}

/* =========================================================================
   SCREEN 5: SAVING (INSCRIBING INTO THE LEDGER)
   ========================================================================= */

function SavingScreen({ label, subLabel }: { label: string; subLabel: string }) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-8 py-16 text-center">
      {/* Antique Astrolabe / Hourglass Animated Indicator */}
      <div className="relative flex items-center justify-center">
        <div className="h-24 w-24 rounded-full border-4 border-[#5d3b25] border-t-[#d4af37] animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-3xl">⏳</span>
        </div>
      </div>

      <div className="flex flex-col gap-3 max-w-sm">
        <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#faedd4]">{label}</h2>
        <p className="text-sm font-serif leading-relaxed text-[#dfd0b5]">{subLabel}</p>
      </div>

      <div className="flex items-center gap-2 rounded-full bg-[#24170f] border border-[#523522] px-4 py-1.5 text-xs font-sans text-[#d4af37] shadow-sm">
        <span className="h-2 w-2 rounded-full bg-[#d4af37] animate-ping" />
        <span>Inscribing via Gemma 2 · ElevenLabs · Atlas</span>
      </div>
    </section>
  );
}

/* =========================================================================
   SCREEN 6: MEMORY BOOK (THE ARCHIVE LEDGER — DIARY GRID)
   ========================================================================= */

function BookScreen({
  walks,
  onNewWalk,
  onDeleteWalk,
}: {
  walks: WalkMemory[];
  onNewWalk: () => void;
  onDeleteWalk: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [openWalkId, setOpenWalkId] = useState<string | null>(null);

  const filtered = walks.filter((w) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      w.experienceText.toLowerCase().includes(q) ||
      w.reflectionText.toLowerCase().includes(q) ||
      (w.locationLabel && w.locationLabel.toLowerCase().includes(q))
    );
  });

  const pageCount = Math.max(1, Math.ceil(filtered.length / 6) || 1);
  const safePage = Math.min(page, pageCount - 1);
  const pageWalks = filtered.slice(safePage * 6, safePage * 6 + 6);
  const slots: Array<WalkMemory | null> = [
    ...pageWalks,
    ...Array.from({ length: 6 - pageWalks.length }, () => null),
  ];

  const openWalk = filtered.find((w) => w.id === openWalkId) ?? null;

  return (
    <section className="fixed inset-0 z-40 flex flex-col bg-[#120c08] px-5 py-4 sm:px-8 sm:py-5">
      <div className="mb-3 flex shrink-0 flex-col gap-1 sm:mb-4">
        <h1 className="text-center font-script text-[2.35rem] leading-none text-[#f0d7a2] drop-shadow-[0_2px_0_rgba(80,48,18,0.45)] sm:text-6xl">
          Memories Library
        </h1>
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onNewWalk}
            className="font-script text-3xl leading-none text-[#f0d7a2] drop-shadow-[0_2px_0_rgba(80,48,18,0.45)] sm:text-4xl"
          >
            Home
          </button>
          <div className="flex items-center justify-end">
            {walks.length > 6 ? (
              <input
                type="text"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                  setOpenWalkId(null);
                }}
                placeholder="Search"
                className="w-24 rounded-full border border-[#d4af37]/40 bg-[#1c1109]/80 px-3 py-1 text-[11px] font-sans text-[#faedd4] placeholder:text-[#c8b79b] focus:outline-none sm:w-28"
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-2 gap-3 sm:gap-4">
        {slots.map((walk, index) =>
          walk ? (
            <FilledDiarySlot
              key={walk.id}
              walk={walk}
              index={safePage * 6 + index}
              onClick={() => setOpenWalkId(walk.id)}
            />
          ) : (
            <EmptyDiarySlot
              key={`empty-${safePage}-${index}`}
              slotIndex={safePage * 6 + index}
              onStart={onNewWalk}
              isFirstSlot={filtered.length === 0 && index === 0}
            />
          ),
        )}
      </div>

      <div className="mt-3 flex shrink-0 items-center justify-between px-1 sm:px-4">
        <button
          type="button"
          onClick={() => {
            setPage(Math.max(0, safePage - 1));
            setOpenWalkId(null);
          }}
          disabled={safePage === 0}
          className="font-script text-3xl leading-none text-[#f0d7a2] drop-shadow-[0_2px_0_rgba(80,48,18,0.45)] disabled:opacity-30 sm:text-4xl"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => {
            setPage(Math.min(pageCount - 1, safePage + 1));
            setOpenWalkId(null);
          }}
          disabled={safePage >= pageCount - 1}
          className="font-script text-3xl leading-none text-[#f0d7a2] drop-shadow-[0_2px_0_rgba(80,48,18,0.45)] disabled:opacity-30 sm:text-4xl"
        >
          Forward
        </button>
      </div>

      {/* ── Full-Detail Modal ── */}
      {openWalk && (
        <MemoryDetailModal
          walk={openWalk}
          onClose={() => setOpenWalkId(null)}
          onDelete={() => {
            onDeleteWalk(openWalk.id);
            setOpenWalkId(null);
          }}
        />
      )}
    </section>
  );
}

/* ── Small Filled Diary Box ── */
function FilledDiarySlot({
  walk,
  index,
  onClick,
}: {
  walk: WalkMemory;
  index: number;
  onClick: () => void;
}) {
  const entryNum = String(index + 1).padStart(2, "0");
  const title =
    walk.title?.trim() ||
    (walk.locationLabel && !/°/.test(walk.locationLabel) ? walk.locationLabel : "A kept thing");

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-full w-full flex-col overflow-hidden rounded-2xl border-[3px] border-[#c4a15a] bg-[#f6eedb] text-left shadow-[0_8px_18px_rgba(0,0,0,0.35)] hover:brightness-105 active:scale-[0.99] transition group focus-visible:outline-2 focus-visible:outline-[#d4af37]"
      aria-label={`${title}. ${walk.experienceText}`}
    >
      <div className="relative min-h-0 flex-1">
        <img
          src={walk.photoUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        <span className="absolute top-1.5 left-1.5 font-display text-[9px] font-bold text-[#d4af37] bg-[#18100a]/80 rounded px-1 py-0.5 leading-none">
          #{entryNum}
        </span>
      </div>

      <div className="shrink-0 border-t border-[#d8c5a2] px-2 py-2 sm:px-3 sm:py-2.5">
        <p className="truncate font-display text-[11px] font-bold uppercase tracking-wide text-[#7a5b43] sm:text-xs">
          {title}
        </p>
        <p className="mt-0.5 line-clamp-2 font-serif text-[11px] leading-snug text-[#1f130b] sm:text-sm">
          {walk.experienceText}
        </p>
      </div>
    </button>
  );
}

/* ── Small Empty Diary Slot ── */
function EmptyDiarySlot({
  slotIndex,
  onStart,
  isFirstSlot: _isFirstSlot,
}: {
  slotIndex: number;
  onStart: () => void;
  isFirstSlot: boolean;
}) {
  const slotNum = String(slotIndex + 1).padStart(2, "0");

  return (
    <button
      type="button"
      onClick={onStart}
      className="relative flex h-full w-full flex-col items-center justify-center rounded-2xl border-[3px] border-[#8a7048] bg-[#f5edd9]/[0.04] shadow-[0_8px_18px_rgba(0,0,0,0.28)] hover:bg-[#d4af37]/5 transition group"
      aria-label={`Empty diary slot ${slotNum}. Start a walk to fill it.`}
    >
      {/* Faint ruled horizontal lines to look like blank diary page */}
      <div className="absolute inset-2 flex flex-col justify-evenly pointer-events-none opacity-20">
        {[0, 1, 2, 3].map((line) => (
          <div key={line} className="w-full h-px bg-[#d4af37]" />
        ))}
      </div>

      {/* Slot number watermark */}
      <span className="absolute top-1.5 left-1.5 font-display text-[9px] font-bold text-[#8c745d]/60 leading-none">
        #{slotNum}
      </span>

      {/* Centre plus icon */}
      <span className="text-[#5a3f2c]/50 text-lg group-hover:text-[#d4af37]/60 transition">
        +
      </span>
      <span className="text-[8px] font-sans font-medium text-[#5a3f2c]/50 group-hover:text-[#d4af37]/70 mt-0.5 transition">
        New
      </span>
    </button>
  );
}

/* ── Full-Detail Modal (tapped from diary grid) ── */
function MemoryDetailModal({
  walk,
  onClose,
  onDelete,
}: {
  walk: WalkMemory;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function copyText(): void {
    void navigator.clipboard.writeText(`${walk.experienceText}\n\nReflection: ${walk.reflectionText}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Memory detail"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[#0d0804]/85 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet */}
      <article className="relative z-10 w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto bg-parchment rounded-t-3xl sm:rounded-3xl border-2 border-[#cfbc97] shadow-2xl flex flex-col">
        {/* Ribbon bookmark */}
        <div className="absolute top-0 right-8 h-8 w-5 bg-[#9e3325] ribbon-tab shadow-md" />

        {/* Close bar */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[#d8c5a2]">
          <span className="font-display text-xs font-bold tracking-widest uppercase text-[#7a5b43]">
            ❦ Memory Page · Filed Entry
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close memory detail"
            className="text-[#7a5b43] hover:text-[#3d2719] text-lg leading-none transition"
          >
            ✕
          </button>
        </div>

        {/* Photo */}
        <div className="relative aspect-[4/3] w-full overflow-hidden photo-mount">
          <img
            src={walk.photoUrl}
            alt="Outdoor keepsake"
            className="h-full w-full object-cover"
          />
          <div className="absolute top-3 left-3 rounded-full bg-[#1c1209]/80 backdrop-blur-md px-3 py-1 text-[11px] font-sans font-semibold text-[#f5ecd4] border border-[#d4af37]/40">
            📍 {walk.locationLabel || "Outdoor Expedition"}
          </div>
          <div className="absolute bottom-3 right-3 stamp-border rounded-md px-2.5 py-0.5 text-[10px] font-sans font-bold uppercase tracking-wider bg-[#f6eedb]/90">
            FILED: {new Date(walk.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 p-5">
          {/* Observation */}
          <div className="flex flex-col gap-1">
            <p className="text-[11px] font-display font-bold uppercase tracking-wider text-[#7a5b43]">
              Wanderer's Observation
            </p>
            <p className="font-serif text-lg text-[#1f130b] leading-relaxed font-medium">
              "{walk.experienceText}"
            </p>
          </div>

          {/* Gemma Reflection */}
          <div className="rounded-2xl border border-[#c9b38e] bg-[#ede0c8] p-4 flex flex-col gap-2 shadow-inner">
            <span className="text-xs font-display font-bold uppercase tracking-wider text-[#7a482b] flex items-center gap-1">
              <span>❦</span> Gemma Reflection · Chapter Note
            </span>
            <p className="font-serif text-base text-[#26180f] italic leading-relaxed">
              "{walk.reflectionText}"
            </p>
          </div>

          {/* Audio */}
          <div className="flex flex-wrap gap-2.5">
            {walk.reflectionAudioUrl && (
              <AudioPlayerChip label="Gemma Reflection" src={walk.reflectionAudioUrl} icon="✨" />
            )}
            {walk.voiceUrl && (
              <AudioPlayerChip label="Spoken Note" src={walk.voiceUrl} icon="🎙" />
            )}
          </div>

          {/* Footer actions */}
          <div className="flex items-center justify-between border-t border-[#d8c5a2] pt-4 text-xs font-sans text-[#7a5b43]">
            <button
              type="button"
              onClick={copyText}
              className="flex items-center gap-1.5 hover:text-[#23150d] transition font-medium"
            >
              <span>📜</span>
              <span>{copied ? "Copied!" : "Copy Passage"}</span>
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="text-[#9e3325] hover:text-[#7f261a] transition font-medium"
            >
              Remove entry
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}

// MemoryCardItem is now replaced by FilledDiarySlot + MemoryDetailModal above.

function AudioPlayerChip({ label, src, icon }: { label: string; src: string; icon: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  function toggle(): void {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      audio.pause();
      setPlaying(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-sans font-bold border transition ${
        playing
          ? "bg-[#28180f] text-[#f5ecd4] border-[#d4af37] shadow-md"
          : "bg-[#e2d2b5] text-[#3d2719] border-[#c4b090] hover:bg-[#d8c5a2]"
      }`}
    >
      <span>{icon}</span>
      <span>{playing ? "Pause" : "Play"} {label}</span>
      <audio
        ref={audioRef}
        src={src}
        preload="none"
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
      />
    </button>
  );
}
