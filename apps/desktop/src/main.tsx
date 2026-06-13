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

bootstrapFirebaseAuth().then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <AuthProvider>
        <App />
      </AuthProvider>
    </React.StrictMode>
  );
});
