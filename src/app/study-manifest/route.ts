// Web app manifest for the study screen: added to a tablet's home screen, it opens full-screen like an app
// (browsers that require https for this fall back to a normal tab; the in-app ⛶ button still works).
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#3D4BE0"/><path d="M150 330c40 40 90 60 140 50 60-12 92-62 80-118-12-58-70-90-128-76" fill="none" stroke="#fff" stroke-width="44" stroke-linecap="round"/><path d="M226 150l-58 40 60 38" fill="none" stroke="#fff" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function GET(request: Request) {
  if (new URL(request.url).searchParams.has("icon")) {
    return new Response(icon, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
  }
  return Response.json({
    name: "되짚기 · Recaller", short_name: "되짚기", start_url: "/study", scope: "/", display: "fullscreen",
    display_override: ["fullscreen", "standalone"], background_color: "#F2F3F6", theme_color: "#F2F3F6", orientation: "any",
    icons: [{ src: "/study-manifest?icon", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
  }, { headers: { "Content-Type": "application/manifest+json" } });
}
