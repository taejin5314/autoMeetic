# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

---

## Coding Harness (Meta-Harness Principles)

Source: https://github.com/stanford-iris-lab/meta-harness

Before any non-trivial implementation, define a **domain spec** for the task. This prevents hidden assumptions, scope creep, and unmeasurable outcomes.

### 1. Problem Framing (before writing code)

Answer these before touching any file:

- **What exactly is being improved?** State the specific behavior, not a vague goal.
- **Unit of evaluation:** One component? One user flow? One API endpoint? One test suite?
- **Fixed vs. changeable:** What is frozen (existing APIs, data shapes, routing) and what is allowed to change?
- **Budget:** Estimated time, file count, or lines changed. If unknown, propose a conservative default and mark it explicitly.

> Rule: If the unit of evaluation cannot be stated in one sentence, do not write code yet. Ask one focused question.

### 2. Harness Definition (scope boundary)

- Define the **interface** every implementation candidate must satisfy before choosing an approach.
- State what is **explicitly out of scope** for this task.
- If multiple approaches exist, list them and state the tradeoffs — do not pick silently.
- Prefer the approach with the smallest blast radius (fewest files touched, fewest new dependencies).

### 3. Evaluation Plan (success criteria)

Before implementing, state:

- **Primary metric:** What does passing look like? (`tsc --noEmit` clean, test passes, visual match, etc.)
- **Secondary metrics:** Latency, bundle size, accessibility, mobile layout.
- **Noise / leakage risk:** Could the fix accidentally break something adjacent? Name it.
- **One candidate evaluation time:** How long does verifying this change take?

> Rule: "Make it work" is not an evaluation plan. Restate as a verifiable check.

### 4. Experience and Logging (learn from runs)

- After each non-trivial change, note what was tried and what failed — do not silently discard dead ends.
- If a pattern recurs (same bug, same type of component, same edge case), capture it as a project-level rule in this file.
- Store the outcome of each significant decision so future sessions can inspect prior runs without re-investigating.

### 5. Meta-Harness Fit Check

Meta-Harness principles add the most value when:

- The task is **long-horizon or multi-step** (more than one file, more than one concept).
- The same type of task **repeats** across the codebase (forms, API calls, data display, etc.).
- There are **recurring error patterns** that a structural change could address systematically.
- A **measurable evaluation loop** exists before implementation begins.

Skip the full spec for trivial one-liner changes. Apply it in full for features, refactors, and bug investigations.

---

## gstack Sprint Workflow

Source: https://github.com/garrytan/gstack

Every non-trivial feature follows this order. Do not skip steps.

```
Think → Plan → Build → Review → Test → Ship → Reflect
```

### Step-by-step

| Stage | What to do | gstack skill |
|---|---|---|
| **Think** | Run 6 forcing questions. Challenge the framing. Surface hidden assumptions before any code. | `/office-hours` |
| **Plan (CEO)** | Rethink the problem. Find the simplest wedge. Four modes: Expansion / Hold / Reduction. | `/plan-ceo-review` |
| **Plan (Eng)** | Lock architecture, data flow, edge cases, test plan. No hidden assumptions. | `/plan-eng-review` |
| **Plan (Design)** | Rate each design dimension 0-10. Fix the plan before implementation. | `/plan-design-review` |
| **Build** | Implement only what the plan says. Surgical changes. No speculative features. | — |
| **Review** | Catch bugs that pass CI but blow up in production. Auto-fix obvious ones. | `/review` |
| **Test** | Open a real browser. Find bugs, fix with atomic commits, re-verify. | `/qa` |
| **Ship** | Sync main, run tests, push, open PR. | `/ship` |
| **Reflect** | Weekly retro: what shipped, what slipped, growth areas. | `/retro` |

### Review routing

| Audience | Plan review | Live review |
|---|---|---|
| End users (UI, web app) | `/plan-design-review` | `/design-review` |
| Architecture / perf / tests | `/plan-eng-review` | `/review` |
| All of the above | `/autoplan` | — |

### Hard rules from gstack

- `/office-hours` runs **before** writing any code on a new feature. No exceptions.
- `/review` runs on every branch with changes before merging.
- `/investigate` before fixing any bug. Iron Law: no fixes without root cause.
- `/careful` or `/guard` when touching production or running destructive commands.
- Do not skip planning stages to move faster — skipped planning creates rewrites.

---

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Project-Specific Guidelines

