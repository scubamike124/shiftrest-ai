import { createFileRoute } from '@tanstack/react-router';
/** Process liveness only. Does not certify backend/provider readiness. */
export const Route = createFileRoute('/api/public/health')({
  server:{handlers:{GET:()=>Response.json({status:'ok',service:'restpilot-web'},{headers:{'Cache-Control':'no-store'}})}},
});
