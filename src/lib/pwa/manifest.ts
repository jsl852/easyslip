export function webAppManifest() {
  return {
    id: "/",
    name: "EasySlip",
    short_name: "EasySlip",
    description: "Receipt-led accounting for Hong Kong SMEs. Photograph a receipt, review the extraction, and keep the journal.",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    background_color: "#f3efe4",
    theme_color: "#0f5f5a",
    lang: "en",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