- Use TypeScript strict mode (no `any` — strictly forbidden)
- Every implementation decision must map to a product requirement
- Define success criteria before writing code
- After each change, verify with typecheck (`tsc --noEmit`), lint (`eslint`), or manual QA
- If requirements are ambiguous, document the assumption before implementing

---

## UI/Design Guidelines (taste-skill — Anti-Slop)

Source: https://github.com/leonxlnx/taste-skill

Active dials: DESIGN_VARIANCE=8 · MOTION_INTENSITY=6 · VISUAL_DENSITY=4

### Architecture

- Check `package.json` before importing any 3rd-party library. Output `npm install <pkg>` if missing.
- Stack: React + Vite. Use local `useState`/`useReducer` for UI state.
- Styling: Tailwind CSS v3. Check version before writing config.
- Icons: `@phosphor-icons/react` or `@radix-ui/react-icons` only. Standardize `strokeWidth` to `1.5`.
- No emojis anywhere — code, markup, alt text, content. Use icons or SVG primitives instead.
- Full-height sections: always `min-h-[100dvh]`, never `h-screen`.
- Layouts: CSS Grid (`grid grid-cols-1 md:grid-cols-3 gap-6`), never flex percentage math.
- Page containers: `max-w-[1400px] mx-auto` or `max-w-7xl`.

### Typography

- Headlines: `text-4xl md:text-6xl tracking-tighter leading-none`
- Body: `text-base text-gray-600 leading-relaxed max-w-[65ch]`
- Fonts: `Geist`, `Satoshi`, or `Cabinet Grotesk` — **Inter is banned**.
- No oversized H1s; control hierarchy with weight and color, not scale alone.
- Serif fonts banned for dashboards/software UI.

### Color

- Max 1 accent color. Saturation < 80%.
- Base: Zinc/Slate neutrals. Accents: Emerald, Electric Blue, or Deep Rose.
- **AI Purple/Blue aesthetic is banned** — no purple glows, no neon gradients.
- No pure `#000000`. Use Zinc-950 or off-black.
- No oversaturated accents, no excessive gradient text on large headers.
- Stay on one palette. Do not mix warm and cool grays in the same project.

### Layout

- Centered Hero/H1 is banned when DESIGN_VARIANCE > 4. Use Split Screen, Left-Aligned, or Asymmetric Whitespace.
- No 3-column equal-card layouts. Use 2-col zig-zag, asymmetric grid, or horizontal scroll.
- Cards only when elevation communicates hierarchy. Shadow must be tinted to background hue.
- Mobile fallback (< 768px): always single-column `w-full px-4 py-8` for asymmetric layouts.

### Motion

- Interactive components with animation must be isolated `'use client'` leaf components.
- Spring physics: `type: "spring", stiffness: 100, damping: 20` — no linear easing.
- Magnetic hover: use Framer Motion `useMotionValue`/`useTransform` outside render cycle. Never `useState` for continuous animations.
- Animate exclusively `transform` and `opacity`. Never `top`, `left`, `width`, or `height`.
- Stagger list/grid reveals with `staggerChildren` or `animation-delay: calc(var(--index) * 100ms)`.
- Perpetual animations must be memoized (`React.memo`) and isolated in their own Client Component.
- Grain/noise overlays: fixed, `pointer-events-none` pseudo-elements only — never on scrolling containers.
- No arbitrary `z-50` spam. Z-index only for systemic layers (navbars, modals, overlays).
- Glassmorphism: add `border-white/10` inner border + `shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]`.

### Interaction States (mandatory)

- Loading: skeletal loaders matching layout shape — no generic circular spinners.
- Empty state: composed empty state showing how to populate.
- Error state: clear inline error reporting on forms.
- Tactile feedback on `:active`: `scale-[0.98]` or `-translate-y-[1px]`.

### Forbidden Patterns

- No neon/outer glows (`box-shadow` glows banned).
- No generic placeholder names: "John Doe", "Sarah Chan", "Acme", "Nexus", "SmartFlow".
- No predictable fake numbers: use organic data (`47.2%`, `+1 (312) 847-1928`).
- No Unsplash links. Use `https://picsum.photos/seed/{string}/800/600` or SVG avatars.
- No filler copy: "Elevate", "Seamless", "Unleash", "Next-Gen" are banned.
- No custom mouse cursors.
- shadcn/ui allowed but never in its default state — customize radii, colors, shadows.
