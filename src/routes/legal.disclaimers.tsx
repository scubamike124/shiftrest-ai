import { createFileRoute } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal/LegalLayout";
import { findLegalDoc } from "@/lib/legal/meta";

const DOC = findLegalDoc("disclaimers")!;

export const Route = createFileRoute("/legal/disclaimers")({
  head: () => ({
    meta: [
      { title: `${DOC.title} — RestPilot AI` },
      { name: "description", content: DOC.summary },
      { property: "og:title", content: `${DOC.title} — RestPilot AI` },
      { property: "og:description", content: DOC.summary },
      { property: "og:url", content: DOC.path },
    ],
    links: [{ rel: "canonical", href: DOC.path }],
  }),
  component: () => (
    <LegalLayout doc={DOC}>
      <h2 id="ai">AI Disclaimer</h2>
      <p>
        RestPilot AI uses artificial-intelligence models from third-party
        providers to generate recommendations, summaries, and audio
        briefings. AI output can be incomplete, inaccurate, or out of date,
        and may reflect biases in the underlying models. You are responsible
        for evaluating AI suggestions before acting on them.
      </p>

      <h2 id="health">Health &amp; Wellness Disclaimer</h2>
      <p>
        RestPilot AI is a wellness and productivity tool. It is not a
        substitute for professional medical, psychological, nutritional, or
        sleep-medicine advice, diagnosis, or treatment.
      </p>

      <h2 id="not-medical-device">Not a Medical Device</h2>
      <p>
        RestPilot AI is not a medical device. It is not intended to diagnose,
        treat, cure, mitigate, or prevent any disease or condition,
        including sleep disorders. It has not been evaluated by the FDA or
        any equivalent regulator.
      </p>

      <h2 id="no-doctor-patient">No Doctor–Patient Relationship</h2>
      <p>
        Use of the Service does not create a doctor-patient, therapist-client,
        or other professional relationship between you and RestPilot AI.
      </p>

      <h2 id="informational">Informational Purposes Only</h2>
      <p>
        All content in the Service — including AI Coach messages, plans,
        alarms, briefings, and recommendations — is provided for
        informational purposes only.
      </p>

      <h2 id="accuracy">Recommendation Accuracy</h2>
      <p>
        Recommendations are generated from algorithms and AI models using the
        data you provide and data from connected services. We do not
        guarantee any particular sleep, performance, or health outcome.
      </p>

      <h2 id="user-responsibility">User Responsibility</h2>
      <p>
        You are solely responsible for decisions you make based on the
        Service, including when to sleep, wake, take caffeine, exercise,
        commute, or perform any other activity.
      </p>

      <h2 id="emergency">Emergency Disclaimer</h2>
      <p>
        RestPilot AI is not designed for emergencies. If you are experiencing
        a medical or mental-health emergency, call your local emergency
        number (in the US, 911) or go to the nearest emergency department.
      </p>

      <h2 id="safety-sensitive">Safety-Sensitive Activity Disclaimer</h2>
      <p>
        Users remain solely responsible for determining whether they are fit
        to drive, operate machinery, perform safety-sensitive work
        (including aviation, healthcare, public safety, transportation, and
        industrial roles), or make health-related decisions. RestPilot AI
        provides informational recommendations only and does not certify
        fitness for duty. Follow your employer's fatigue, fitness-for-duty,
        and safety policies and applicable regulations.
      </p>
    </LegalLayout>
  ),
});
