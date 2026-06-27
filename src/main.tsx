import React from "react";
import ReactDOM from "react-dom/client";

import "@fontsource-variable/bodoni-moda";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/lora";
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/martian-mono";
import "./styles/tokens.css";

import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
