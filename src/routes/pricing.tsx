import { createFileRoute } from "@tanstack/react-router";
import { AppPreviewAccess } from "@/components/AppPreviewAccess";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "App Preview — RestPilot AI" },
      { name: "description", content: "RestPilot app preview access. No purchases or payment details are required during the White Glove test." },
    ],
  }),
  component: AppPreviewAccess,
});
