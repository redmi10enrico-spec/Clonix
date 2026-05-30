# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-05-30
- Primary product surfaces: auth flow, dashboard, profile, matching, chat, spotlight projects.
- Evidence reviewed: `auth.html`, `index.html`, `css/auth.css`, `css/profile.css`, `css/components.css`, `scripts/server.js`.

## Brand
- Personality: focused, modern, collaborative, practical.
- Trust signals: clear forms, immediate validation, persistent saved profile data, restrained empty/error states.
- Avoid: marketing-style landing screens inside the app, decorative UI that hides primary actions, inconsistent form patterns.

## Product goals
- Goals: help new users configure identity and skills before entering matching/chat workflows.
- Non-goals: full avatar generator, complex public profile builder, social media-style onboarding.
- Success signals: new users see onboarding once, profile data persists to MySQL, returning users enter the dashboard directly.

## Personas and jobs
- Primary personas: students, builders, founders, collaborators looking for skill-based matches.
- User jobs: register, define identity, add skills, start matching.
- Key contexts of use: desktop and mobile browsers, local development via `start.bat`.

## Information architecture
- Primary navigation: dashboard sidebar and mobile bottom nav.
- Core routes/screens: `auth.html`, `auth-success.html`, `index.html`.
- Content hierarchy: authentication first, onboarding overlay for new users, then dashboard sections.

## Design principles
- Principle 1: Reuse existing profile/auth form language before adding new components.
- Principle 2: Keep onboarding short enough to complete before the first dashboard session.
- Tradeoffs: profile photo upload is supported now; illustrated avatar choice remains visibly disabled for future work.

## Visual language
- Color: dark app shell, white panels, orange accent for focus/primary actions.
- Typography: Plus Jakarta Sans, compact headings inside app panels.
- Spacing/layout rhythm: grid-based forms, 8-20px internal rhythm, no nested decorative cards.
- Shape/radius/elevation: existing app uses 10-20px radii and soft card shadows.
- Motion: light fade/hover transitions only.
- Imagery/iconography: Phosphor icons and uploaded profile image previews.

## Components
- Existing components to reuse: `.form-group`, `.form-input`, `.btn-primary`, `.btn-secondary`, `.skill-item`.
- New/changed components: onboarding overlay, photo upload preview, disabled avatar option, onboarding skill chips.
- Variants and states: loading, validation error, upload preview, disabled future avatar.
- Token/component ownership: extend existing CSS modules; no new framework.

## Accessibility
- Target standard: keyboard-operable form flow with visible labels.
- Keyboard/focus behavior: inputs and buttons follow document order; modal is not dismissed until saved.
- Contrast/readability: white panel on dark overlay, existing orange focus.
- Screen-reader semantics: labels tied to inputs; modal uses dialog role.
- Reduced motion and sensory considerations: no required animation for completion.

## Responsive behavior
- Supported breakpoints/devices: desktop and mobile.
- Layout adaptations: two-column onboarding becomes one-column on narrow screens.
- Touch/hover differences: upload and skill buttons remain full-size touch targets.

## Interaction states
- Loading: primary save button disables and changes label.
- Empty: skill list starts empty with direct input.
- Error: inline onboarding error plus existing toast where available.
- Success: local user updated and overlay removed.
- Disabled: future avatar control is visible but unavailable.
- Offline/slow network: save fails without marking onboarding complete.

## Content voice
- Tone: direct, encouraging, concise Italian.
- Terminology: “competenze”, “nickname”, “foto profilo”, “configurazione”.
- Microcopy rules: describe what the field stores, not broad product promises.

## Implementation constraints
- Framework/styling system: vanilla HTML/CSS/JS, Express/MySQL backend.
- Design-token constraints: use existing CSS variables and button/form classes.
- Performance constraints: profile photos are resized to WebP when Sharp is available.
- Compatibility constraints: must work when launched with `start.bat`.
- Test/screenshot expectations: syntax checks for backend/frontend scripts; browser visual check when an in-app browser tool is available.

## Open questions
- [ ] Final avatar generator choices / owner: product / impact: currently shown as future disabled option.
