import { CoachTipCard } from "@/components/CoachTipCard";

export function TipCard({ signedIn }: { signedIn: boolean }) {
  return <CoachTipCard signedIn={signedIn} />;
}
