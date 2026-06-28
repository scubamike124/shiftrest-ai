import { SmartAlarmCard } from "@/components/SmartAlarmCard";

/** Thin wrapper so the Morning Brief can mount the existing Smart Alarm card. */
export function AlarmCard({ signedIn }: { signedIn: boolean }) {
  return <SmartAlarmCard signedIn={signedIn} />;
}
