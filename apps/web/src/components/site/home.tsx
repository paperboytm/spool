import { ButtonLink } from '@spool-lab/ui'
import { useEffect } from 'react'

import { HeroSpace } from './hero-space'
import { FinalCTA, FlowShow, GoalTrail, InstallCommandPill, PillarHead } from './home-pieces'

export default function HomePage() {
  useScrollReveal()
  return <WarmHome />
}

/* Full-bleed scene hero, stacked sections. */
function WarmHome() {
  return (
    <div className="home-page">
      <Hero />

      <main className="wrap">
        <LearnSection />
        <FlowSection />
        <FinalCTA />
      </main>
    </div>
  )
}

function useScrollReveal() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (typeof IntersectionObserver === 'undefined') {
      document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-visible'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            io.unobserve(entry.target)
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    )
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
}

/* ───────────────────────────── Hero ───────────────────────────── */

function Hero() {
  return (
    <section className="home-hero">
      <HeroSpace />

      <div className="wrap hh-content">
        <h1 className="hh-h1">
          Sessions everywhere.
          <br />
          <em>Knowledge in one place</em>
          <span className="accent">.</span>
        </h1>

        <p className="hh-lede">
          Spool streams your team's agent Sessions into one shared space — readable, searchable, and
          resumable.
        </p>

        <div className="hh-cta">
          <InstallCommandPill />
          <ButtonLink href="/explore" className="hh-btn" variant="accent">
            Explore Sessions →
          </ButtonLink>
          <ButtonLink href="/docs/quick-start" className="hh-btn" variant="outline">
            Share yours →
          </ButtonLink>
        </div>
      </div>
    </section>
  )
}

function LearnSection() {
  return (
    <section className="pillar reveal">
      <div className="lr">
        <div>
          <div className="s-kick">Learn</div>
          <h2 className="s-title">
            Agents solve hard problems. <em>Learn how they think</em>
            <span className="accent">.</span>
          </h2>
          <p className="s-sub">
            Spool reads a Session as routes toward its goal: what the agent tried, where each
            attempt dead-ended, and the path that finally landed. Open any Session and check how the{' '}
            <code>/goal</code> was actually reached.
          </p>
        </div>
        <GoalTrail />
      </div>
    </section>
  )
}

function FlowSection() {
  return (
    <section className="pillar reveal">
      <PillarHead
        kicker="Flow"
        title={
          <>
            In with one command. <em>Out with one link</em>
            <span className="accent">.</span>
          </>
        }
        sub={
          <>
            Run <code>spool</code> in a project. It refreshes the local index, reviews the exact
            record range and sensitive-data findings, then publishes supported Sessions to Explore
            and search by default. Teammates read the link, then continue in their own agent.
          </>
        }
      />

      <div className="pillar-spec">
        <FlowShow />
      </div>
    </section>
  )
}
