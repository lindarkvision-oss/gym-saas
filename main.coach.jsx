import React from "react";
import ReactDOM from "react-dom/client";
import CoachApp from "./CoachApp.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <CoachApp />
  </React.StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw-coach.js").catch(console.error);
  });
}