import { ImageResponse } from "next/og";

/**
 * The share picture for links to any page that has no photo of its own (the
 * home page, the menu). 1200x630, drawn from the brand's own colours; no
 * network or font fetch, so it renders the same everywhere and is generated
 * once at build.
 */
export const alt = "FRYBIRD. Born crispy. Built bold. Fried chicken in Sector 9, Ambala City.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 96px",
          background: "#f8b317",
          color: "#2c211b",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 176, fontWeight: 900, letterSpacing: -6, color: "#d92b2b" }}>FRYBIRD</div>
        <div style={{ display: "flex", fontSize: 64, fontWeight: 800, marginTop: 8 }}>Born crispy. Built bold.</div>
        <div style={{ display: "flex", fontSize: 36, marginTop: 40, color: "#2c211b" }}>Fried chicken · Sector 9, Ambala City</div>
      </div>
    ),
    { ...size },
  );
}
