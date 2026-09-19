import React, { lazy, Suspense, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import ClearChoiceApp from "./choice/ClearChoiceApp";
import "./styles.css";
const LegacyApp = lazy(() => import("./App"));
function Entry() {
  const [legacy, setLegacy] = useState(window.location.hash === "#legacy");
  useEffect(() => {
    const change = () => setLegacy(window.location.hash === "#legacy");
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  return legacy ? (
    <Suspense fallback={<p>Loading Dayfork…</p>}>
      <a className="block p-3 text-center text-sm text-near" href="#">
        Open Clear Choice
      </a>
      <LegacyApp />
    </Suspense>
  ) : (
    <ClearChoiceApp />
  );
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Entry />
  </React.StrictMode>,
);
