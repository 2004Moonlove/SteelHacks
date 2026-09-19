import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ChoiceApp from "./choice/ChoiceApp";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{new URLSearchParams(window.location.search).get("legacy") === "1" ? <App /> : <ChoiceApp />}</React.StrictMode>,
);
