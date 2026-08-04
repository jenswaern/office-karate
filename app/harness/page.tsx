import type { Metadata } from "next";
import { OfficeKarateHarness } from "../OfficeKarate";

export const metadata: Metadata = {
  title: "Office Karate – Animation Harness",
  description: "Kontrollerad testmiljö för Office Karates modeller, animationer och träffreaktioner.",
};

export default function HarnessPage() {
  return <OfficeKarateHarness />;
}
