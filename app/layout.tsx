import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "localhost:3000";
  const protocol = incoming.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const socialImage = `${protocol}://${host}/og.png`;

  return {
    title: "Office Karate",
    description: "Ett C64-doftande 2.5D-slagsmål mellan kollegor.",
    openGraph: {
      title: "Office Karate",
      description: "Tre kollegor. Sextio sekunder. Noll värdighet.",
      type: "website",
      images: [{ url: socialImage, width: 1200, height: 630, alt: "Office Karate" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Office Karate",
      description: "Tre kollegor. Sextio sekunder. Noll värdighet.",
      images: [socialImage],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="sv">
      <body>{children}</body>
    </html>
  );
}
