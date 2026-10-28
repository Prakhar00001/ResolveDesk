/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#192b28",
        canvas: "#f6f8fa",
        brand: {
          50: "#ecf8f3",
          100: "#d8efe5",
          500: "#218467",
          600: "#176b53",
          700: "#145442",
          900: "#153e34",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: { panel: "0 2px 8px -4px rgb(18 52 42 / 0.08)" },
    },
  },
  plugins: [],
};
