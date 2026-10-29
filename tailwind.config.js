/** Config compartida por todo el sitio — igual a la que antes vivía inline
 * en cada HTML vía CDN (cdn.tailwindcss.com). Usada por el build local
 * (ver assets/css/tailwind-input.css -> assets/css/tailwind.css) para
 * dejar de depender del script de CDN en producción. */
module.exports = {
  content: ["./*.html", "./assets/js/**/*.js"],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: "#0B1F3A", light: "#142C52" },
        graphite: "#2E2E33",
        gold: { DEFAULT: "#B8963E", light: "#D9C088" },
        paper: "#F7F5F1"
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["Playfair Display", "ui-serif", "Georgia", "serif"]
      }
    }
  }
};
