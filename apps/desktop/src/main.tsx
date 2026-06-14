import React from "react";
import ReactDOM from "react-dom/client";
import "@ninesixteen/brand/theme.css";
import "./styles.css";
import { App } from "./App";
import { AuthProvider } from "./lib/auth";
import { bootstrapFirebaseAuth } from "./lib/auth-bootstrap";
import { isFirebaseConfigured } from "./lib/firebase";

if (import.meta.env.PROD && !isFirebaseConfigured) {
  throw new Error(
    "NineSixteen: Firebase env vars are missing. Production builds require VITE_FIREBASE_* configuration."
  );
}

const root = ReactDOM.createRoot(document.getElementById("root")!);
const app = (
  <AuthProvider>
    <App />
  </AuthProvider>
);

// Paint the UI immediately — never block first render on Firebase network I/O.
root.render(import.meta.env.DEV ? <React.StrictMode>{app}</React.StrictMode> : app);

void bootstrapFirebaseAuth();
