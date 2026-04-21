/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Example centralized token
        brand: {
          primary: '#3b82f6', // blue-500
          secondary: '#60a5fa', // blue-400
        }
      }
    },
  },
  plugins: [],
}
