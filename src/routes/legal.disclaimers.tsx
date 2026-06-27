import { createFileRoute, Link } from "@tanstack/react-router";
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
      <p>
        These disclaimers apply to every feature of RestPilot AI. For a
        plain-language version intended for day-to-day reference, see our{" "}
        <Link to="/safety">Safety Center</Link>.
      </p>

      <h2 id="ai-output">AI output limitations</h2>
      <p>
        RestPilot AI uses artificial-intelligence models from third-party
        providers (see{" "}
        <Link to="/legal/third-parties">Subprocessors &amp; Integrations</Link>)
        to generate recommendations, summaries, alerts, voice briefings, and
        other content. AI output:
      </p>
      <ul>
        <li>may be <strong>inaccurate</strong>;</li>
        <li>may be <strong>incomplete</strong> or omit relevant context;</li>
        <li>
          may be <strong>outdated</strong> because models are trained on
          historical data and providers may change without notice;
        </li>
        <li>
          may reflect <strong>biases</strong> present in the underlying
          training data; and
        </li>
        <li>
          should be <strong>independently evaluated</strong> by you before
          you act on it.
        </li>
      </ul>
      <p>
        AI output is informational and is <strong>not guaranteed to be
        correct</strong>. You are responsible for your decisions. Do not
        rely on AI output for medical, legal, financial, safety-critical,
        or emergency purposes.
      </p>

      <h2 id="device-sensor">Device &amp; sensor limitations</h2>
      <p>
        RestPilot AI can connect to wearable devices, health platforms, and
        other third-party services to enrich recommendations. These
        connections are provided for convenience and:
      </p>
      <ul>
        <li>Wearable devices and apps may <strong>fail or disconnect</strong>.</li>
        <li>
          Device sensors may report <strong>inaccurate, missing, or
          delayed</strong> data.
        </li>
        <li>
          Third-party integrations may become <strong>unavailable,
          rate-limited, deprecated, or removed</strong> by their provider at
          any time.
        </li>
        <li>
          <strong>Synchronization delays</strong> mean the data we display
          may not reflect the most recent activity.
        </li>
        <li>
          <strong>Internet outages</strong>, ISP issues, or device offline
          mode may prevent us from receiving data and may affect
          recommendations.
        </li>
      </ul>
      <p>
        RestPilot AI does not control these third parties and cannot
        guarantee the accuracy, availability, completeness, or timeliness
        of data received from them. Always cross-check critical information
        with the source device or app.
      </p>

      <h2 id="health">Health &amp; wellness disclaimer</h2>
      <p>
        RestPilot AI is a wellness and productivity tool. It is not a
        substitute for professional medical, psychological, nutritional, or
        sleep-medicine advice, diagnosis, or treatment. Consult a qualified
        clinician for medical concerns.
      </p>

      <h2 id="not-medical-device">Not a medical device</h2>
      <p>
        RestPilot AI is not a medical device. It is not intended to diagnose,
        treat, cure, mitigate, or prevent any disease or condition,
        including sleep disorders. It has not been evaluated by the FDA or
        any equivalent regulator.
      </p>

      <h2 id="no-doctor-patient">No doctor–patient relationship</h2>
      <p>
        Use of the Service does not create a doctor-patient,
        therapist-client, or other professional relationship between you
        and RestPilot AI.
      </p>

      <h2 id="companion">Companion AI limitations</h2>
      <p>
        Companion, voice briefings, and any conversational features are
        software — not a clinician, therapist, coach, or crisis resource.
        They do not understand your full medical history or current
        condition. Do not use Companion in place of a medical or
        mental-health professional, and do not rely on it during an
        emergency. See <Link to="#emergency">Emergency disclaimer</Link>{" "}
        below.
      </p>

      <h2 id="driving">Driving &amp; safety-sensitive activity</h2>
      <p id="safety-sensitive">
        Do not interact with the Service while driving or operating
        machinery. You are solely responsible for determining whether you
        are fit to drive, operate machinery, perform safety-sensitive work
        (including aviation, healthcare, public safety, transportation, and
        industrial roles), or make health-related decisions. RestPilot AI
        provides informational recommendations only and does not certify
        fitness for duty. Follow your employer's fatigue, fitness-for-duty,
        and safety policies and all applicable laws and regulations.
      </p>

      <h2 id="accuracy">Recommendation accuracy</h2>
      <p>
        Recommendations are generated from algorithms and AI models using
        the data you provide and data from connected services. We do not
        guarantee any particular sleep, performance, alertness, or health
        outcome.
      </p>

      <h2 id="user-responsibility">User responsibility</h2>
      <p>
        You are solely responsible for decisions you make based on the
        Service, including when to sleep, wake, take caffeine, exercise,
        commute, work, or perform any other activity.
      </p>

      <h2 id="emergency">Emergency disclaimer</h2>
      <p>
        RestPilot AI is not designed for emergencies. If you are
        experiencing a medical or mental-health emergency, call your local
        emergency number (in the US, dial 911; for mental-health crises in
        the US, dial or text 988) or go to the nearest emergency
        department.
      </p>
    </LegalLayout>
  ),
});
