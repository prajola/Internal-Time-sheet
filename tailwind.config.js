/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // KubeGraf-inspired orange palette
        brand: {
          50: "#fff8ef",
          100: "#ffeacc",
          200: "#ffd486",
          300: "#ffb74d",
          400: "#ffa340",
          500: "#ff8a1c",
          600: "#e6700a",
          700: "#b85700",
          800: "#8a3f00",
          900: "#5c2900",
        },
      },
      fontFamily: {
        sans: ["'Inter Tight'", "system-ui", "sans-serif"],
        display: ["'Outfit'", "'Inter Tight'", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
