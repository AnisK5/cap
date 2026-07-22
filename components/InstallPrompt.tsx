"use client";

import { useEffect, useState } from "react";

// Bouton « Installer l'app » adaptatif :
//  - Chrome/Edge desktop + Android : capte `beforeinstallprompt` et déclenche
//    la VRAIE pop-up native d'installation ;
//  - iPhone (tous navigateurs), Safari macOS, Firefox : pas d'API — on ouvre
//    un petit guide pas-à-pas adapté à l'appareil ;
//  - une fois l'app installée (mode standalone), le bouton disparaît.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

type Guide = "ios" | "safari-mac" | "desktop";

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(true); // masqué jusqu'à ce qu'on sache
  const [sheet, setSheet] = useState<Guide | null>(null);

  useEffect(() => {
    if (isStandalone()) {
      setHidden(true);
      return;
    }
    setHidden(false);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setHidden(true);
      setDeferred(null);
      setSheet(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (hidden) return null;

  const onClick = async () => {
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice;
      setDeferred(null);
      return;
    }
    const ua = navigator.userAgent;
    const iOS =
      /iphone|ipad|ipod/i.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const mac = /Macintosh/.test(ua) && navigator.maxTouchPoints <= 1;
    setSheet(iOS ? "ios" : mac ? "safari-mac" : "desktop");
  };

  return (
    <>
      <button
        onClick={onClick}
        className="flex shrink-0 items-center gap-1.5 rounded-full border border-cap/30 bg-cap-soft/60 px-3 py-1 text-xs font-medium text-cap-ink transition-colors hover:border-cap/60"
        title="Installer Cap sur cet appareil"
      >
        <span aria-hidden>⤓</span>
        Installer l&apos;app
      </button>
      {sheet && <InstallSheet guide={sheet} onClose={() => setSheet(null)} />}
    </>
  );
}

const GUIDES: Record<Guide, { title: string; steps: string[]; note?: string }> = {
  ios: {
    title: "Installer Cap sur ton iPhone",
    steps: [
      "Touche le bouton Partager de ton navigateur — le carré avec une flèche vers le haut.",
      "Fais défiler et choisis « Sur l'écran d'accueil ».",
      "Touche « Ajouter ». Cap apparaît comme une vraie app.",
    ],
    note: "Marche sur Safari, Chrome et Edge — tous les navigateurs iPhone.",
  },
  "safari-mac": {
    title: "Installer Cap sur ton Mac",
    steps: [
      "Dans la barre de menus tout en haut, ouvre « Fichier ».",
      "Choisis « Ajouter au Dock ».",
      "Cap s'ouvre dans sa propre fenêtre, avec son icône dans le Dock.",
    ],
    note: "Sur Chrome ou Edge, l'icône « Installer » apparaît directement dans la barre d'adresse.",
  },
  desktop: {
    title: "Installer Cap",
    steps: [
      "Cherche l'icône « Installer » dans la barre d'adresse — un écran avec une flèche, ou un ⊕.",
      "Clique-la, puis « Installer ».",
    ],
    note: "Firefox ne gère pas l'installation : ouvre Cap dans Chrome, Edge ou Safari pour l'installer.",
  },
};

function InstallSheet({ guide, onClose }: { guide: Guide; onClose: () => void }) {
  const g = GUIDES[guide];
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="animate-rise w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-lg font-medium text-ink">{g.title}</h3>
          <button
            onClick={onClose}
            className="shrink-0 text-xl leading-none text-faint transition-colors hover:text-ink"
            title="Fermer"
          >
            ×
          </button>
        </div>
        <ol className="mt-4 flex flex-col gap-3">
          {g.steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-sm leading-snug text-muted">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cap text-xs font-semibold text-canvas">
                {i + 1}
              </span>
              <span className="pt-0.5">{s}</span>
            </li>
          ))}
        </ol>
        {g.note && <p className="mt-4 text-xs leading-relaxed text-faint">{g.note}</p>}
      </div>
    </div>
  );
}
