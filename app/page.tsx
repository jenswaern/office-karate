import type { Metadata } from "next";
import OfficeKarate from "./OfficeKarate";

export const metadata: Metadata = {
  title: "Office Karate",
  description: "Tre kollegor. Sextio sekunder. Noll värdighet.",
};

export default function Home() {
  return <OfficeKarate />;
}
