/**
 * WhyIdynify — the below-fold section on signup.
 *
 * Copy is frozen by the positioning brief and maps to WHO → WHY → NEXT. The
 * banned vocabulary ("leads", "automate", "sales engine", "AI SDR", "always
 * on") is not paraphrased here — it is simply absent.
 *
 * The heading is "Why teams love IDYNIFY", not "Why sales teams". The four
 * value propositions below it are relationship-first and read the same for a
 * fundraiser, a partnership manager or a founder as they do for a BD rep;
 * naming one audience in the heading narrowed it a line before the copy
 * deliberately widened it. This is a heading-scope change only — the product
 * category ("AI Relationship Intelligence for Sales") is untouched and is
 * tracked separately as POSITIONING-001.
 *
 * Lazy-loaded by Signup: nothing here is needed to create an account, so it
 * must not compete with the form for the first paint.
 */

import { Users, MessageSquare, Target, Sparkles } from 'lucide-react';

const CARDS = [
  {
    Icon: Users,
    title: 'Know who matters',
    body: 'Surface the relationships and prospects that are actually worth your attention.',
  },
  {
    Icon: MessageSquare,
    title: 'Understand why they matter',
    body: "Barry connects your conversations and activity to tell you what's really happening.",
  },
  {
    Icon: Target,
    title: 'Know what to do next',
    body: 'The right action, at the right time, on the right relationship.',
  },
  {
    Icon: Sparkles,
    title: 'Barry connects the dots',
    body: 'Barry brings your relationships, conversations, and activity together so the next move is clearer.',
  },
];

export default function WhyIdynify() {
  return (
    <section className="auth-why" aria-labelledby="auth-why-title">
      <h2 className="auth-why-title" id="auth-why-title">
        Why teams love <em>IDYNIFY</em>
      </h2>
      <div className="auth-why-grid">
        {CARDS.map((card) => {
          const Icon = card.Icon;
          return (
            <article className="auth-why-card" key={card.title}>
              <div className="auth-why-icon">
                <Icon size={21} aria-hidden="true" />
              </div>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
