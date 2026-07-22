import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  title: "Axiom",
  description: "A human-controlled AI engineering organization.",
  icons: {
    icon: "/minimal_nodes_thumbnail.png",
    shortcut: "/minimal_nodes_thumbnail.png",
    apple: "/minimal_nodes_thumbnail.png",
  },
  openGraph: {
    title: "Axiom",
    description: "A human-controlled AI engineering organization.",
    images: [
      {
        url: "/minimal_nodes_thumbnail.png",
        alt: "Axiom Logo",
      },
      {
        url: "/axiom-thumbnail.gif",
        alt: "Axiom Preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Axiom",
    description: "A human-controlled AI engineering organization.",
    images: ["/minimal_nodes_thumbnail.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

 