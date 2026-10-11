import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import App from "./App";
import "./App.css";

// Lets CSS switch on the native window (real vibrancy behind the sidebar).
if (isTauri()) document.documentElement.classList.add("tauri");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
