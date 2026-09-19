/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
      colors: {
        ink: "#17243c",
        muted: "#65758f",
        line: "#e4eaf2",
        near: "#3f68ef",
        far: "#13a99b",
      },
      boxShadow: {
        card: "0 8px 36px rgba(28, 48, 88, 0.055)",
        float: "0 24px 80px rgba(23, 36, 60, 0.15)",
      },
      borderRadius: { xl: "1rem", "2xl": "1.25rem" },
    },
  },
  plugins: [],
};
