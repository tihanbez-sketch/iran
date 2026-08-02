import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy & POPIA notice',
  description:
    'How PFL Financial Advisors collects, uses, stores and deletes the personal information you give us through this portal.',
};

/**
 * POPIA notice.
 *
 * PLACEHOLDER PENDING SIGN-OFF: the substance below reflects what the Phase 1
 * code actually does, but the information officer's details, the retention
 * period and the complaints process must be confirmed by PFL's compliance
 * officer before this goes live. Search for [CONFIRM] below.
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="text-3xl font-semibold text-ink">Privacy &amp; POPIA notice</h1>
      <p className="mt-3 text-ink-muted">
        How we handle the information you give us through this portal.
      </p>

      <div className="mt-10 space-y-9 text-ink-soft">
        <Section title="Who we are">
          <p>
            PFL Financial Advisors is an authorised financial services provider in terms of the
            Financial Advisory and Intermediary Services Act, 2002, based in KwaZulu-Natal, South
            Africa. We are the responsible party for the personal information described here, as
            defined in the Protection of Personal Information Act, 2013 (POPIA).
          </p>
          <p className="mt-3">
            Information officer: <strong>[CONFIRM — name and email address]</strong>
          </p>
        </Section>

        <Section title="What we collect">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Your quiz answers.</strong> The eight answers you give in the Retirement
              Health Score, and the score calculated from them.
            </li>
            <li>
              <strong>Your contact details.</strong> Name and email address, and your phone number
              only if you choose to give it.
            </li>
            <li>
              <strong>How you use the portal.</strong> Which pages and tools you used and when, tied
              to a random identifier stored in your browser. This identifier contains no personal
              information and is not shared with anyone.
            </li>
          </ul>
        </Section>

        <Section title="Why we collect it">
          <p>
            To calculate and show your score, to prepare your report, and — where you have asked us
            to — to contact you about your results. If you tick the optional marketing box, we also
            use your email address to send financial education material. Those are two separate
            choices, and you can accept one without the other.
          </p>
        </Section>

        <Section title="Consent">
          <p>
            We ask for your explicit consent before storing your details. Nothing is pre-ticked, and
            we record when you gave consent. You may withdraw it at any time by emailing us; we will
            stop processing and delete your information unless the law requires us to keep a record
            (financial services legislation obliges us to retain certain records of advice).
          </p>
        </Section>

        <Section title="Who can see it">
          <p>
            Your information is stored in our database hosted with Supabase and is accessible only
            to authorised PFL staff. It is protected by row-level security, which means there is no
            way to read lead records from a web browser. We do not sell your information and we do
            not share it with third parties for their own marketing.
          </p>
          <p className="mt-3">
            Your quiz answers are sent to Anthropic&rsquo;s Claude API to generate the written
            observations in your report. They are sent without your name, email address or phone
            number attached.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p>
            We keep your information only as long as we need it for the purposes above.{' '}
            <strong>
              [CONFIRM — retention period, e.g. 36 months from last contact for leads who do not
              become clients]
            </strong>
            . Anonymous usage records that are not linked to a person are deleted after 90 days.
          </p>
        </Section>

        <Section title="Your rights">
          <p>Under POPIA you may ask us to:</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>confirm what personal information we hold about you;</li>
            <li>correct anything that is wrong or out of date;</li>
            <li>delete your information, subject to our record-keeping obligations;</li>
            <li>stop sending you marketing at any time.</li>
          </ul>
          <p className="mt-3">
            Email <strong>[CONFIRM — privacy contact address]</strong> and we will respond within 30
            days. If you are not satisfied, you may complain to the Information Regulator (South
            Africa) at{' '}
            <a
              href="https://inforegulator.org.za"
              className="underline underline-offset-2"
              target="_blank"
              rel="noopener noreferrer"
            >
              inforegulator.org.za
            </a>
            .
          </p>
        </Section>

        <Section title="A note on the advice we can give">
          <p>
            Everything this portal produces is general information. It is not financial advice, no
            needs analysis has been done, and no product is being recommended to you. For advice
            specific to your situation, speak to a licensed financial advisor.
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
