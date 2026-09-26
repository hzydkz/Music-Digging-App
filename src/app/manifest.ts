import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "디깅 노트",
    short_name: "디깅",
    description: "앨범·아티스트 조사 노트",
    start_url: "/",
    display: "standalone",
    background_color: "#14120f",
    theme_color: "#14120f",
    lang: "ko",
    icons: [
      { src: "/icons/192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
