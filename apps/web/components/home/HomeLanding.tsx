"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HomeInfoTicker } from "./HomeInfoTicker";
import { HomeAuthBar } from "./HomeAuthBar";
import { HomeViewportOverlay } from "./HomeViewportOverlay";
import { HomeViewportFeed } from "./HomeViewportFeed";
import { HomeBackground } from "./HomeBackground";
import { HeroWordmark } from "./HeroWordmark";
import { HomeHeroStage } from "./HomeHeroStage";
import { HomePanelDownload } from "./panels/HomePanelDownload";
import { HomePanelPricing } from "./panels/HomePanelPricing";
import { HomePanelAuth } from "./panels/HomePanelAuth";
import { HomePanelCheckout } from "./panels/HomePanelCheckout";
import { HomePanelChangelog } from "./panels/HomePanelChangelog";
import { HOME_VIEW_PARAM, parseHomeView, type HomeView } from "./homeViews";
import { useGlitchTransition } from "./useGlitchTransition";
import { useMobileViewport } from "@/lib/useMobileViewport";

type HomeLandingProps = {
  initialView?: HomeView;
};

function HomeLandingInner({ initialView = "hero" }: HomeLandingProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramView = parseHomeView(searchParams.get(HOME_VIEW_PARAM));
  const startView = paramView ?? initialView;
  const [pendingCheckout, setPendingCheckout] = useState(
    () => searchParams.get("next") === "/checkout"
  );
  const { view, setView, phase, transitionTo, glitching } = useGlitchTransition(startView);
  const isMobile = useMobileViewport();

  const syncUrl = useCallback(
    (next: HomeView) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "hero") {
        params.delete(HOME_VIEW_PARAM);
      } else {
        params.set(HOME_VIEW_PARAM, next);
      }
      const query = params.toString();
      router.replace(query ? `/?${query}` : "/", { scroll: false });
    },
    [router, searchParams]
  );

  const navigate = useCallback(
    (next: HomeView) => {
      if (next === "sign-up" && view === "pricing") {
        setPendingCheckout(true);
      }
      if (next === "hero" || next === "download") {
        setPendingCheckout(false);
      }
      transitionTo(next);
      syncUrl(next);
    },
    [syncUrl, transitionTo, view]
  );

  useEffect(() => {
    if (paramView && paramView !== view && phase === "idle") {
      setView(paramView);
    }
  }, [paramView, phase, setView, view]);

  const isHero = view === "hero";
  const shellClass = [
    "home-shell",
    glitching ? "home-shell--glitch" : "",
    !isHero ? "home-shell--panel" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const demoActive = isHero && !glitching && !isMobile;

  useEffect(() => {
    document.body.classList.toggle("home-viewport-demo", demoActive);
    document.body.classList.toggle("home-mobile", isMobile);
    return () => {
      document.body.classList.remove("home-viewport-demo");
      document.body.classList.remove("home-mobile");
    };
  }, [demoActive, isMobile]);

  return (
    <div className={`home${isMobile ? " home--mobile" : ""}`}>
      <HomeInfoTicker />
      <HomeAuthBar onNavigate={navigate} onSignedOut={() => navigate("hero")} />
      <HomeBackground />
      <HomeViewportFeed active={demoActive} />
      <HomeViewportOverlay active={demoActive} />
      {glitching ? <div className="home-glitch-overlay" aria-hidden /> : null}

      <main className={shellClass}>
        <HeroWordmark compact={!isHero} />

        <div className={`home-stage${glitching ? " home-stage--glitch" : ""}`} key={view}>
          {view === "hero" ? (
            <HomeHeroStage onNavigate={navigate} disabled={glitching} />
          ) : null}

          {view === "download" ? (
            <HomePanelDownload onBack={() => navigate("hero")} onPricing={() => navigate("pricing")} />
          ) : null}

          {view === "pricing" ? (
            <HomePanelPricing
              onBack={() => navigate("hero")}
              onDownload={() => navigate("download")}
              onCheckout={() => navigate("checkout")}
              onSignUp={() => {
                setPendingCheckout(true);
                navigate("sign-up");
              }}
            />
          ) : null}

          {view === "changelog" ? (
            <HomePanelChangelog
              onBack={() => navigate("hero")}
              onDownload={() => navigate("download")}
            />
          ) : null}

          {view === "sign-in" || view === "sign-up" ? (
            <HomePanelAuth
              mode={view}
              onBack={() => navigate("hero")}
              onSwitchMode={(mode) => navigate(mode)}
              onAuthenticated={(next) => navigate(next)}
              pendingCheckout={pendingCheckout}
            />
          ) : null}

          {view === "checkout" ? (
            <HomePanelCheckout
              onBack={() => navigate("pricing")}
              onSignIn={() => {
                setPendingCheckout(true);
                navigate("sign-in");
              }}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}

export function HomeLanding(props: HomeLandingProps) {
  return (
    <Suspense fallback={<div className="home home--loading" aria-hidden />}>
      <HomeLandingInner {...props} />
    </Suspense>
  );
}
