"use client";

import { useAuth } from "@/lib/auth";
import type { HomeView } from "./homeViews";

type HomeAuthBarProps = {
  onNavigate: (view: HomeView) => void;
  onSignedOut?: () => void;
};

/** Fixed sign-in / sign-up / sign-out links — visible on every home view. */
export function HomeAuthBar({ onNavigate, onSignedOut }: HomeAuthBarProps) {
  const { user, loading, signOut } = useAuth();

  if (loading) {
    return (
      <div className="home-auth-bar" aria-hidden>
        <span className="home-auth-bar__ghost">…</span>
      </div>
    );
  }

  if (user) {
    return (
      <nav className="home-auth-bar" aria-label="Account">
        <button
          type="button"
          className="home-auth-bar__link"
          onClick={() => onNavigate("sign-in")}
        >
          Account
        </button>
        <span className="home-auth-bar__sep" aria-hidden>
          /
        </span>
        <button
          type="button"
          className="home-auth-bar__link home-auth-bar__link--muted"
          onClick={() => {
            void signOut().then(() => onSignedOut?.());
          }}
        >
          Sign out
        </button>
      </nav>
    );
  }

  return (
    <nav className="home-auth-bar" aria-label="Sign in">
      <button
        type="button"
        className="home-auth-bar__link"
        onClick={() => onNavigate("sign-in")}
      >
        Sign in
      </button>
      <span className="home-auth-bar__sep" aria-hidden>
        /
      </span>
      <button
        type="button"
        className="home-auth-bar__link home-auth-bar__link--mint"
        onClick={() => onNavigate("sign-up")}
      >
        Sign up
      </button>
    </nav>
  );
}
